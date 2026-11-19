import { describe, expect, it } from 'vitest';
import { makeRedeemHarness } from '../helpers/invitation-fakes';
import { expectStudyRunError, makeHarness, RESEARCHER } from '../helpers/study-run-fakes';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

/**
 * Regression tests for two compare-and-set races found in review of P3 (AC-14, architecture §6.5):
 *  1. Invitation / profile locking: the run binding must be frozen together with the profile lock.
 *  2. Preview / confirmation: a Preview may only vouch for the exact revision it rendered.
 * Each interleaving is injected deterministically between the two steps of the real service code.
 */

const span = (raw: string) => ({ start: 0, end: 7, text: raw.slice(0, 7) });

async function draftRunWithTwoProfiles() {
  const h = makeRedeemHarness();
  let run = (await h.service.create(RESEARCHER, { code: 'RUN-RACE', name: 'Race', phase: 'MAIN', packageId: h.packageId.toHexString(), targetSampleSize: 30 })).run;
  const id = run._id!.toHexString();
  run = (await h.service.confirmQuota(RESEARCHER, id, { expectedVersion: run.version, quotaPerArm: 15 })).run;
  run = (await h.service.confirmEntryPolicy(RESEARCHER, id, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
  run = (await h.service.confirmInfoConsentReview(RESEARCHER, id, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
  const profileA = await h.confirmDefaultProfile();
  const profileB = await h.confirmDefaultProfile([span(h.state.rawContent)]);
  await h.service.confirmPresentationProfile(RESEARCHER, id, { expectedVersion: run.version, profileId: profileA._id!.toHexString() });
  const bind = async (profileId: string) => {
    const fresh = await h.service.get(RESEARCHER, id);
    return h.service.confirmPresentationProfile(RESEARCHER, id, { expectedVersion: fresh.version, profileId });
  };
  return { h, id, profileA, profileB, bind };
}

describe('Race 1: locking the profile and the run together (§6.5, AC-14)', () => {
  it('a rebind between the profile lock and the run lock is refused: no invitation, run unlocked and bound to the new profile', async () => {
    const { h, id, profileA, profileB, bind } = await draftRunWithTwoProfiles();
    const original = h.profiles.lockIfConfirmed.bind(h.profiles);
    h.profiles.lockIfConfirmed = async (pid, at) => {
      const locked = await original(pid, at);
      await bind(profileB._id!.toHexString()); // another Admin rebinds right after the profile lock
      return locked;
    };

    await expectStudyRunError(h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V2', count: 1 }), 'PRESENTATION_PROFILE_BINDING_CHANGED', 409);

    expect(h.invitations.docs.size).toBe(0);
    const run = await h.service.get(RESEARCHER, id);
    expect(run.locked).toBe(false);
    expect(String(run.presentation.V2.profileId)).toBe(String(profileB._id));
    expect((await h.profiles.getById(profileA._id!))!.status).toBe('LOCKED'); // conservative orphan lock, no data corrupted
  });

  it('after such a refusal the Admin can issue again: the run and the NEW profile are locked consistently', async () => {
    const { h, id, profileB, bind } = await draftRunWithTwoProfiles();
    const original = h.profiles.lockIfConfirmed.bind(h.profiles);
    let injected = false;
    h.profiles.lockIfConfirmed = async (pid, at) => {
      const locked = await original(pid, at);
      if (!injected) { injected = true; await bind(profileB._id!.toHexString()); }
      return locked;
    };
    await expectStudyRunError(h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V2', count: 1 }), 'PRESENTATION_PROFILE_BINDING_CHANGED', 409);

    const { issued } = await h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V2', count: 2 });
    expect(issued).toHaveLength(2);
    const run = await h.service.get(RESEARCHER, id);
    expect(run.locked).toBe(true);
    expect(String(run.presentation.V2.profileId)).toBe(String(profileB._id));
    expect((await h.profiles.getById(profileB._id!))!.status).toBe('LOCKED');
  });

  it('the run AND the profile are already locked when the first invitation is written', async () => {
    const { h, id, profileA } = await draftRunWithTwoProfiles();
    const seen: Array<{ runLocked: boolean; profile: string }> = [];
    const insert = h.invitations.insertMany.bind(h.invitations);
    h.invitations.insertMany = async (docs) => {
      seen.push({ runLocked: (await h.service.get(RESEARCHER, id)).locked, profile: (await h.profiles.getById(profileA._id!))!.status });
      return insert(docs);
    };
    await h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V1', count: 1 });
    expect(seen).toEqual([{ runLocked: true, profile: 'LOCKED' }]);
  });

  it('once the first invitation is issued the binding can no longer be changed (409)', async () => {
    const { h, id, profileB, bind } = await draftRunWithTwoProfiles();
    await h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V1', count: 1 });
    await expectStudyRunError(bind(profileB._id!.toHexString()), 'STUDY_RUN_LOCKED', 409);
  });

  it('a failed insert keeps the locks consistent and audited; a retry succeeds without double-auditing the lock', async () => {
    const { h, id, profileA } = await draftRunWithTwoProfiles();
    const insert = h.invitations.insertMany.bind(h.invitations);
    let fail = true;
    h.invitations.insertMany = async (docs) => {
      if (fail) { fail = false; throw new Error('transient write failure'); }
      return insert(docs);
    };
    await expect(h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V2', count: 1 })).rejects.toThrow('transient write failure');
    expect(h.invitations.docs.size).toBe(0);
    expect((await h.service.get(RESEARCHER, id)).locked).toBe(true);
    expect((await h.profiles.getById(profileA._id!))!.status).toBe('LOCKED');
    const lockAudits = () => h.audits.filter((a) => a.action === 'PRESENTATION_PROFILE_LOCKED' || a.action === 'STUDY_RUN_LOCKED');
    expect(lockAudits().map((a) => [a.action, a.metadata!.firstInvitationId])).toEqual([
      ['PRESENTATION_PROFILE_LOCKED', null],
      ['STUDY_RUN_LOCKED', null]
    ]);

    await h.admin.create(RESEARCHER, { studyRunId: id, variant: 'V2', count: 1 });
    expect(h.invitations.docs.size).toBe(1);
    expect(lockAudits()).toHaveLength(2);
  });
});

describe('Race 2: Preview and confirmation are bound to one edit revision (AC-14)', () => {
  async function setup() {
    const h = makeHarness();
    const created = await h.profileService.create(RESEARCHER, { contentRevisionId: h.contentId.toHexString() });
    return { h, pid: String(created.profile._id), emphasis: [span(h.state.rawContent)] };
  }

  it('an edit between the Preview read and its mark is refused: the new content is NOT marked as previewed', async () => {
    const { h, pid, emphasis } = await setup();
    const original = h.profiles.markPreviewedIfEditable.bind(h.profiles);
    let injected = false;
    h.profiles.markPreviewedIfEditable = async (id, revision, by, at) => {
      if (!injected) { injected = true; await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis }); } // Admin B edits
      return original(id, revision, by, at);
    };
    await expectStudyRunError(h.profileService.preview(RESEARCHER, pid), 'PRESENTATION_PROFILE_REVISION_CONFLICT', 409);

    const stored = (await h.profiles.getById(h.profiles.docs.values().next().value!._id!))!;
    expect(stored.emphasis).toHaveLength(1);
    expect(stored.previewedAt).toBeNull();
    expect(stored.previewedRevision).toBeNull();
    await expectStudyRunError(h.profileService.confirm(RESEARCHER, pid), 'PRESENTATION_PROFILE_PREVIEW_REQUIRED', 409);
  });

  it('an edit (even followed by another Preview) between the confirmation read and its CAS is refused', async () => {
    const { h, pid, emphasis } = await setup();
    await h.profileService.preview(RESEARCHER, pid); // Admin A previews revision 1 (no bold)
    const original = h.profiles.confirmIfPreviewed.bind(h.profiles);
    let injected = false;
    h.profiles.confirmIfPreviewed = async (id, revision, by, at) => {
      if (!injected) {
        injected = true;
        await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis }); // Admin B edits -> revision 2
        await h.profileService.preview(RESEARCHER, pid); // ...and previews revision 2
      }
      return original(id, revision, by, at);
    };
    await expectStudyRunError(h.profileService.confirm(RESEARCHER, pid), 'PRESENTATION_PROFILE_REVISION_CONFLICT', 409);
    expect((await h.profileService.get(RESEARCHER, pid)).status).toBe('DRAFT');
  });

  it('confirmation with the revision the Admin saw is refused after any later edit, and accepted when unchanged', async () => {
    const { h, pid, emphasis } = await setup();
    const seen = (await h.profileService.preview(RESEARCHER, pid)).profile.editRevision;
    await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis });
    await h.profileService.preview(RESEARCHER, pid); // someone else previewed the new content
    await expectStudyRunError(h.profileService.confirm(RESEARCHER, pid, { expectedRevision: seen }), 'PRESENTATION_PROFILE_REVISION_CONFLICT', 409);

    const current = (await h.profileService.preview(RESEARCHER, pid)).profile.editRevision;
    expect(current).toBe(seen + 1);
    const { profile } = await h.profileService.confirm(RESEARCHER, pid, { expectedRevision: current });
    expect(profile.status).toBe('CONFIRMED');
    expect(profile.previewedRevision).toBe(profile.editRevision);
  });

  it('the revision is tracked in the store: every edit increments it and clears the preview mark', async () => {
    const { h, pid, emphasis } = await setup();
    const id = h.profiles.docs.values().next().value!._id!;
    expect((await h.profiles.getById(id))!.editRevision).toBe(1);
    await h.profileService.preview(RESEARCHER, pid);
    expect((await h.profiles.getById(id))!.previewedRevision).toBe(1);
    await h.profileService.updateEmphasis(RESEARCHER, pid, { emphasis });
    const edited = (await h.profiles.getById(id))!;
    expect([edited.editRevision, edited.previewedRevision, edited.previewedAt]).toEqual([2, null, null]);
    expect(await h.profiles.markPreviewedIfEditable(id, 1, 'x', new Date())).toBeNull(); // stale revision
    expect(await h.profiles.confirmIfPreviewed(id, 2, 'x', new Date())).toBeNull(); // revision 2 never previewed
    expect(await h.profiles.markPreviewedIfEditable(id, 2, 'x', new Date())).not.toBeNull();
    expect(await h.profiles.confirmIfPreviewed(id, 1, 'x', new Date())).toBeNull(); // stale revision
    expect(await h.profiles.confirmIfPreviewed(id, 2, 'x', new Date())).not.toBeNull();
  });
});
