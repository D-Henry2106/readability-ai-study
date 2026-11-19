import { beforeEach, describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { StudyRunQuotaService } from '@/lib/services/study-run-quota.service';
import {
  armCountersEqual,
  evaluateQuotaWarnings,
  isValidSampleSize,
  proposeQuotaPerArm
} from '@/lib/study-run/quota';
import { INFO_CONSENT_REVIEW_STATEMENT, sampleSizeSchema } from '@/lib/validation/study-run-schemas';
import type { Presentation, SessionDoc, SessionStatus } from '@/types/research';
import { expectStudyRunError, makeHarness, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';

type Harness = ReturnType<typeof makeHarness>;

async function createOpenRun(h: Harness, targetSampleSize = 4) {
  let run = (await h.service.create(RESEARCHER, {
    code: 'RUN-Q',
    name: 'Quota Run',
    phase: 'MAIN',
    packageId: h.packageId.toHexString(),
    targetSampleSize
  })).run;
  const id = run._id!.toHexString();
  run = (await h.service.confirmQuota(RESEARCHER, id, {
    expectedVersion: run.version,
    quotaPerArm: targetSampleSize / 2
  })).run;
  run = (await h.service.confirmEntryPolicy(RESEARCHER, id, {
    expectedVersion: run.version,
    legacyEntry: 'UNCHANGED'
  })).run;
  run = (await h.service.confirmInfoConsentReview(RESEARCHER, id, {
    expectedVersion: run.version,
    statement: INFO_CONSENT_REVIEW_STATEMENT
  })).run;
  const profile = await h.confirmDefaultProfile();
  run = (await h.service.confirmPresentationProfile(RESEARCHER, id, {
    expectedVersion: run.version,
    profileId: profile._id!.toHexString()
  })).run;
  run = (await h.service.transition(RESEARCHER, id, {
    expectedVersion: run.version,
    to: 'OPEN'
  })).run;
  return { run, runId: id, profileId: profile._id! };
}

function makeCompletedRunSession(
  h: Harness,
  runId: ObjectId,
  id: string,
  variant: Presentation = 'V1',
  status: SessionStatus = 'COMPLETED'
): SessionDoc {
  const now = new Date('2026-11-11T08:00:00Z');
  return {
    id,
    status,
    currentStage: status === 'COMPLETED' ? 'COMPLETED' : 'TEST_1',
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
    completedAt: status === 'COMPLETED' ? now : null,
    withdrawnAt: status === 'WITHDRAWN' ? now : null
  };
}

// AC-01 (pure part): only even integers >= 2; the system proposes N/2.
describe('Study Run sample size and quota proposal (AC-01)', () => {
  it('accepts even integers >= 2, including the initial 30', () => {
    for (const n of [2, 4, 30, 100, 100000]) expect(sampleSizeSchema.safeParse(n).success).toBe(true);
  });
  it('rejects odd, zero, negative, fractional, non-finite and non-number values', () => {
    for (const n of [1, 3, 29, 0, -2, -3, 2.5, 30.0000001, NaN, Infinity, 100002, '30', null, undefined]) {
      expect(sampleSizeSchema.safeParse(n).success).toBe(false);
    }
    for (const n of [1, 0, -2, 2.5, NaN]) expect(isValidSampleSize(n)).toBe(false);
  });
  it('proposes N/2 per arm and refuses an invalid sample size', () => {
    expect(proposeQuotaPerArm(30)).toBe(15);
    expect(proposeQuotaPerArm(2)).toBe(1);
    expect(() => proposeQuotaPerArm(31)).toThrow('INVALID_SAMPLE_SIZE');
  });
  it('evaluates arm warnings and counter equality purely', () => {
    const a = { V1: { validIncluded: 2, supplementalValid: 1 }, V2: { validIncluded: 1, supplementalValid: 0 } };
    expect(armCountersEqual(a, { V1: { validIncluded: 2, supplementalValid: 1 }, V2: { validIncluded: 1, supplementalValid: 0 } })).toBe(true);
    expect(armCountersEqual(a, { V1: { validIncluded: 2, supplementalValid: 0 }, V2: { validIncluded: 1, supplementalValid: 0 } })).toBe(false);
    const warnings = evaluateQuotaWarnings(
      { targetSampleSize: 4, quotaPerArm: 2, arms: a },
      { vacancyOnArm: 'V2', counterMismatch: true }
    );
    expect(warnings).toContain('ARM_V1_QUOTA_REACHED');
    expect(warnings).toContain('ARM_V1_HAS_SUPPLEMENTAL');
    expect(warnings).toContain('ARM_V2_QUOTA_VACANCY');
    expect(warnings).toContain('QUOTA_COUNTER_MISMATCH');
    expect(warnings.includes('BOTH_ARMS_QUOTA_REACHED')).toBe(false);
  });
});

describe('StudyRunQuotaService — AC-15, AC-16, AC-17, AC-18, AC-31, AC-03 clause 3', () => {
  let h: Harness;
  let quota: StudyRunQuotaService;

  beforeEach(() => {
    h = makeHarness();
    quota = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
  });

  it('AC-15: only COMPLETED + VALID Study Run sessions are counted; ACTIVE, INCOMPLETE, WITHDRAWN, DECLINED, INVALID, REVIEW_REQUIRED are never counted', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    for (const status of ['ACTIVE', 'INCOMPLETE', 'WITHDRAWN', 'DECLINED'] as const) {
      const s = makeCompletedRunSession(h, run._id!, `s-${status}`, 'V1', status);
      h.quotaSessions.put(s);
      await expectStudyRunError(
        quota.recordValidity(RESEARCHER, s.id, { validityFlag: 'VALID', reason: null }),
        'SESSION_NOT_COMPLETED',
        409
      );
    }

    // Legacy session (no studyRunId) is refused by StudyRunQuotaService
    const legacy: SessionDoc = {
      ...makeCompletedRunSession(h, run._id!, 's-legacy', 'V1', 'COMPLETED'),
      studyRunId: undefined,
      presentationVariant: undefined,
      groupCode: 'A'
    };
    h.quotaSessions.put(legacy);
    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, legacy.id, { validityFlag: 'VALID', reason: null }),
      'SESSION_NOT_IN_STUDY_RUN',
      409
    );

    // COMPLETED session marked INVALID or REVIEW_REQUIRED sets NOT_COUNTED and leaves counters at 0
    const sInvalid = makeCompletedRunSession(h, run._id!, 's-invalid', 'V1', 'COMPLETED');
    h.quotaSessions.put(sInvalid);
    const rInv = await quota.recordValidity(RESEARCHER, sInvalid.id, { validityFlag: 'INVALID', reason: 'fast reader' });
    expect(rInv.quotaStatus).toBe('NOT_COUNTED');
    expect(rInv.counterChanged).toBe(false);

    const sRev = makeCompletedRunSession(h, run._id!, 's-rev', 'V2', 'COMPLETED');
    h.quotaSessions.put(sRev);
    const rRev = await quota.recordValidity(RESEARCHER, sRev.id, { validityFlag: 'REVIEW_REQUIRED', reason: 'needs check' });
    expect(rRev.quotaStatus).toBe('NOT_COUNTED');
    expect(rRev.counterChanged).toBe(false);

    const storedRun = await h.service.get(RESEARCHER, runId);
    expect(storedRun.arms).toEqual({
      V1: { validIncluded: 0, supplementalValid: 0 },
      V2: { validIncluded: 0, supplementalValid: 0 }
    });
  });

  it('AC-16 / AC-17 / AC-18: counts INCLUDED up to quotaPerArm, marks overflow as SUPPLEMENTAL (preserving data), warns without closing the run, and repeated/concurrent VALID calls never double-count', async () => {
    const { run, runId } = await createOpenRun(h, 4); // quotaPerArm = 2
    for (let i = 1; i <= 4; i += 1) {
      h.quotaSessions.put(makeCompletedRunSession(h, run._id!, `v1-${i}`, 'V1'));
    }

    // 20 concurrent VALID calls on the SAME session v1-1 -> counted once
    const sameSessionResults = await Promise.all(
      Array.from({ length: 20 }, () => quota.recordValidity(RESEARCHER, 'v1-1', { validityFlag: 'VALID', reason: null }))
    );
    expect(sameSessionResults.every((r) => r.quotaStatus === 'INCLUDED')).toBe(true);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // Sequential repeat on v1-1 -> idempotent, no counter change
    const repeat = await quota.recordValidity(RESEARCHER, 'v1-1', { validityFlag: 'VALID', reason: null });
    expect(repeat.quotaStatus).toBe('INCLUDED');
    expect(repeat.counterChanged).toBe(false);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // v1-2 reaches quotaPerArm = 2 -> INCLUDED + ARM_V1_QUOTA_REACHED warning, run stays OPEN
    const second = await quota.recordValidity(RESEARCHER, 'v1-2', { validityFlag: 'VALID', reason: null });
    expect(second.quotaStatus).toBe('INCLUDED');
    expect(second.warnings).toContain('ARM_V1_QUOTA_REACHED');
    expect(second.run.status).toBe('OPEN');

    // v1-3 and v1-4 exceed quotaPerArm -> kept intact and marked SUPPLEMENTAL
    const third = await quota.recordValidity(RESEARCHER, 'v1-3', { validityFlag: 'VALID', reason: null });
    expect(third.quotaStatus).toBe('SUPPLEMENTAL');
    expect(third.warnings).toContain('ARM_V1_QUOTA_REACHED');
    expect(third.warnings).toContain('ARM_V1_HAS_SUPPLEMENTAL');

    // Repeating VALID on a SUPPLEMENTAL session keeps it SUPPLEMENTAL and does not change counters
    const repeatSup = await quota.recordValidity(RESEARCHER, 'v1-3', { validityFlag: 'VALID', reason: null });
    expect(repeatSup.quotaStatus).toBe('SUPPLEMENTAL');
    expect(repeatSup.counterChanged).toBe(false);

    const fourth = await quota.recordValidity(RESEARCHER, 'v1-4', { validityFlag: 'VALID', reason: null });
    expect(fourth.quotaStatus).toBe('SUPPLEMENTAL');

    const afterV1 = await h.service.get(RESEARCHER, runId);
    expect(afterV1.status).toBe('OPEN');
    expect(afterV1.arms.V1).toEqual({ validIncluded: 2, supplementalValid: 2 });
    expect(h.quotaSessions.docs.size).toBe(4); // AC-17: no session deleted
  });

  it('AC-16 / AC-19: 20 concurrent VALID calls across 20 distinct sessions of an arm with quotaPerArm = 15 -> exactly 15 INCLUDED and 5 SUPPLEMENTAL', async () => {
    const { run, runId } = await createOpenRun(h, 30); // quotaPerArm = 15
    const ids = Array.from({ length: 20 }, (_, i) => `v1-conc-${i + 1}`);
    for (const id of ids) h.quotaSessions.put(makeCompletedRunSession(h, run._id!, id, 'V1'));

    await Promise.all(
      ids.map((id) => quota.recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null }))
    );

    const storedRun = await h.service.get(RESEARCHER, runId);
    expect(storedRun.arms.V1).toEqual({ validIncluded: 15, supplementalValid: 5 });
    const statuses = ids.map((id) => h.quotaSessions.docs.get(id)!.quotaStatus);
    expect(statuses.filter((s) => s === 'INCLUDED')).toHaveLength(15);
    expect(statuses.filter((s) => s === 'SUPPLEMENTAL')).toHaveLength(5);

    // Fill V2 with 15 sessions -> BOTH_ARMS_QUOTA_REACHED warning, run stays OPEN
    for (let i = 1; i <= 15; i += 1) {
      const id = `v2-${i}`;
      h.quotaSessions.put(makeCompletedRunSession(h, run._id!, id, 'V2'));
      const res = await quota.recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null });
      if (i === 15) {
        expect(res.warnings).toContain('ARM_V1_QUOTA_REACHED');
        expect(res.warnings).toContain('ARM_V2_QUOTA_REACHED');
        expect(res.warnings).toContain('BOTH_ARMS_QUOTA_REACHED');
      }
    }
    const finalRun = await h.service.get(RESEARCHER, runId);
    expect(finalRun.status).toBe('OPEN');
    expect(finalRun.arms).toEqual({
      V1: { validIncluded: 15, supplementalValid: 5 },
      V2: { validIncluded: 15, supplementalValid: 0 }
    });
    const rec = await quota.reconcile(SUPERVISOR, runId);
    expect(rec.matches).toBe(true);
  });

  it('AC-31: full §6.4 matrix — VALID -> INVALID/REVIEW_REQUIRED updates the exact prior counter, is idempotent, warns on vacancy without auto-promoting SUPPLEMENTAL, and only explicit includeSupplemental promotes', async () => {
    const { run, runId } = await createOpenRun(h, 4); // quotaPerArm = 2
    for (const id of ['s1', 's2', 's3']) {
      h.quotaSessions.put(makeCompletedRunSession(h, run._id!, id, 'V1'));
      await quota.recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null });
    }
    // s1: INCLUDED, s2: INCLUDED, s3: SUPPLEMENTAL
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 1 });

    // Cannot promote s3 while quota is full (2/2)
    await expectStudyRunError(quota.includeSupplemental(RESEARCHER, 's3'), 'STUDY_RUN_QUOTA_FULL', 409);

    // Row 4: Demote s1 (INCLUDED) -> INVALID: validIncluded 2 -> 1, emits ARM_V1_QUOTA_VACANCY, s3 stays SUPPLEMENTAL
    const demoteIncluded = await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'INVALID', reason: 'noise' });
    expect(demoteIncluded.previousQuotaStatus).toBe('INCLUDED');
    expect(demoteIncluded.quotaStatus).toBe('NOT_COUNTED');
    expect(demoteIncluded.counterChanged).toBe(true);
    expect(demoteIncluded.warnings).toContain('ARM_V1_QUOTA_VACANCY');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });
    expect(h.quotaSessions.docs.get('s3')!.quotaStatus).toBe('SUPPLEMENTAL'); // NOT auto-promoted!

    // Row 6: Repeating INVALID or REVIEW_REQUIRED on s1 (already NOT_COUNTED) -> idempotent, counters stay {1, 1}
    const repeatInvalid = await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'INVALID', reason: 'noise again' });
    expect(repeatInvalid.quotaStatus).toBe('NOT_COUNTED');
    expect(repeatInvalid.counterChanged).toBe(false);
    const toReview = await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'REVIEW_REQUIRED', reason: 're-review' });
    expect(toReview.quotaStatus).toBe('NOT_COUNTED');
    expect(toReview.counterChanged).toBe(false);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });

    // Row 7: Explicit Admin action includeSupplemental promotes s3 (VALID + SUPPLEMENTAL -> INCLUDED)
    await expectStudyRunError(quota.includeSupplemental(RESEARCHER, 's1'), 'QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
    await expectStudyRunError(quota.includeSupplemental(RESEARCHER, 's2'), 'QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
    const promoted = await quota.includeSupplemental(RESEARCHER, 's3');
    expect(promoted.previousQuotaStatus).toBe('SUPPLEMENTAL');
    expect(promoted.quotaStatus).toBe('INCLUDED');
    expect(promoted.session.quotaStatus).toBe('INCLUDED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 0 });

    // Re-marking s1 as VALID now that quota is full again -> s1 becomes SUPPLEMENTAL
    const revalidS1 = await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'VALID', reason: null });
    expect(revalidS1.quotaStatus).toBe('SUPPLEMENTAL');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 1 });

    // Row 5: Demote s1 (SUPPLEMENTAL) -> REVIEW_REQUIRED: supplementalValid 1 -> 0, validIncluded stays 2
    const demoteSup = await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'REVIEW_REQUIRED', reason: 'check again' });
    expect(demoteSup.previousQuotaStatus).toBe('SUPPLEMENTAL');
    expect(demoteSup.quotaStatus).toBe('NOT_COUNTED');
    expect(demoteSup.counterChanged).toBe(true);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 0 });
  });

  it('AC-03 clause 3: SUPERVISOR is FORBIDDEN on all quota writes; reconciliation is read-only and detects counter drift', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's1', 'V1'));
    await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'VALID', reason: null });

    const beforeRun = JSON.stringify(await h.service.get(RESEARCHER, runId));
    const beforeSession = JSON.stringify(await h.quotaSessions.getSession('s1'));

    await expectStudyRunError(
      quota.recordValidity(SUPERVISOR, 's1', { validityFlag: 'INVALID', reason: 'forbidden' }),
      'FORBIDDEN'
    );
    await expectStudyRunError(quota.includeSupplemental(SUPERVISOR, 's1'), 'FORBIDDEN');

    expect(JSON.stringify(await h.service.get(RESEARCHER, runId))).toBe(beforeRun);
    expect(JSON.stringify(await h.quotaSessions.getSession('s1'))).toBe(beforeSession);

    // SUPERVISOR can run read-only reconciliation
    const cleanRec = await quota.reconcile(SUPERVISOR, runId);
    expect(cleanRec.matches).toBe(true);
    expect(cleanRec.warnings.includes('QUOTA_COUNTER_MISMATCH')).toBe(false);

    // Simulate counter drift in study_runs and verify reconcile only warns without mutating study_runs or sessions
    h.store.setArmsForTest(run._id!, {
      V1: { validIncluded: 2, supplementalValid: 0 },
      V2: { validIncluded: 0, supplementalValid: 0 }
    });
    const drifted = await quota.reconcile(RESEARCHER, runId);
    expect(drifted.matches).toBe(false);
    expect(drifted.stored.V1.validIncluded).toBe(2);
    expect(drifted.counted.V1.validIncluded).toBe(1);
    expect(drifted.warnings).toContain('QUOTA_COUNTER_MISMATCH');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1.validIncluded).toBe(2); // read-only: did not overwrite
  });
});

describe('StudyRunQuotaService — deterministic CAS interleaving, rollback & crash recovery tests (§8 rule 3, Sections C1, C2, C3, I)', () => {
  let h: Harness;
  let quota: StudyRunQuotaService;

  beforeEach(() => {
    h = makeHarness();
    quota = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
  });

  it('Interleaving 1: a concurrent INVALID decision injected between Step 2 (counter claim) and Step 3 (session finalize) of VALID rolls back the counter increment', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-race-1', 'V1'));

    const originalApply = h.store.applyQuotaCounterTransition.bind(h.store);
    let injected = false;
    h.store.applyQuotaCounterTransition = async (id, variant, transition, transitionId) => {
      const updated = await originalApply(id, variant, transition, transitionId);
      if (!injected && transition === 'CLAIM_INCLUDED') {
        injected = true;
        // Another Admin marks the session INVALID right after the counter was incremented, before Step 3 finalizes quotaStatus
        await quota.recordValidity(RESEARCHER, 's-race-1', { validityFlag: 'INVALID', reason: 'interleaved invalidation' });
      }
      return updated;
    };

    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-race-1', { validityFlag: 'VALID', reason: null }),
      'STUDY_RUN_QUOTA_CONFLICT',
      409
    );

    const finalSession = (await h.quotaSessions.getSession('s-race-1'))!;
    expect(finalSession.validityFlag).toBe('INVALID');
    expect(finalSession.quotaStatus).toBe('NOT_COUNTED');
    const finalRun = await h.service.get(RESEARCHER, runId);
    expect(finalRun.arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });
    expect((await quota.reconcile(RESEARCHER, runId)).matches).toBe(true);
  });

  it('Interleaving 2: two SUPPLEMENTAL sessions racing for 1 open quota slot in includeSupplemental -> exactly one becomes INCLUDED, the other reverts to SUPPLEMENTAL with 409', async () => {
    const { run, runId } = await createOpenRun(h, 4); // quotaPerArm = 2
    for (const id of ['s1', 's2', 's3', 's4']) {
      h.quotaSessions.put(makeCompletedRunSession(h, run._id!, id, 'V1'));
      await quota.recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null });
    }
    // Free 1 slot: s1 -> INVALID (validIncluded: 2 -> 1, supplementalValid: 2 [s3, s4])
    await quota.recordValidity(RESEARCHER, 's1', { validityFlag: 'INVALID', reason: 'drop s1' });
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 2 });

    // Deterministically interleave s4's promotion right after s3 claims Step 1 on sessions
    const originalClaim = h.quotaSessions.claimSupplementalQuotaPromotion.bind(h.quotaSessions);
    let injected = false;
    h.quotaSessions.claimSupplementalQuotaPromotion = async (input) => {
      const claimed = await originalClaim(input);
      if (!injected && input.sessionId === 's3') {
        injected = true;
        await quota.includeSupplemental(RESEARCHER, 's4'); // s4 takes the only open slot on study_runs
      }
      return claimed;
    };

    await expectStudyRunError(quota.includeSupplemental(RESEARCHER, 's3'), 'STUDY_RUN_QUOTA_FULL', 409);

    expect((await h.quotaSessions.getSession('s4'))!.quotaStatus).toBe('INCLUDED');
    expect((await h.quotaSessions.getSession('s3'))!.quotaStatus).toBe('SUPPLEMENTAL');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 1 });
    expect((await quota.reconcile(RESEARCHER, runId)).matches).toBe(true);
  });

  it('Interleaving 3: sample size changed (unconfirming quotaPerArm) between session claim and counter claim rolls back the session claim cleanly', async () => {
    const { run, runId } = await createOpenRun(h, 4);
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-unconfirm', 'V1'));

    // Pause run so sample size can be changed
    const paused = (await h.service.transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'PAUSED' })).run;

    const originalClaim = h.quotaSessions.claimRunSessionQuotaTransition.bind(h.quotaSessions);
    let injected = false;
    h.quotaSessions.claimRunSessionQuotaTransition = async (input) => {
      const res = await originalClaim(input);
      if (!injected && input.nextValidityFlag === 'VALID') {
        injected = true;
        // Another Admin changes sample size right after Step 1, resetting quotaPerArm to null
        await h.service.updateSampleSize(RESEARCHER, runId, { expectedVersion: paused.version, targetSampleSize: 6 });
      }
      return res;
    };

    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-unconfirm', { validityFlag: 'VALID', reason: null }),
      'STUDY_RUN_QUOTA_NOT_CONFIRMED',
      409
    );

    const restored = (await h.quotaSessions.getSession('s-unconfirm'))!;
    expect(restored.validityFlag).toBe('REVIEW_REQUIRED');
    expect(restored.quotaStatus).toBeUndefined();
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });
  });

  it('Section C3: demotion rollback (VALID -> INVALID/REVIEW_REQUIRED when counter release fails) matches post-CAS state, restores all 10 session fields, and fails explicitly if rollback CAS misses', async () => {
    const { run } = await createOpenRun(h, 4);
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-demote-rollback', 'V1'));
    await quota.recordValidity(RESEARCHER, 's-demote-rollback', { validityFlag: 'VALID', reason: null });

    const beforeDemote = (await h.quotaSessions.getSession('s-demote-rollback'))!;
    expect(beforeDemote.validityFlag).toBe('VALID');
    expect(beforeDemote.quotaStatus).toBe('INCLUDED');
    expect(beforeDemote.validityHistory).toHaveLength(1);

    // Simulate counter drift to 0 so RELEASE_INCLUDED fails precondition
    h.store.setArmsForTest(run._id!, {
      V1: { validIncluded: 0, supplementalValid: 0 },
      V2: { validIncluded: 0, supplementalValid: 0 }
    });

    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-demote-rollback', { validityFlag: 'INVALID', reason: 'try demote' }),
      'STUDY_RUN_QUOTA_COUNTER_CONFLICT',
      409
    );

    const afterRollback = (await h.quotaSessions.getSession('s-demote-rollback'))!;
    expect(afterRollback.validityFlag).toBe('VALID');
    expect(afterRollback.validityReason).toBeNull();
    expect(afterRollback.validityReviewedBy).toBe(beforeDemote.validityReviewedBy);
    expect(afterRollback.validityReviewedAt?.getTime()).toBe(beforeDemote.validityReviewedAt?.getTime());
    expect(afterRollback.validityChecklistVersion).toBe(beforeDemote.validityChecklistVersion);
    expect(afterRollback.quotaStatus).toBe('INCLUDED');
    expect(afterRollback.quotaRecordedAt?.getTime()).toBe(beforeDemote.quotaRecordedAt?.getTime());
    expect(afterRollback.quotaRecordedBy).toBe(beforeDemote.quotaRecordedBy);
    expect(afterRollback.updatedAt.getTime()).toBe(beforeDemote.updatedAt.getTime());
    expect(afterRollback.validityHistory).toEqual(beforeDemote.validityHistory);
    expect(afterRollback.quotaTransition).toBeNull();

    // If rollback CAS itself returns null, throws STUDY_RUN_QUOTA_ROLLBACK_FAILED instead of ignoring
    const originalRevert = h.quotaSessions.revertRunSessionValidityClaim.bind(h.quotaSessions);
    h.quotaSessions.revertRunSessionValidityClaim = async () => null;
    await expectStudyRunError(
      quota.recordValidity(RESEARCHER, 's-demote-rollback', { validityFlag: 'REVIEW_REQUIRED', reason: 'rollback fail' }),
      'STUDY_RUN_QUOTA_ROLLBACK_FAILED',
      409
    );
    h.quotaSessions.revertRunSessionValidityClaim = originalRevert;
  });

  it('Sections C1, C2, I: crash recovery across a new StudyRunQuotaService instance for VALID_CLAIM, DEMOTE_VALID, and PROMOTE_SUPPLEMENTAL without double counting', async () => {
    const { run, runId } = await createOpenRun(h, 2); // quotaPerArm = 1
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-crash-1', 'V1'));
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-crash-2', 'V1'));

    // 1. Crash after session CAS (before counter update) on s-crash-1
    const origApply = h.store.applyQuotaCounterTransition.bind(h.store);
    let failStep2Once = true;
    h.store.applyQuotaCounterTransition = async (id, variant, transition, transitionId) => {
      if (failStep2Once) {
        failStep2Once = false;
        throw new Error('CRASH_AFTER_SESSION_CAS');
      }
      return origApply(id, variant, transition, transitionId);
    };

    await expect(
      quota.recordValidity(RESEARCHER, 's-crash-1', { validityFlag: 'VALID', reason: null })
    ).rejects.toThrow('CRASH_AFTER_SESSION_CAS');

    expect((await h.quotaSessions.getSession('s-crash-1'))!.quotaTransition?.state).toBe('PENDING');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });

    // New service instance recovers s-crash-1 -> INCLUDED, validIncluded = 1
    const quotaInstance2 = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
    const rec1 = await quotaInstance2.recordValidity(RESEARCHER, 's-crash-1', { validityFlag: 'VALID', reason: null });
    expect(rec1.quotaStatus).toBe('INCLUDED');
    expect(rec1.session.quotaTransition?.state).toBe('RECOVERED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // 2. Crash after counter update (before session finalize) on s-crash-2 (which becomes SUPPLEMENTAL since quotaPerArm = 1)
    const origFinalize = h.quotaSessions.finalizeRunSessionQuotaStatus.bind(h.quotaSessions);
    let failStep3Once = true;
    h.quotaSessions.finalizeRunSessionQuotaStatus = async (input) => {
      if (failStep3Once) {
        failStep3Once = false;
        throw new Error('CRASH_AFTER_COUNTER_UPDATE');
      }
      return origFinalize(input);
    };

    await expect(
      quotaInstance2.recordValidity(RESEARCHER, 's-crash-2', { validityFlag: 'VALID', reason: null })
    ).rejects.toThrow('CRASH_AFTER_COUNTER_UPDATE');

    // Counter was already incremented to supplementalValid = 1, but session quotaStatus is not finalized yet
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });
    expect((await h.quotaSessions.getSession('s-crash-2'))!.quotaStatus).toBeUndefined();
    expect((await h.quotaSessions.getSession('s-crash-2'))!.quotaTransition?.state).toBe('PENDING');

    // New service instance 3 recovers s-crash-2 WITHOUT incrementing supplementalValid a second time!
    const quotaInstance3 = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
    const rec2 = await quotaInstance3.recordValidity(RESEARCHER, 's-crash-2', { validityFlag: 'VALID', reason: null });
    expect(rec2.quotaStatus).toBe('SUPPLEMENTAL');
    expect(rec2.session.quotaTransition?.state).toBe('RECOVERED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });

    // 3. Crash after session demotion (DEMOTE_VALID Step 2 committed, crash before Step 3 finalize) on s-crash-1
    failStep3Once = true;
    await expect(
      quotaInstance3.recordValidity(RESEARCHER, 's-crash-1', { validityFlag: 'INVALID', reason: 'demote crash' })
    ).rejects.toThrow('CRASH_AFTER_COUNTER_UPDATE');

    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 1 });
    expect((await h.quotaSessions.getSession('s-crash-1'))!.quotaTransition?.state).toBe('PENDING');

    const quotaInstance4 = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
    const recDemote = await quotaInstance4.recordValidity(RESEARCHER, 's-crash-1', {
      validityFlag: 'INVALID',
      reason: 'demote crash'
    });
    expect(recDemote.quotaStatus).toBe('NOT_COUNTED');
    expect(recDemote.session.quotaTransition?.state).toBe('RECOVERED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 1 });

    // 4. Crash during supplemental promotion (after PROMOTE_SUPPLEMENTAL counter update, before session finalize) on s-crash-2
    const origFinalizeSup = h.quotaSessions.finalizeSupplementalQuotaPromotion.bind(h.quotaSessions);
    let failSupFinalizeOnce = true;
    h.quotaSessions.finalizeSupplementalQuotaPromotion = async (input) => {
      if (failSupFinalizeOnce) {
        failSupFinalizeOnce = false;
        throw new Error('CRASH_IN_SUPPLEMENTAL_PROMOTION');
      }
      return origFinalizeSup(input);
    };

    await expect(quotaInstance4.includeSupplemental(RESEARCHER, 's-crash-2')).rejects.toThrow(
      'CRASH_IN_SUPPLEMENTAL_PROMOTION'
    );
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });
    expect((await h.quotaSessions.getSession('s-crash-2'))!.quotaStatus).toBe('SUPPLEMENTAL');
    expect((await h.quotaSessions.getSession('s-crash-2'))!.quotaTransition?.state).toBe('PENDING');

    const quotaInstance5 = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: h.deps.audit
    });
    const recSup = await quotaInstance5.includeSupplemental(RESEARCHER, 's-crash-2');
    expect(recSup.quotaStatus).toBe('INCLUDED');
    expect(recSup.session.quotaStatus).toBe('INCLUDED');
    expect(recSup.session.quotaTransition?.state).toBe('RECOVERED');
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });
    expect((await quotaInstance5.reconcile(SUPERVISOR, runId)).matches).toBe(true);
  });

  it('Section C2: waitForInFlightValidClaim reflects actual auditLogged = false when audit recording fails', async () => {
    const { run } = await createOpenRun(h, 2); // quotaPerArm = 1
    h.quotaSessions.put(makeCompletedRunSession(h, run._id!, 's-audit-fail', 'V1'));

    const failingAuditQuota = new StudyRunQuotaService({
      runs: h.store,
      sessions: h.quotaSessions,
      audit: {
        record: async () => {
          throw new Error('AUDIT_DB_DOWN');
        }
      }
    });

    const results = await Promise.all([
      failingAuditQuota.recordValidity(RESEARCHER, 's-audit-fail', { validityFlag: 'VALID', reason: null }),
      failingAuditQuota.recordValidity(RESEARCHER, 's-audit-fail', { validityFlag: 'VALID', reason: null })
    ]);
    expect(results.every((r) => r.quotaStatus === 'INCLUDED')).toBe(true);
    expect(results.every((r) => r.auditLogged === false)).toBe(true);
  });
});
