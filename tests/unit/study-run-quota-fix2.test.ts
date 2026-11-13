import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { StudyRunQuotaService } from '@/lib/services/study-run-quota.service';
import { hasSettlingRelease } from '@/lib/study-run/quota';
import type { Presentation, SessionDoc } from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';
import { expectStudyRunError, makeHarness, RESEARCHER } from '../helpers/study-run-fakes';

type Harness = ReturnType<typeof makeHarness>;

async function createOpenRun(h: Harness, targetSampleSize = 4) {
  let run = (await h.service.create(RESEARCHER, {
    code: 'RUN-FIX2',
    name: 'Quota Fix2',
    phase: 'MAIN',
    packageId: h.packageId.toHexString(),
    targetSampleSize
  })).run;
  const id = run._id!.toHexString();
  run = (await h.service.confirmQuota(RESEARCHER, id, { expectedVersion: run.version, quotaPerArm: targetSampleSize / 2 })).run;
  run = (await h.service.confirmEntryPolicy(RESEARCHER, id, { expectedVersion: run.version, legacyEntry: 'UNCHANGED' })).run;
  const { INFO_CONSENT_REVIEW_STATEMENT } = await import('@/lib/validation/study-run-schemas');
  run = (await h.service.confirmInfoConsentReview(RESEARCHER, id, { expectedVersion: run.version, statement: INFO_CONSENT_REVIEW_STATEMENT })).run;
  const profile = await h.confirmDefaultProfile();
  run = (await h.service.confirmPresentationProfile(RESEARCHER, id, { expectedVersion: run.version, profileId: profile._id!.toHexString() })).run;
  run = (await h.service.transition(RESEARCHER, id, { expectedVersion: run.version, to: 'OPEN' })).run;
  return { run, runId: id };
}

function completedSession(h: Harness, runId: ObjectId, id: string, variant: Presentation = 'V1'): SessionDoc {
  const now = new Date('2026-11-11T08:00:00Z');
  return {
    id,
    status: 'COMPLETED',
    currentStage: 'COMPLETED',
    groupCode: null,
    contentRevisionId: h.contentId,
    questionSetId: h.questionSetId,
    assignedPackageId: h.packageId,
    assignedPackageRevision: 3,
    assignedPackageCode: 'FIXTURE_MAIN',
    informationVersion: 'info-v1',
    consentVersion: 'consent-v1',
    debriefVersion: 'debrief-v1',
    minimumReadingSeconds: 1,
    phase: 'MAIN',
    deviceType: 'desktop',
    validityFlag: 'REVIEW_REQUIRED',
    validityReason: null,
    studyRunId: runId,
    invitationId: new ObjectId(),
    presentationVariant: variant,
    presentationVersion: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    withdrawnAt: null
  };
}

describe('hasSettlingRelease (pure ownership check used by every counter compensation)', () => {
  const t = (n: number) => new Date(2026, 10, 11, 8, 0, n);
  const ledger: StudyRunDoc['quotaLedger'] = {
    a: { transitionId: 'a', variant: 'V1', transition: 'CLAIM_INCLUDED', outcome: 'INCLUDED', appliedAt: t(1), sessionId: 's1', claimedAt: t(1) },
    d: { transitionId: 'd', variant: 'V1', transition: 'RELEASE_INCLUDED', outcome: 'NOT_COUNTED', appliedAt: t(5), sessionId: 's1', claimedAt: t(5) },
    other: { transitionId: 'other', variant: 'V1', transition: 'RELEASE_INCLUDED', outcome: 'NOT_COUNTED', appliedAt: t(9), sessionId: 's2', claimedAt: t(9) },
    legacy: { transitionId: 'legacy', variant: 'V1', transition: 'RELEASE_INCLUDED', outcome: 'NOT_COUNTED', appliedAt: t(9) }
  };
  it('is true only for a release of the SAME session claimed at/after the compensated claim', () => {
    expect(hasSettlingRelease(ledger, 's1', t(1))).toBe(true);
    expect(hasSettlingRelease(ledger, 's1', t(6))).toBe(false); // that release belongs to an older claim
    expect(hasSettlingRelease(ledger, 's3', t(1))).toBe(false); // another session's release never counts
    expect(hasSettlingRelease(undefined, 's1', t(1))).toBe(false);
  });
});

describe('P4 fix 2 — rollback ownership (concurrent recovery + demotion)', () => {
  let h: Harness;
  let quota: StudyRunQuotaService;
  let quotaB: StudyRunQuotaService;

  beforeEach(() => {
    h = makeHarness();
    quota = new StudyRunQuotaService({ runs: h.store, sessions: h.quotaSessions, audit: h.deps.audit });
    quotaB = new StudyRunQuotaService({ runs: h.store, sessions: h.quotaSessions, audit: h.deps.audit });
  });

  it('VALID claim: request A must not release a slot that request B already released (other session keeps its slot)', async () => {
    const { run, runId } = await createOpenRun(h, 4); // quotaPerArm = 2
    h.quotaSessions.put(completedSession(h, run._id!, 's-other'));
    await quota.recordValidity(RESEARCHER, 's-other', { validityFlag: 'VALID', reason: null }); // validIncluded = 1
    h.quotaSessions.put(completedSession(h, run._id!, 's-race'));

    const originalApply = h.store.applyQuotaCounterTransition.bind(h.store);
    let injected = false;
    h.store.applyQuotaCounterTransition = async (id, variant, transition, transitionId, options) => {
      const updated = await originalApply(id, variant, transition, transitionId, options);
      if (!injected && transition === 'CLAIM_INCLUDED' && options?.sessionId === 's-race') {
        injected = true;
        // Another server instance recovers A's pending transition, then demotes the session and releases the slot.
        await quotaB.recordValidity(RESEARCHER, 's-race', { validityFlag: 'INVALID', reason: 'B demotes' });
      }
      return updated;
    };

    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-race', { validityFlag: 'VALID', reason: null }),
      'STUDY_RUN_QUOTA_CONFLICT',
      409
    );

    expect((await h.quotaSessions.getSession('s-race'))!.validityFlag).toBe('INVALID');
    expect((await h.quotaSessions.getSession('s-other'))!.quotaStatus).toBe('INCLUDED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });
    expect((await quota.reconcile(RESEARCHER, runId)).matches).toBe(true);
    const ledgerKeys = Object.keys((await h.service.get(RESEARCHER, runId)).quotaLedger ?? {});
    expect(ledgerKeys.some((k) => k.endsWith(':rollback'))).toBe(false);
  });

  it('supplemental promotion: request A must not revert a promotion that B already released through a demotion', async () => {
    const { run, runId } = await createOpenRun(h, 4); // quotaPerArm = 2
    for (const id of ['s1', 's2', 's3', 's4']) {
      h.quotaSessions.put(completedSession(h, run._id!, id));
      await quota.recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null });
    }
    await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'INVALID', reason: 'free a slot' }); // {1 included, 2 supplemental}

    const originalApply = h.store.applyQuotaCounterTransition.bind(h.store);
    let injected = false;
    h.store.applyQuotaCounterTransition = async (id, variant, transition, transitionId, options) => {
      const updated = await originalApply(id, variant, transition, transitionId, options);
      if (!injected && transition === 'PROMOTE_SUPPLEMENTAL') {
        injected = true;
        await quotaB.recordValidity(RESEARCHER, 's3', { validityFlag: 'INVALID', reason: 'B demotes the promoted session' });
      }
      return updated;
    };

    await expectStudyRunError(quota.includeSupplemental(RESEARCHER, 's3'), 'QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);

    expect((await h.quotaSessions.getSession('s3'))!.validityFlag).toBe('INVALID');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });
    expect((await quota.reconcile(RESEARCHER, runId)).matches).toBe(true);
  });

  it('a rolled-back transition that is recovered later is reverted, never finalized', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    h.quotaSessions.put(completedSession(h, run._id!, 's-rb'));
    // A: counter applied, then compensated by A itself (legit rollback), but the session still shows A as PENDING.
    const originalFinalize = h.quotaSessions.finalizeRunSessionQuotaStatus.bind(h.quotaSessions);
    h.quotaSessions.finalizeRunSessionQuotaStatus = async () => null; // A's finalize misses
    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-rb', { validityFlag: 'VALID', reason: null }),
      'STUDY_RUN_QUOTA_CONFLICT',
      409
    );
    h.quotaSessions.finalizeRunSessionQuotaStatus = originalFinalize;
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });
    expect((await h.quotaSessions.getSession('s-rb'))!.quotaTransition?.state).toBe('PENDING');

    await expectStudyRunError(quotaB.recoverSession(RESEARCHER, 's-rb'), 'STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);

    const after = (await h.quotaSessions.getSession('s-rb'))!;
    expect(after.quotaStatus).toBeUndefined();
    expect(after.quotaTransition ?? null).toBe(null);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });
    expect((await quota.reconcile(RESEARCHER, runId)).matches).toBe(true);
  });
});

describe('P4 fix 2 — audit is recoverable after a crash between finalize and audit', () => {
  let h: Harness;
  let healthy: StudyRunQuotaService;
  let crashing: StudyRunQuotaService;

  beforeEach(() => {
    h = makeHarness();
    healthy = new StudyRunQuotaService({ runs: h.store, sessions: h.quotaSessions, audit: h.deps.audit });
    crashing = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: { record: async () => { throw new Error('CRASH_BEFORE_AUDIT'); } }
    });
  });

  const transitionAudits = (sessionId: string) =>
    h.audits.filter((a) => a.dedupeKey?.startsWith('quota-transition:') && a.targetId === sessionId);

  it('a COMMITTED transition without audit is repaired exactly once by recovery, with the metadata of that transition', async () => {
    const { run } = await createOpenRun(h, 4);
    h.quotaSessions.put(completedSession(h, run._id!, 's-audit'));

    const result = await crashing.recordValidity(RESEARCHER, 's-audit', { validityFlag: 'VALID', reason: null });
    expect(result.quotaStatus).toBe('INCLUDED');
    expect(result.auditLogged).toBe(false);
    const committed = (await h.quotaSessions.getSession('s-audit'))!;
    expect(committed.quotaTransition?.state).toBe('COMMITTED');
    expect(committed.quotaTransition?.auditLogged).toBe(false);
    expect(transitionAudits('s-audit')).toHaveLength(0);

    expect(await healthy.recoverSession(RESEARCHER, 's-audit')).toBe(null);
    const repaired = transitionAudits('s-audit');
    expect(repaired).toHaveLength(1);
    expect(repaired[0].action).toBe('VALIDITY_CHANGED');
    expect(repaired[0].metadata).toMatchObject({ previousFlag: 'REVIEW_REQUIRED', validityFlag: 'VALID', quotaStatus: 'INCLUDED', counterChanged: true });
    expect((await h.quotaSessions.getSession('s-audit'))!.quotaTransition?.auditLogged).toBe(true);

    await healthy.recoverSession(RESEARCHER, 's-audit');
    expect(transitionAudits('s-audit')).toHaveLength(1);
  });

  it('a new transition cannot overwrite a settled one that still owes its audit; it repairs it first', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    h.quotaSessions.put(completedSession(h, run._id!, 's-owed'));
    await crashing.recordValidity(RESEARCHER, 's-owed', { validityFlag: 'VALID', reason: null });

    // While audit keeps failing the demotion is refused and nothing changes.
    await expectStudyRunError(
      crashing.recordValidity(RESEARCHER, 's-owed', { validityFlag: 'INVALID', reason: 'too early' }),
      'STUDY_RUN_QUOTA_AUDIT_PENDING',
      409
    );
    expect((await h.quotaSessions.getSession('s-owed'))!.validityFlag).toBe('VALID');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // Once audit works again the owed entry is written before the demotion replaces the transition.
    const demoted = await healthy.recordValidity(RESEARCHER, 's-owed', { validityFlag: 'INVALID', reason: 'now fine' });
    expect(demoted.quotaStatus).toBe('NOT_COUNTED');
    expect(transitionAudits('s-owed')).toHaveLength(2);
    expect((await healthy.reconcile(RESEARCHER, runId)).matches).toBe(true);
  });

  it('audit written but flag update lost (crash in between): repair does not duplicate the entry', async () => {
    const { run } = await createOpenRun(h, 4);
    h.quotaSessions.put(completedSession(h, run._id!, 's-flag'));
    const originalMark = h.quotaSessions.markRunSessionQuotaAuditLogged.bind(h.quotaSessions);
    h.quotaSessions.markRunSessionQuotaAuditLogged = async () => { throw new Error('CRASH_AFTER_AUDIT'); };

    const result = await healthy.recordValidity(RESEARCHER, 's-flag', { validityFlag: 'VALID', reason: null });
    expect(result.auditLogged).toBe(true);
    expect(transitionAudits('s-flag')).toHaveLength(1);
    expect((await h.quotaSessions.getSession('s-flag'))!.quotaTransition?.auditLogged).toBe(false);

    h.quotaSessions.markRunSessionQuotaAuditLogged = originalMark;
    await healthy.recoverSession(RESEARCHER, 's-flag');
    expect(transitionAudits('s-flag')).toHaveLength(1);
    expect((await h.quotaSessions.getSession('s-flag'))!.quotaTransition?.auditLogged).toBe(true);
  });

  it('a retried VALID that observes the settled session does not add a second audit entry', async () => {
    const { run } = await createOpenRun(h, 4);
    h.quotaSessions.put(completedSession(h, run._id!, 's-retry'));
    await healthy.recordValidity(RESEARCHER, 's-retry', { validityFlag: 'VALID', reason: null });
    expect(transitionAudits('s-retry')).toHaveLength(1);
    const again = await healthy.recordValidity(RESEARCHER, 's-retry', { validityFlag: 'VALID', reason: null });
    expect(again.counterChanged).toBe(false);
    expect(transitionAudits('s-retry')).toHaveLength(1);
  });
});
