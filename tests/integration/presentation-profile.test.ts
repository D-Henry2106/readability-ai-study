import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { ALL_CAPABILITIES, expectStudyRunError, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { PresentationProfileRepository } from '@/lib/repositories/presentation-profile.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import { InvitationService } from '@/lib/services/invitation.service';
import { InvitationRedemptionService } from '@/lib/services/invitation-redemption.service';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { ReadingService } from '@/lib/services/reading.service';
import { StudyRunService } from '@/lib/services/study-run.service';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';
import type { SessionDoc } from '@/types/research';

const runs = () => new StudyRunService({ capabilities: ALL_CAPABILITIES });
const profiles = () => new PresentationProfileService();
const invitations = () => new InvitationService({ baseUrl: () => 'https://study.example' });
const redemption = () => new InvitationRedemptionService();

describe('Presentation Profile V2 on a real MongoDB (P3: AC-11..AC-14)', () => {
  let contentId: string;
  let packageId: string;
  let rawContent: string;

  beforeEach(async () => {
    const seeded = await resetAndSeedReady();
    contentId = String(seeded.contentId);
    const content = (await withTestDb((db) => db.collection('content_revisions').findOne({ _id: seeded.contentId })))!;
    rawContent = String(content.rawContent);
    packageId = String((await withTestDb((db) => db.collection('content_packages').findOne({ code: 'FIXTURE_MAIN' })))!._id);
  });

  it('creates the P3 unique index { contentRevisionId: 1, version: 1 } on presentation_profiles', async () => {
    const idx = await withTestDb((db) => db.collection('presentation_profiles').indexes());
    expect(idx.some((i) => i.unique === true && i.key.contentRevisionId === 1 && i.key.version === 1)).toBe(true);
  });

  it('AC-12/13/14: full lifecycle DRAFT -> updateEmphasis -> preview -> confirm -> bind -> OPEN -> lock on first invitation -> 409 on edit', async () => {
    const { profile } = await profiles().create(RESEARCHER, { contentRevisionId: contentId });
    const pid = String(profile._id);
    expect(profile.version).toBe(1);
    expect(profile.status).toBe('DRAFT');
    expect(profile.emphasis).toEqual([]);

    // Cannot confirm before preview
    await expectStudyRunError(profiles().confirm(RESEARCHER, pid), 'PRESENTATION_PROFILE_PREVIEW_REQUIRED', 409);

    // Select manual emphasis phrase from rawContent
    const phrase = 'fixture experimental content';
    const start = rawContent.indexOf(phrase);
    const span = { start, end: start + phrase.length, text: phrase };
    await profiles().updateEmphasis(RESEARCHER, pid, { emphasis: [span] });

    // Preview verifies V1/V2 exact textContent match and records previewedAt
    const preview = await profiles().preview(RESEARCHER, pid);
    expect(preview.v1.textContent).toBe(rawContent);
    expect(preview.v2.textContent).toBe(rawContent);
    expect(preview.v2.boldSegments).toEqual([phrase]);
    expect(preview.integrity.exactTextMatch).toBe(true);

    // Confirm
    const { profile: confirmed } = await profiles().confirm(RESEARCHER, pid);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedBy).toBe('researcher');

    // Create Study Run and bind profile
    let run = (await runs().create(RESEARCHER, { code: 'RUN-P3', name: 'Run P3', phase: 'MAIN', packageId, targetSampleSize: 30 })).run;
    const runId = String(run._id);
    run = (await runs().confirmQuota(RESEARCHER, runId, { expectedVersion: run.version, quotaPerArm: 15 })).run;
    run = (await runs().confirmEntryPolicy(RESEARCHER, runId, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
    run = (await runs().confirmInfoConsentReview(RESEARCHER, runId, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
    run = (await runs().confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: run.version, profileId: pid })).run;
    run = (await runs().transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'OPEN' })).run;
    expect(run.status).toBe('OPEN');

    // Concurrent first invitation creations -> profile and run are locked atomically once
    const batchResults = await Promise.all([
      invitations().create(RESEARCHER, { studyRunId: runId, variant: 'V1', count: 1 }),
      invitations().create(RESEARCHER, { studyRunId: runId, variant: 'V2', count: 1 })
    ]);
    const lockedProfile = await profiles().get(SUPERVISOR, pid);
    expect(lockedProfile.status).toBe('LOCKED');
    expect(lockedProfile.lockedAt === null).toBe(false);
    expect((await runs().get(SUPERVISOR, runId)).locked).toBe(true);

    const lockAudits = await withTestDb((db) =>
      db.collection('admin_audit').find({ action: 'PRESENTATION_PROFILE_LOCKED', targetId: pid }).toArray()
    );
    expect(lockAudits).toHaveLength(1);

    // Editing or re-confirming a LOCKED profile returns 409
    await expectStudyRunError(profiles().updateEmphasis(RESEARCHER, pid, { emphasis: [] }), 'PRESENTATION_PROFILE_LOCKED', 409);
    await expectStudyRunError(profiles().confirm(RESEARCHER, pid), 'PRESENTATION_PROFILE_LOCKED', 409);

    // Redeem V1 and V2 invitations -> sessions carry pinned presentationVariant, presentationVersion and presentationProfileId
    const v1Token = batchResults[0].issued[0].token;
    const v2Token = batchResults[1].issued[0].token;
    const r1 = await redemption().redeem({ token: v1Token, deviceType: 'desktop', cookieSessionId: null });
    const r2 = await redemption().redeem({ token: v2Token, deviceType: 'desktop', cookieSessionId: null });

    const s1 = (await withTestDb((db) => db.collection<SessionDoc>('sessions').findOne({ id: r1.sessionId })))!;
    const s2 = (await withTestDb((db) => db.collection<SessionDoc>('sessions').findOne({ id: r2.sessionId })))!;
    expect(s1.presentationVariant).toBe('V1');
    expect(s1.presentationVersion).toBe(1);
    expect(s1.presentationProfileId).toBeUndefined();
    expect(s2.presentationVariant).toBe('V2');
    expect(s2.presentationVersion).toBe(1);
    expect(String(s2.presentationProfileId)).toBe(pid);

    // Starting reading for V1 and V2 Study Run sessions records the session's pinned variant
    const readingSvc = new ReadingService();
    const read1 = await readingSvc.start({ ...s1, currentStage: 'READING_1' });
    const read2 = await readingSvc.start({ ...s2, currentStage: 'READING_1' });
    expect(read1.presentation).toBe('V1');
    expect(read2.presentation).toBe('V2');

    // Creating a new version for the same contentRevisionId yields version 2 in DRAFT while version 1 stays LOCKED
    const { profile: v2 } = await profiles().create(RESEARCHER, { contentRevisionId: contentId });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe('DRAFT');
    expect((await profiles().get(SUPERVISOR, pid)).status).toBe('LOCKED');
  });
  // ---- P3 hardening: races found in review (AC-14, architecture §6.5) --------------------------------------------------------

  async function confirmedProfile(emphasis: Array<{ start: number; end: number; text: string }> = []) {
    const { profile } = await profiles().create(RESEARCHER, { contentRevisionId: contentId, emphasis });
    await profiles().preview(RESEARCHER, String(profile._id));
    return (await profiles().confirm(RESEARCHER, String(profile._id))).profile;
  }
  async function readyRun(code: string, profileId: string) {
    let run = (await runs().create(RESEARCHER, { code, name: code, phase: 'MAIN', packageId, targetSampleSize: 30 })).run;
    const runId = String(run._id);
    run = (await runs().confirmQuota(RESEARCHER, runId, { expectedVersion: run.version, quotaPerArm: 15 })).run;
    run = (await runs().confirmEntryPolicy(RESEARCHER, runId, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
    run = (await runs().confirmInfoConsentReview(RESEARCHER, runId, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
    await runs().confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: run.version, profileId });
    return runId;
  }
  const bold = () => [{ start: 0, end: 7, text: rawContent.slice(0, 7) }];

  it('Preview and confirmation are compare-and-set on editRevision (real MongoDB)', async () => {
    const repo = new PresentationProfileRepository();
    const { profile } = await profiles().create(RESEARCHER, { contentRevisionId: contentId });
    const id = profile._id!;
    expect(profile.editRevision).toBe(1);
    expect(await repo.markPreviewedIfEditable(id, 1, 'r', new Date())).not.toBeNull();

    await profiles().updateEmphasis(RESEARCHER, String(id), { emphasis: bold() });
    const edited = (await repo.getById(id))!;
    expect([edited.editRevision, edited.previewedRevision, edited.previewedAt]).toEqual([2, null, null]);

    expect(await repo.markPreviewedIfEditable(id, 1, 'r', new Date())).toBeNull(); // stale revision
    expect(await repo.confirmIfPreviewed(id, 2, 'r', new Date())).toBeNull(); // revision 2 was never previewed
    expect(await repo.markPreviewedIfEditable(id, 2, 'r', new Date())).not.toBeNull();
    expect(await repo.confirmIfPreviewed(id, 1, 'r', new Date())).toBeNull(); // stale revision
    expect((await repo.confirmIfPreviewed(id, 2, 'r', new Date()))!.status).toBe('CONFIRMED');
  }, 120_000);

  it('the run lock is bound to the validated profile: a rebound run cannot be locked as if it were bound to the old one', async () => {
    const a = await confirmedProfile();
    const b = await confirmedProfile(bold());
    const runId = await readyRun('RUN-BIND', String(a._id));
    const repo = new StudyRunRepository();
    expect(await repo.lockIfUnlocked(new ObjectId(runId), { profileId: b._id!, version: b.version })).toBeNull();
    expect((await runs().get(SUPERVISOR, runId)).locked).toBe(false);
    expect(await repo.lockIfUnlocked(new ObjectId(runId), { profileId: a._id!, version: a.version + 1 })).toBeNull(); // wrong version
    expect(await repo.lockIfUnlocked(new ObjectId(runId), { profileId: a._id!, version: a.version })).not.toBeNull();
    expect((await runs().get(SUPERVISOR, runId)).locked).toBe(true);
  }, 120_000);

  it('concurrent first invitation vs rebind: an invitation never exists unless the run is locked on a LOCKED profile', async () => {
    for (let i = 0; i < 3; i += 1) {
      const a = await confirmedProfile();
      const b = await confirmedProfile(bold());
      const runId = await readyRun(`RUN-RACE-${i}`, String(a._id));
      await Promise.allSettled([
        invitations().create(RESEARCHER, { studyRunId: runId, variant: 'V2', count: 1 }),
        (async () => {
          const fresh = await runs().get(RESEARCHER, runId);
          return runs().confirmPresentationProfile(RESEARCHER, runId, { expectedVersion: fresh.version, profileId: String(b._id) });
        })()
      ]);
      const run = await runs().get(SUPERVISOR, runId);
      const issued = await withTestDb((db) => db.collection('invitations').countDocuments({ studyRunId: new ObjectId(runId) }));
      const bound = await profiles().get(SUPERVISOR, String(run.presentation.V2.profileId));
      if (issued > 0) expect(run.locked).toBe(true);
      if (run.locked) expect(bound.status).toBe('LOCKED'); // the profile the run is bound to is the one that was locked
    }
  }, 120_000);

  it('concurrent edit vs Preview: a Preview mark always refers to the current revision', async () => {
    for (let i = 0; i < 4; i += 1) {
      const { profile } = await profiles().create(RESEARCHER, { contentRevisionId: contentId });
      const pid = String(profile._id);
      await Promise.allSettled([
        profiles().preview(RESEARCHER, pid),
        profiles().updateEmphasis(RESEARCHER, pid, { emphasis: bold() }),
        profiles().preview(RESEARCHER, pid)
      ]);
      const stored = await profiles().get(SUPERVISOR, pid);
      expect(stored.previewedRevision === null || stored.previewedRevision === stored.editRevision).toBe(true);
      expect(stored.previewedAt === null).toBe(stored.previewedRevision === null);
      if (stored.status === 'CONFIRMED') expect(stored.previewedRevision).toBe(stored.editRevision);
    }
  }, 120_000);
});
