import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { ALL_CAPABILITIES, expectStudyRunError, fixtureConfig, makeHarness, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { STUDY_RUN_CAPABILITIES } from '@/lib/study-run/capabilities';
import { sha256Hex } from '@/lib/study-run/info-consent';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';

type Harness = ReturnType<typeof makeHarness>;
const base = (h: Harness, over: Record<string, unknown> = {}) => ({ code: 'run-01', name: 'Run 01', phase: 'MAIN', packageId: h.packageId.toHexString(), questionSetId: h.questionSetId.toHexString(), targetSampleSize: 30, ...over });
async function create(h: Harness, over: Record<string, unknown> = {}) { return (await h.service.create(RESEARCHER, base(h, over))).run; }
const id = (run: { _id?: ObjectId }) => run._id!.toHexString();
/** Brings a DRAFT run to "everything confirmed" so it can OPEN. */
async function ready(h: Harness) {
  let run = await create(h);
  run = (await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: run.version, quotaPerArm: 15 })).run;
  run = (await h.service.confirmEntryPolicy(RESEARCHER, id(run), { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
  run = (await h.service.confirmInfoConsentReview(RESEARCHER, id(run), { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
  const profile = await h.confirmDefaultProfile();
  run = (await h.service.confirmPresentationProfile(RESEARCHER, id(run), { expectedVersion: run.version, profileId: profile._id!.toHexString() })).run;
  return run;
}

describe('AC-01 sample size and quota confirmation', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('creates a DRAFT run with counters at 0 and NO stored quota (only a proposal)', async () => {
    const r = await h.service.create(RESEARCHER, base(h));
    expect(r.proposedQuotaPerArm).toBe(15);
    expect(r.run.status).toBe('DRAFT');
    expect(r.run.quotaPerArm).toBeNull();
    expect(r.run.quotaConfirmedAt).toBeNull();
    expect(r.run.arms).toEqual({ V1: { validIncluded: 0, supplementalValid: 0 }, V2: { validIncluded: 0, supplementalValid: 0 } });
    expect(r.run.version).toBe(1);
    expect(r.run.code).toBe('RUN-01');
  });
  it('rejects odd, zero and negative sample sizes at creation', async () => {
    for (const n of [31, 0, -2, 1]) {
      let rejected = false;
      try { await h.service.create(RESEARCHER, base(h, { targetSampleSize: n })); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
    expect(h.store.docs.size).toBe(0);
  });
  it('stores the quota only after the Admin confirms exactly N/2', async () => {
    const run = await create(h);
    await expectStudyRunError(h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 14 }), 'STUDY_RUN_QUOTA_MISMATCH', 409);
    expect((await h.service.get(RESEARCHER, id(run))).quotaPerArm).toBeNull();
    const r = await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 15 });
    expect(r.run.quotaPerArm).toBe(15);
    expect(r.run.quotaConfirmedBy).toBe('researcher');
    expect(r.run.quotaConfirmedAt === null).toBe(false);
  });
  it('changing the sample size (up or down) resets the confirmation and requires confirming again', async () => {
    const run = await create(h);
    const confirmed = (await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 15 })).run;
    const up = await h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: confirmed.version, targetSampleSize: 40 });
    expect(up.run.targetSampleSize).toBe(40);
    expect(up.run.quotaPerArm).toBeNull();
    expect(up.run.quotaConfirmedAt).toBeNull();
    expect(up.proposedQuotaPerArm).toBe(20);
    await expectStudyRunError(h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: up.run.version, quotaPerArm: 15 }), 'STUDY_RUN_QUOTA_MISMATCH');
    const again = await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: up.run.version, quotaPerArm: 20 });
    const down = await h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: again.run.version, targetSampleSize: 10 });
    expect(down.run.quotaPerArm).toBeNull();
    expect(down.run.targetSampleSize).toBe(10);
  });
  it('rejects an odd new sample size and an unchanged one', async () => {
    const run = await create(h);
    let rejected = false;
    try { await h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: 1, targetSampleSize: 31 }); } catch { rejected = true; }
    expect(rejected).toBe(true);
    await expectStudyRunError(h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: 1, targetSampleSize: 30 }), 'STUDY_RUN_SAMPLE_SIZE_UNCHANGED', 409);
  });
  it('refuses to lower the sample size below validIncluded (per arm) and leaves the run unchanged', async () => {
    const run = await create(h);
    h.store.setArmsForTest(run._id!, { V1: { validIncluded: 8, supplementalValid: 0 }, V2: { validIncluded: 3, supplementalValid: 0 } });
    const details = await expectStudyRunError(h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: 1, targetSampleSize: 14 }), 'STUDY_RUN_SAMPLE_SIZE_BELOW_VALID_INCLUDED', 409);
    expect(details).toContain('validIncluded=8');
    expect((await h.service.get(RESEARCHER, id(run))).targetSampleSize).toBe(30);
    const ok = await h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: 1, targetSampleSize: 16 });
    expect(ok.run.targetSampleSize).toBe(16);
  });
  it('refuses a sample-size change while the run is OPEN (pause first)', async () => {
    const h2 = makeHarness();
    const run = await ready(h2);
    const open = (await h2.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    await expectStudyRunError(h2.service.updateSampleSize(RESEARCHER, id(open), { expectedVersion: open.version, targetSampleSize: 40 }), 'STUDY_RUN_OPEN_PAUSE_FIRST', 409);
  });
  it('never writes the arms counters through any P1 operation', async () => {
    const run = await ready(h);
    const open = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    const paused = (await h.service.transition(RESEARCHER, id(open), { expectedVersion: open.version, to: 'PAUSED' })).run;
    await h.service.updateSampleSize(RESEARCHER, id(paused), { expectedVersion: paused.version, targetSampleSize: 20 });
    expect(h.store.writtenKeys.includes('arms')).toBe(false);
    expect(h.store.writtenKeys.some((k) => k.startsWith('arms'))).toBe(false);
  });
  it('rejects a duplicate run code and an ineligible or unknown package', async () => {
    await create(h);
    await expectStudyRunError(h.service.create(RESEARCHER, base(h, { code: 'RUN-01' })), 'STUDY_RUN_CODE_EXISTS', 409);
    await expectStudyRunError(h.service.create(RESEARCHER, base(h, { code: 'OTHER', packageId: new ObjectId().toHexString() })), 'STUDY_RUN_PACKAGE_NOT_FOUND', 404);
    h.state.problems = ['INVALID_CONTENT'];
    const details = await expectStudyRunError(h.service.create(RESEARCHER, base(h, { code: 'OTHER' })), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409);
    expect(details).toContain('INVALID_CONTENT');
    h.state.problems = [];
    const details2 = await expectStudyRunError(h.service.create(RESEARCHER, base(h, { code: 'OTHER', phase: 'PILOT' })), 'STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409);
    expect(details2).toContain('PACKAGE_PHASE_MISMATCH');
  });
  it('snapshots package, content and question set from the package', async () => {
    const run = await create(h);
    expect(run.snapshot.packageCode).toBe('FIXTURE_MAIN');
    expect(run.snapshot.packageRevision).toBe(3);
    expect(run.snapshot.packageId.equals(h.packageId)).toBe(true);
    expect(run.snapshot.contentRevisionId.equals(h.state.pkg.contentRevisionId)).toBe(true);
    expect(run.snapshot.questionSetId.equals(h.state.pkg.questionSetId)).toBe(true);
  });
});

describe('AC-02 / AC-03 (P1 part): roles and optimistic locking at service level', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('SUPERVISOR is refused (FORBIDDEN) on every write and nothing is stored or audited', async () => {
    const run = await create(h);
    h.audits.length = 0;
    const before = JSON.stringify([...h.store.docs.values()]);
    const calls: Array<() => Promise<unknown>> = [
      () => h.service.create(SUPERVISOR, base(h, { code: 'X1' })),
      () => h.service.updateSampleSize(SUPERVISOR, id(run), { expectedVersion: 1, targetSampleSize: 40 }),
      () => h.service.confirmQuota(SUPERVISOR, id(run), { expectedVersion: 1, quotaPerArm: 15 }),
      () => h.service.confirmEntryPolicy(SUPERVISOR, id(run), { expectedVersion: 1, legacyEntry: 'UNCHANGED' }),
      () => h.service.confirmInfoConsentReview(SUPERVISOR, id(run), { expectedVersion: 1, statement: INFO_CONSENT_REVIEW_STATEMENT }),
      () => h.service.confirmPresentationProfile(SUPERVISOR, id(run), { expectedVersion: 1, profileId: new ObjectId().toHexString() }),
      () => h.service.transition(SUPERVISOR, id(run), { expectedVersion: 1, to: 'OPEN' })
    ];
    for (const call of calls) await expectStudyRunError(call(), 'FORBIDDEN');
    expect(JSON.stringify([...h.store.docs.values()])).toBe(before);
    expect(h.audits).toHaveLength(0);
  });
  it('SUPERVISOR can read', async () => {
    const run = await create(h);
    expect((await h.service.get(SUPERVISOR, id(run))).code).toBe('RUN-01');
    expect(await h.service.list(SUPERVISOR)).toHaveLength(1);
  });
  it('a stale expectedVersion returns 409 STUDY_RUN_VERSION_CONFLICT and changes nothing', async () => {
    const run = await create(h);
    await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 15 });
    const calls: Array<() => Promise<unknown>> = [
      () => h.service.updateSampleSize(RESEARCHER, id(run), { expectedVersion: 1, targetSampleSize: 40 }),
      () => h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 15 }),
      () => h.service.confirmEntryPolicy(RESEARCHER, id(run), { expectedVersion: 1, legacyEntry: 'UNCHANGED' }),
      () => h.service.confirmInfoConsentReview(RESEARCHER, id(run), { expectedVersion: 1, statement: INFO_CONSENT_REVIEW_STATEMENT }),
      () => h.service.confirmPresentationProfile(RESEARCHER, id(run), { expectedVersion: 1, profileId: new ObjectId().toHexString() }),
      () => h.service.transition(RESEARCHER, id(run), { expectedVersion: 1, to: 'OPEN' })
    ];
    for (const call of calls) await expectStudyRunError(call(), 'STUDY_RUN_VERSION_CONFLICT', 409);
    const current = await h.service.get(RESEARCHER, id(run));
    expect(current.version).toBe(2);
    expect(current.targetSampleSize).toBe(30);
    expect(current.status).toBe('DRAFT');
  });
  it('every write bumps the version and writes exactly one audit entry with the actor', async () => {
    const run = await create(h);
    expect(h.audits.map((a) => a.action)).toEqual(['STUDY_RUN_CREATED']);
    const r = await h.service.confirmQuota(RESEARCHER, id(run), { expectedVersion: 1, quotaPerArm: 15 });
    expect(r.run.version).toBe(2);
    expect(r.auditLogged).toBe(true);
    const last = h.audits[h.audits.length - 1];
    expect(last.action).toBe('STUDY_RUN_QUOTA_CONFIRMED');
    expect(last.username).toBe('researcher');
    expect(last.role).toBe('RESEARCHER');
    expect(last.targetType).toBe('study_run');
    expect(last.targetId).toBe(id(run));
  });
  it('a failed audit does not fail a committed write (reported via auditLogged=false)', async () => {
    const h2 = makeHarness();
    h2.deps.audit = { record: async () => { throw new Error('audit down'); } };
    const { StudyRunService } = await import('@/lib/services/study-run.service');
    const svc = new StudyRunService(h2.deps);
    const r = await svc.create(RESEARCHER, base(h2));
    expect(r.auditLogged).toBe(false);
    expect(h2.store.docs.size).toBe(1);
  });
  it('unknown id is 404', async () => {
    await expectStudyRunError(h.service.get(RESEARCHER, new ObjectId().toHexString()), 'STUDY_RUN_NOT_FOUND', 404);
    await expectStudyRunError(h.service.get(RESEARCHER, 'not-an-id'), 'STUDY_RUN_NOT_FOUND', 404);
  });
});

describe('AC-26 Information/Consent confirmation', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('stores who, when, versions and SHA-256 of the three texts, and audits; texts are not modified', async () => {
    const run = await create(h);
    const configBefore = JSON.stringify(h.state.config);
    const r = await h.service.confirmInfoConsentReview(RESEARCHER, id(run), { expectedVersion: 1, statement: INFO_CONSENT_REVIEW_STATEMENT });
    const review = r.run.infoConsentReview!;
    expect(review.confirmedBy).toBe('researcher');
    expect(review.confirmedAt === null).toBe(false);
    expect([review.informationVersion, review.consentVersion, review.debriefVersion]).toEqual(['info-v1', 'consent-v1', 'debrief-v1']);
    expect(review.informationSha256).toBe(sha256Hex('Information text v1'));
    expect(review.consentSha256).toBe(sha256Hex('Consent text v1'));
    expect(review.debriefSha256).toBe(sha256Hex('Debrief text v1'));
    expect(review.informationSha256).toHaveLength(64);
    expect(h.audits[h.audits.length - 1].action).toBe('STUDY_RUN_INFO_CONSENT_REVIEWED');
    expect(JSON.stringify(h.state.config)).toBe(configBefore);
  });
  it('requires the exact confirmation statement', async () => {
    const run = await create(h);
    let rejected = false;
    try { await h.service.confirmInfoConsentReview(RESEARCHER, id(run), { expectedVersion: 1, statement: 'ok' }); } catch { rejected = true; }
    expect(rejected).toBe(true);
    expect((await h.service.get(RESEARCHER, id(run))).infoConsentReview).toBeNull();
  });
  it('is refused while Information/Consent/Debrief are not configured', async () => {
    h.state.config = fixtureConfig({ consentText: null, debriefVersion: null });
    const run = await create(h);
    const details = await expectStudyRunError(h.service.confirmInfoConsentReview(RESEARCHER, id(run), { expectedVersion: 1, statement: INFO_CONSENT_REVIEW_STATEMENT }), 'STUDY_RUN_PROTOCOL_NOT_READY', 409);
    expect(details).toContain('CONSENT_WORDING');
    expect(details).toContain('DEBRIEF_WORDING');
  });
  it('content changed after confirmation only WARNS (state CHANGED) and does not touch the run', async () => {
    const run = await ready(h);
    const open = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    expect(await h.service.infoConsentState(RESEARCHER, id(open))).toBe('CURRENT');
    h.state.config = fixtureConfig({ consentText: 'Consent text v1 (edited)' });
    expect(await h.service.infoConsentState(RESEARCHER, id(open))).toBe('CHANGED');
    expect((await h.service.get(RESEARCHER, id(open))).status).toBe('OPEN');
    h.state.config = fixtureConfig({ consentVersion: 'consent-v2' });
    expect(await h.service.infoConsentState(RESEARCHER, id(open))).toBe('CHANGED');
  });
  it('DRAFT -> OPEN and reopening require a confirmation that still matches', async () => {
    const run = await ready(h);
    h.state.config = fixtureConfig({ informationText: 'Information text v1 (edited)' });
    const details = await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY', 409);
    expect(details).toContain('INFO_CONSENT_CHANGED');
    h.state.config = fixtureConfig();
    const open = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    const closed = (await h.service.transition(RESEARCHER, id(open), { expectedVersion: open.version, to: 'CLOSED' })).run;
    h.state.config = fixtureConfig({ debriefText: 'Debrief changed' });
    const reopenDetails = await expectStudyRunError(h.service.transition(RESEARCHER, id(closed), { expectedVersion: closed.version, to: 'OPEN', reason: 'more data' }), 'STUDY_RUN_NOT_READY', 409);
    expect(reopenDetails).toContain('INFO_CONSENT_CHANGED');
  });
  it('a run that was never confirmed cannot OPEN', async () => {
    const run = await create(h);
    const details = await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: 1, to: 'OPEN' }), 'STUDY_RUN_NOT_READY', 409);
    expect(details).toContain('INFO_CONSENT_NOT_CONFIRMED');
    expect(details).toContain('QUOTA_NOT_CONFIRMED');
    expect(details).toContain('ENTRY_POLICY_NOT_CONFIRMED');
    expect(details).toContain('PRESENTATION_PROFILE_NOT_CONFIRMED');
  });
});

describe('AC-27 StudyRunStatus, entry policy and capability gate', () => {
  it('entry policy has no implicit default and is stored only when explicitly chosen', async () => {
    const h = makeHarness();
    const run = await create(h);
    expect(run.entryPolicy).toBeNull();
    expect(run.entryMode).toBe('INVITATION_ONLY');
    let rejected = false;
    try { await h.service.confirmEntryPolicy(RESEARCHER, id(run), { expectedVersion: 1 }); } catch { rejected = true; }
    expect(rejected).toBe(true);
    const r = await h.service.confirmEntryPolicy(RESEARCHER, id(run), { expectedVersion: 1, legacyEntry: 'BLOCKED_WHILE_OPEN' });
    expect(r.run.entryPolicy!.legacyEntry).toBe('BLOCKED_WHILE_OPEN');
    expect(r.run.entryPolicy!.entryMode).toBe('INVITATION_ONLY');
    expect(r.run.entryPolicy!.confirmedBy).toBe('researcher');
    expect(r.run.status).toBe('DRAFT');
  });
  it('status transitions follow the approved table and each is explicit and audited', async () => {
    const h = makeHarness();
    let run = await ready(h);
    await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'PAUSED' }), 'STUDY_RUN_TRANSITION_NOT_ALLOWED', 409);
    await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'CLOSED' }), 'STUDY_RUN_TRANSITION_NOT_ALLOWED', 409);
    run = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    expect(run.status).toBe('OPEN');
    run = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'PAUSED' })).run;
    run = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    run = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'CLOSED', reason: 'target reached' })).run;
    expect(run.status).toBe('CLOSED');
    await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'PAUSED' }), 'STUDY_RUN_TRANSITION_NOT_ALLOWED', 409);
    await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_REOPEN_REASON_REQUIRED', 400);
    run = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN', reason: 'recruit more' })).run;
    expect(run.status).toBe('OPEN');
    expect(run.statusChangedBy).toBe('researcher');
    const changes = h.audits.filter((a) => a.action === 'STUDY_RUN_STATUS_CHANGED');
    expect(changes.map((a) => `${a.metadata!.from}->${a.metadata!.to}`)).toEqual(['DRAFT->OPEN', 'OPEN->PAUSED', 'PAUSED->OPEN', 'OPEN->CLOSED', 'CLOSED->OPEN']);
    expect(changes[changes.length - 1].metadata!.reason).toBe('recruit more');
  });
  it('production capabilities: all four P2–P4 capabilities are now true so a fully confirmed run can OPEN; missing capabilities still block OPEN', async () => {
    expect(STUDY_RUN_CAPABILITIES.invitationRedemption).toBe(true);
    expect(STUDY_RUN_CAPABILITIES.presentationProfile).toBe(true);
    expect(STUDY_RUN_CAPABILITIES.singleRoundFlow).toBe(true);
    expect(STUDY_RUN_CAPABILITIES.quotaRecording).toBe(true);
    expect(Object.isFrozen(STUDY_RUN_CAPABILITIES)).toBe(true);
    const h = makeHarness();
    const run = await ready(h);
    const { StudyRunService } = await import('@/lib/services/study-run.service');
    const gated = new StudyRunService({
      ...h.deps,
      capabilities: { ...ALL_CAPABILITIES, singleRoundFlow: false, quotaRecording: false }
    });
    const details = await expectStudyRunError(gated.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY', 409);
    for (const name of ['singleRoundFlow', 'quotaRecording']) expect(details).toContain(`CAPABILITY:${name}`);
    for (const name of ['invitationRedemption', 'presentationProfile']) expect(details.includes(`CAPABILITY:${name}`)).toBe(false);
    expect((await h.service.get(RESEARCHER, id(run))).status).toBe('DRAFT');
    const prod = new StudyRunService({ ...h.deps, capabilities: undefined });
    const opened = await prod.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' });
    expect(opened.run.status).toBe('OPEN');
  });
  it('with injected capabilities the open conditions are: quota, entry policy, info/consent, snapshot, V2 profile, capabilities', async () => {
    const h = makeHarness({ capabilities: { ...ALL_CAPABILITIES, singleRoundFlow: false } });
    const run = await ready(h);
    expect((await h.service.checkOpenReadiness(RESEARCHER, id(run))).missing).toEqual(['CAPABILITY:singleRoundFlow']);
    const h2 = makeHarness();
    const run2 = await ready(h2);
    expect(await h2.service.checkOpenReadiness(SUPERVISOR, id(run2))).toEqual({ ready: true, missing: [] });
  });
  it('snapshot problems block OPEN (package unpublished, content changed, package revision moved)', async () => {
    const h = makeHarness();
    const run = await ready(h);
    h.state.pkg = { ...h.state.pkg, status: 'ARCHIVED' as never, enabled: false };
    let d = await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY');
    expect(d).toContain('SNAPSHOT:PACKAGE_NOT_PUBLISHED');
    h.state.pkg = { ...h.state.pkg, status: 'PUBLISHED', enabled: true, revision: 4 };
    d = await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY');
    expect(d).toContain('SNAPSHOT:SNAPSHOT_MISMATCH');
    h.state.pkg = { ...h.state.pkg, revision: 3 };
    h.state.problems = ['INVALID_CONTENT'];
    d = await expectStudyRunError(h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY');
    expect(d).toContain('SNAPSHOT:INVALID_CONTENT');
  });
  it('resuming a paused run needs the quota invariant but not a fresh Info/Consent check', async () => {
    const h = makeHarness();
    const run = await ready(h);
    const open = (await h.service.transition(RESEARCHER, id(run), { expectedVersion: run.version, to: 'OPEN' })).run;
    const paused = (await h.service.transition(RESEARCHER, id(open), { expectedVersion: open.version, to: 'PAUSED' })).run;
    h.state.config = fixtureConfig({ consentText: 'changed while paused' });
    const resumed = await h.service.transition(RESEARCHER, id(paused), { expectedVersion: paused.version, to: 'OPEN' });
    expect(resumed.run.status).toBe('OPEN');
    // quota unconfirmed (sample size changed while paused) blocks resuming
    const closed = (await h.service.transition(RESEARCHER, id(resumed.run), { expectedVersion: resumed.run.version, to: 'PAUSED' })).run;
    const changed = (await h.service.updateSampleSize(RESEARCHER, id(closed), { expectedVersion: closed.version, targetSampleSize: 20 })).run;
    const d = await expectStudyRunError(h.service.transition(RESEARCHER, id(changed), { expectedVersion: changed.version, to: 'OPEN' }), 'STUDY_RUN_NOT_READY');
    expect(d).toEqual(['QUOTA_NOT_CONFIRMED']);
  });
  it('the system never changes status by itself: reading and re-evaluating leaves status and version untouched', async () => {
    const h = makeHarness();
    const run = await ready(h);
    await h.service.checkOpenReadiness(RESEARCHER, id(run));
    await h.service.infoConsentState(RESEARCHER, id(run));
    await h.service.list(RESEARCHER);
    const again = await h.service.get(RESEARCHER, id(run));
    expect(again.version).toBe(run.version);
    expect(again.status).toBe('DRAFT');
  });
});
