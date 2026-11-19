import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { resetAndSeedReady, withTestDb } from '../helpers/test-db';
import { expectStudyRunError, RESEARCHER, SUPERVISOR } from '../helpers/study-run-fakes';
import { InvitationService } from '@/lib/services/invitation.service';
import { InvitationRedemptionService } from '@/lib/services/invitation-redemption.service';
import { PresentationProfileService } from '@/lib/services/presentation-profile.service';
import { StudyRunService } from '@/lib/services/study-run.service';
import { StudyRunQuotaService } from '@/lib/services/study-run-quota.service';
import { SessionService } from '@/lib/services/session.service';
import { ReadingService } from '@/lib/services/reading.service';
import { ExperimentStateService } from '@/lib/services/state.service';
import { EventService } from '@/lib/services/event.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { StudyRunRepository } from '@/lib/repositories/study-run.repository';
import { reviewSessionValidity } from '@/lib/services/validity-review.service';
import { INFO_CONSENT_REVIEW_STATEMENT } from '@/lib/validation/study-run-schemas';
import { QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';

const cookie = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/auth/participant-session', () => ({
  getParticipantSessionId: async () => cookie.id,
  setParticipantSessionId: async (id: string) => { cookie.id = id; },
  clearParticipantSession: async () => { cookie.id = null; }
}));

const runs = () => new StudyRunService();
const profiles = () => new PresentationProfileService();
const invitations = () => new InvitationService({ baseUrl: () => 'https://study.example' });
const redeem = (token: string, cookieSessionId: string | null = null) =>
  new InvitationRedemptionService().redeem({ token, deviceType: 'desktop', cookieSessionId });
const quota = () => new StudyRunQuotaService();

async function createAndOpenRun(targetSampleSize = 4): Promise<{ runId: string; profileId: string }> {
  const pkg = (await withTestDb((db) => db.collection('content_packages').findOne({ code: 'FIXTURE_MAIN' })))!;
  let run = (await runs().create(RESEARCHER, {
    code: `RUN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: 'P4 Run',
    phase: 'MAIN',
    packageId: String(pkg._id),
    targetSampleSize
  })).run;
  const runId = String(run._id);
  run = (await runs().confirmQuota(RESEARCHER, runId, {
    expectedVersion: run.version,
    quotaPerArm: targetSampleSize / 2
  })).run;
  run = (await runs().confirmEntryPolicy(RESEARCHER, runId, {
    expectedVersion: run.version,
    legacyEntry: 'UNCHANGED'
  })).run;
  run = (await runs().confirmInfoConsentReview(RESEARCHER, runId, {
    expectedVersion: run.version,
    statement: INFO_CONSENT_REVIEW_STATEMENT
  })).run;
  const createdProfile = await profiles().create(RESEARCHER, { contentRevisionId: String(pkg.contentRevisionId) });
  const profileId = String(createdProfile.profile._id);
  await profiles().preview(RESEARCHER, profileId);
  await profiles().confirm(RESEARCHER, profileId);
  run = (await runs().confirmPresentationProfile(RESEARCHER, runId, {
    expectedVersion: run.version,
    profileId
  })).run;
  await runs().transition(RESEARCHER, runId, { expectedVersion: run.version, to: 'OPEN' });
  return { runId, profileId };
}

async function completeRedeemedSingleRoundSession(sessionId: string): Promise<string> {
  const repo = new ResearchRepository();
  const state = new ExperimentStateService(repo);
  const events = new EventService(repo);
  const session = (await repo.getSession(sessionId))!;

  // INFORMATION -> CONSENT -> DEMOGRAPHICS -> READING_1
  await events.add(sessionId, 'INFORMATION_SHOWN');
  await state.transition(sessionId, 'INFORMATION', 'CONSENT');
  await repo.saveConsent({
    sessionId,
    informationVersion: session.informationVersion,
    consentVersion: session.consentVersion,
    decision: 'ACCEPTED',
    decidedAt: new Date()
  });
  await events.add(sessionId, 'CONSENT_ACCEPTED');
  await state.transition(sessionId, 'CONSENT', 'DEMOGRAPHICS');
  await repo.saveDemographics({
    sessionId,
    ageRange: '21-24',
    gender: null,
    fieldOfStudy: null,
    yearOfStudy: null,
    aiUsageFrequency: null,
    onlineReadingFrequency: null,
    submittedAt: new Date()
  });
  await events.add(sessionId, 'DEMOGRAPHICS_SUBMITTED');
  await state.transition(sessionId, 'DEMOGRAPHICS', 'READING_1');

  // READING_1
  const readingSession = (await repo.getSession(sessionId))!;
  const readingSvc = new ReadingService(repo);
  await readingSvc.start(readingSession);
  await events.add(sessionId, 'READING_STARTED', 1);
  // Backdate startedAt by 5s so minimumReadingSeconds (1s in fixture) is satisfied without sleeping
  const past = new Date(Date.now() - 5000);
  await withTestDb((db) =>
    db.collection('reading_sessions').updateOne({ sessionId, roundNo: 1 }, { $set: { startedAt: past } })
  );
  const finishedReading = await readingSvc.finish(readingSession, {
    nextClickedAt: new Date(),
    scrollCount: 2,
    maxScrollDepthPercent: 100
  });
  expect(finishedReading.remainingSeconds).toBe(0);
  await events.add(sessionId, 'READING_FINISHED', 1);
  await state.transition(sessionId, 'READING_1', 'REVIEW_1');

  // REVIEW_1 -> TEST_1 -> submit via POST /api/test/submit
  await events.add(sessionId, 'TEST_REVIEW_CONFIRMED', 1);
  await state.transition(sessionId, 'REVIEW_1', 'TEST_1');
  await events.add(sessionId, 'TEST_STARTED', 1);

  const qSet = (await repo.getQuestionSetById(session.questionSetId))!;
  const answers = qSet.questions.map((q) => ({
    questionId: q.id,
    selectedOptionId: q.options.find((o) => o.isCorrect)!.id
  }));

  cookie.id = sessionId;
  const { POST } = await import('@/app/api/test/submit/route');
  const response = await POST(
    new NextRequest('https://study.example/api/test/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers })
    })
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ ok: true, nextRoute: '/complete' });
  return sessionId;
}

async function completeSingleRoundParticipantFlow(runId: string, variant: 'V1' | 'V2'): Promise<string> {
  const [inv] = (await invitations().create(RESEARCHER, { studyRunId: runId, variant, count: 1 })).issued;
  const { sessionId } = await redeem(inv.token);
  return completeRedeemedSingleRoundSession(sessionId);
}

describe('Single-Round Flow and Quota Recording on a real MongoDB (P4: AC-08, AC-09, 15..18, 31, AC-03 clause 3)', () => {
  beforeEach(async () => {
    cookie.id = null;
    await resetAndSeedReady();
  });

  it('AC-08 / AC-09 / AC-10 / AC-11: started V1 session completes all stages while Run stays PAUSED (blocking unused invitations), and V2 session completes with 1 reading, 1 test, no break, groupCode null, presentationVersion stored', async () => {
    const { runId } = await createAndOpenRun(4);
    const [invV1] = (await invitations().create(RESEARCHER, { studyRunId: runId, variant: 'V1', count: 1 })).issued;
    const [invV2] = (await invitations().create(RESEARCHER, { studyRunId: runId, variant: 'V2', count: 1 })).issued;

    // 1. Redeem invitation V1 while Run is OPEN
    const { sessionId: v1Id } = await redeem(invV1.token);

    // 2. Pause the Run
    const runDoc = await runs().get(RESEARCHER, runId);
    await runs().transition(RESEARCHER, runId, { expectedVersion: runDoc.version, to: 'PAUSED' });

    // 3. Unused invitation is blocked while Run is PAUSED
    await expect(redeem(invV2.token)).rejects.toMatchObject({ code: 'INVITATION_UNAVAILABLE' });

    // 4. Complete the already-started V1 session while the Run remains PAUSED (do NOT reopen Run first)
    await completeRedeemedSingleRoundSession(v1Id);

    // 5. Verify V1 session is COMPLETED and Run is still PAUSED
    const repo = new ResearchRepository();
    const v1Bundle = await repo.getSessionBundle(v1Id);
    expect(v1Bundle.session!.status).toBe('COMPLETED');
    expect(v1Bundle.session!.currentStage).toBe('COMPLETED');
    expect(v1Bundle.session!.groupCode).toBeNull();
    expect(v1Bundle.readings).toHaveLength(1);
    expect(v1Bundle.readings[0].presentation).toBe('V1');
    expect(v1Bundle.readings[0].presentationVersion).toBe(1);
    expect(v1Bundle.tests).toHaveLength(1);
    expect(v1Bundle.tests[0].presentation).toBe('V1');
    expect(v1Bundle.tests[0].presentationVersion).toBe(1);
    expect(v1Bundle.breakDoc).toBeNull();
    const pausedDoc = await runs().get(RESEARCHER, runId);
    expect(pausedDoc.status).toBe('PAUSED');

    // Resume Run to also verify V2 completion
    await runs().transition(RESEARCHER, runId, { expectedVersion: pausedDoc.version, to: 'OPEN' });
    const v2Id = await completeSingleRoundParticipantFlow(runId, 'V2');

    const v2Bundle = await repo.getSessionBundle(v2Id);
    expect(v2Bundle.session!.status).toBe('COMPLETED');
    expect(v2Bundle.session!.currentStage).toBe('COMPLETED');
    expect(v2Bundle.session!.groupCode).toBeNull();
    expect(v2Bundle.readings).toHaveLength(1);
    expect(v2Bundle.readings[0].roundNo).toBe(1);
    expect(v2Bundle.readings[0].presentation).toBe('V2');
    expect(v2Bundle.readings[0].presentationVersion).toBe(1);
    expect(v2Bundle.tests).toHaveLength(1);
    expect(v2Bundle.tests[0].roundNo).toBe(1);
    expect(v2Bundle.tests[0].presentation).toBe('V2');
    expect(v2Bundle.tests[0].presentationVersion).toBe(1);
    // The helper answers every question correctly, so the score equals the size of the question set (15 since P5; it was 5 before).
    const v2QuestionSet = (await repo.getQuestionSetById(v2Bundle.session!.questionSetId))!;
    expect(v2QuestionSet.questions).toHaveLength(QUESTIONS_PER_TEST);
    expect(v2Bundle.tests[0].score).toBe(v2QuestionSet.questions.length);
    expect(v2Bundle.breakDoc).toBeNull();

    // Legacy completeSessionIfReady cannot complete a session at TEST_1; completeRunSessionIfReady cannot complete a legacy session
    const legacy = await new SessionService(repo).create('desktop');
    await withTestDb((db) => db.collection('sessions').updateOne({ id: legacy.id }, { $set: { currentStage: 'TEST_1' } }));
    expect(await repo.completeRunSessionIfReady(legacy.id)).toBeNull();
    expect(await repo.completeSessionIfReady(v1Id)).toBeNull();
  });

  it('AC-15 / AC-16 / AC-17 / AC-18 / AC-31 / AC-03 clause 3: quota recording via reviewSessionValidity and StudyRunQuotaService on real MongoDB', async () => {
    const { runId } = await createAndOpenRun(4); // quotaPerArm = 2
    const s1 = await completeSingleRoundParticipantFlow(runId, 'V1');
    const s2 = await completeSingleRoundParticipantFlow(runId, 'V1');
    const s3 = await completeSingleRoundParticipantFlow(runId, 'V1');

    // AC-03 clause 3: participant completion never modified study_runs.arms or quotaStatus
    expect((await runs().get(SUPERVISOR, runId)).arms).toEqual({
      V1: { validIncluded: 0, supplementalValid: 0 },
      V2: { validIncluded: 0, supplementalValid: 0 }
    });
    expect((await new ResearchRepository().getSession(s1))!.quotaStatus).toBeUndefined();

    // 6 concurrent VALID reviews on s1 -> counted once, all 6 receive consistent finalized INCLUDED result
    const s1Reviews = await Promise.all(
      Array.from({ length: 6 }, () => reviewSessionValidity(s1, { validityFlag: 'VALID', reason: null }, RESEARCHER))
    );
    expect(s1Reviews.every((r) => r.status === 200)).toBe(true);
    for (const r of s1Reviews) {
      if (r.status === 200) {
        expect(r.body.quotaStatus).toBe('INCLUDED');
        expect(r.body.auditLogged).toBe(true);
      }
    }
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // s2 -> INCLUDED (reaches quotaPerArm = 2), s3 -> SUPPLEMENTAL
    const r2 = await reviewSessionValidity(s2, { validityFlag: 'VALID', reason: null }, RESEARCHER);
    expect(r2.status).toBe(200);
    if (r2.status === 200) {
      expect(r2.body.quotaStatus).toBe('INCLUDED');
      expect(r2.body.warnings).toContain('ARM_V1_QUOTA_REACHED');
    }
    const r3 = await reviewSessionValidity(s3, { validityFlag: 'VALID', reason: null }, RESEARCHER);
    expect(r3.status).toBe(200);
    if (r3.status === 200) {
      expect(r3.body.quotaStatus).toBe('SUPPLEMENTAL');
      expect(r3.body.warnings).toContain('ARM_V1_HAS_SUPPLEMENTAL');
    }
    expect((await runs().get(SUPERVISOR, runId)).status).toBe('OPEN'); // AC-18: stays OPEN
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 1 });

    // Demote s1 (INCLUDED -> INVALID): validIncluded 2 -> 1, warns vacancy, s3 stays SUPPLEMENTAL
    const demote = await reviewSessionValidity(s1, { validityFlag: 'INVALID', reason: 'outlier' }, RESEARCHER);
    expect(demote.status).toBe(200);
    if (demote.status === 200) {
      expect(demote.body.quotaStatus).toBe('NOT_COUNTED');
      expect(demote.body.warnings).toContain('ARM_V1_QUOTA_VACANCY');
    }
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });
    expect((await new ResearchRepository().getSession(s3))!.quotaStatus).toBe('SUPPLEMENTAL');

    // Explicit includeSupplemental on s3 -> INCLUDED, validIncluded 1 -> 2, supplementalValid 1 -> 0
    const promoted = await quota().includeSupplemental(RESEARCHER, s3);
    expect(promoted.quotaStatus).toBe('INCLUDED');
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 2, supplementalValid: 0 });
    expect((await quota().reconcile(SUPERVISOR, runId)).matches).toBe(true);
  });

  it('AC-16 / AC-31: concurrent VALID across 6 sessions with quotaPerArm = 2 on real MongoDB -> never exceeds quotaPerArm', async () => {
    const { runId } = await createAndOpenRun(4); // quotaPerArm = 2
    const runObjectId = new ObjectId(runId);
    const repo = new ResearchRepository();
    const now = new Date();
    const ids = Array.from({ length: 6 }, (_, i) => `mongo-conc-${i + 1}`);
    for (const id of ids) {
      await repo.createSession({
        id,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        groupCode: null,
        contentRevisionId: new ObjectId(),
        questionSetId: new ObjectId(),
        assignedPackageId: new ObjectId(),
        assignedPackageRevision: 1,
        assignedPackageCode: 'FIXTURE_MAIN',
        informationVersion: 'info-v1',
        consentVersion: 'consent-v1',
        debriefVersion: 'debrief-v1',
        minimumReadingSeconds: 1,
        phase: 'MAIN',
        deviceType: 'desktop',
        validityFlag: 'REVIEW_REQUIRED',
        validityReason: null,
        studyRunId: runObjectId,
        invitationId: new ObjectId(),
        presentationVariant: 'V1',
        presentationVersion: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        withdrawnAt: null
      });
    }

    await Promise.all(
      ids.map((id) => quota().recordValidity(RESEARCHER, id, { validityFlag: 'VALID', reason: null }))
    );

    const storedRun = await runs().get(SUPERVISOR, runId);
    expect(storedRun.arms.V1).toEqual({ validIncluded: 2, supplementalValid: 4 });
    const rec = await quota().reconcile(SUPERVISOR, runId);
    expect(rec.matches).toBe(true);

    // Free 1 slot and race all 4 SUPPLEMENTAL sessions in includeSupplemental -> only 1 wins
    const includedSession = (await withTestDb((db) =>
      db.collection('sessions').findOne({ studyRunId: runObjectId, quotaStatus: 'INCLUDED' })
    ))!;
    await quota().recordValidity(RESEARCHER, includedSession.id, { validityFlag: 'INVALID', reason: 'free slot' });
    const supplementalDocs = await withTestDb((db) =>
      db.collection('sessions').find({ studyRunId: runObjectId, quotaStatus: 'SUPPLEMENTAL' }).toArray()
    );
    expect(supplementalDocs).toHaveLength(4);

    const promotions = await Promise.allSettled(
      supplementalDocs.map((d) => quota().includeSupplemental(RESEARCHER, d.id))
    );
    expect(promotions.filter((p) => p.status === 'fulfilled')).toHaveLength(1);
    expect(promotions.filter((p) => p.status === 'rejected')).toHaveLength(3);
    await expectStudyRunError(
      Promise.reject((promotions.find((p) => p.status === 'rejected') as PromiseRejectedResult).reason),
      'STUDY_RUN_QUOTA_FULL',
      409
    );

    const afterRace = await runs().get(SUPERVISOR, runId);
    expect(afterRace.arms.V1).toEqual({ validIncluded: 2, supplementalValid: 3 });
    expect((await quota().reconcile(SUPERVISOR, runId)).matches).toBe(true);
  });

  it('Section C1 / C2 / C3 / I: real MongoDB fault injection and crash recovery across new StudyRunQuotaService instances', async () => {
    const { runId } = await createAndOpenRun(2); // quotaPerArm = 1
    const s1 = await completeSingleRoundParticipantFlow(runId, 'V1');
    const s2 = await completeSingleRoundParticipantFlow(runId, 'V1');

    // 1. Crash after session CAS (before counter update on study_runs)
    const realRuns = new StudyRunRepository();
    const realSessions = new ResearchRepository();
    let crashStep2 = true;
    const crashingQuota1 = new StudyRunQuotaService({
      runs: {
        getById: realRuns.getById.bind(realRuns),
        applyQuotaCounterTransition: async (id, variant, transition, transitionId) => {
          if (crashStep2) {
            crashStep2 = false;
            throw new Error('MONGO_CRASH_AFTER_SESSION_CAS');
          }
          return realRuns.applyQuotaCounterTransition(id, variant, transition, transitionId);
        }
      },
      sessions: realSessions
    });

    await expect(
      crashingQuota1.recordValidity(RESEARCHER, s1, { validityFlag: 'VALID', reason: null })
    ).rejects.toThrow('MONGO_CRASH_AFTER_SESSION_CAS');

    expect((await realSessions.getSession(s1))!.quotaTransition?.state).toBe('PENDING');
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 0 });

    // Recovery via a brand new StudyRunQuotaService instance
    const recS1 = await new StudyRunQuotaService().recordValidity(RESEARCHER, s1, { validityFlag: 'VALID', reason: null });
    expect(recS1.quotaStatus).toBe('INCLUDED');
    expect(recS1.auditLogged).toBe(true);
    expect((await realSessions.getSession(s1))!.quotaTransition?.state).toBe('RECOVERED');
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    // 2. Crash after counter update (before finalize on sessions) for s2 (SUPPLEMENTAL)
    let crashFinalize = true;
    const crashingQuota2 = new StudyRunQuotaService({
      runs: realRuns,
      sessions: {
        getSession: realSessions.getSession.bind(realSessions),
        claimRunSessionQuotaTransition: realSessions.claimRunSessionQuotaTransition.bind(realSessions),
        finalizeRunSessionQuotaStatus: async (input) => {
          if (crashFinalize) {
            crashFinalize = false;
            throw new Error('MONGO_CRASH_BEFORE_FINALIZE');
          }
          return realSessions.finalizeRunSessionQuotaStatus(input);
        },
        revertRunSessionValidityClaim: realSessions.revertRunSessionValidityClaim.bind(realSessions),
        claimSupplementalQuotaPromotion: realSessions.claimSupplementalQuotaPromotion.bind(realSessions),
        finalizeSupplementalQuotaPromotion: realSessions.finalizeSupplementalQuotaPromotion.bind(realSessions),
        revertSupplementalQuotaPromotion: realSessions.revertSupplementalQuotaPromotion.bind(realSessions),
        markRunSessionQuotaAuditLogged: realSessions.markRunSessionQuotaAuditLogged.bind(realSessions),
        countRunQuotaFromSessions: realSessions.countRunQuotaFromSessions.bind(realSessions)
      }
    });

    await expect(
      crashingQuota2.recordValidity(RESEARCHER, s2, { validityFlag: 'VALID', reason: null })
    ).rejects.toThrow('MONGO_CRASH_BEFORE_FINALIZE');

    // Counter on study_runs is already incremented to supplementalValid = 1; recovery must NOT double-increment!
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });
    const recS2 = await new StudyRunQuotaService().recordValidity(RESEARCHER, s2, { validityFlag: 'VALID', reason: null });
    expect(recS2.quotaStatus).toBe('SUPPLEMENTAL');
    expect(recS2.auditLogged).toBe(true);
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 1 });

    // 3. Crash after session demotion (s1: VALID -> INVALID) before finalize
    crashFinalize = true;
    await expect(
      crashingQuota2.recordValidity(RESEARCHER, s1, { validityFlag: 'INVALID', reason: 'demote crash' })
    ).rejects.toThrow('MONGO_CRASH_BEFORE_FINALIZE');
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 1 });

    const recDemote = await new StudyRunQuotaService().recordValidity(RESEARCHER, s1, {
      validityFlag: 'INVALID',
      reason: 'demote crash'
    });
    expect(recDemote.quotaStatus).toBe('NOT_COUNTED');
    expect(recDemote.auditLogged).toBe(true);
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 0, supplementalValid: 1 });

    // 4. Crash in supplemental promotion (s2: SUPPLEMENTAL -> INCLUDED) after counter update, before finalize
    let crashSupFinalize = true;
    const crashingQuota3 = new StudyRunQuotaService({
      runs: realRuns,
      sessions: {
        getSession: realSessions.getSession.bind(realSessions),
        claimRunSessionQuotaTransition: realSessions.claimRunSessionQuotaTransition.bind(realSessions),
        finalizeRunSessionQuotaStatus: realSessions.finalizeRunSessionQuotaStatus.bind(realSessions),
        revertRunSessionValidityClaim: realSessions.revertRunSessionValidityClaim.bind(realSessions),
        claimSupplementalQuotaPromotion: realSessions.claimSupplementalQuotaPromotion.bind(realSessions),
        finalizeSupplementalQuotaPromotion: async (input) => {
          if (crashSupFinalize) {
            crashSupFinalize = false;
            throw new Error('MONGO_CRASH_SUP_FINALIZE');
          }
          return realSessions.finalizeSupplementalQuotaPromotion(input);
        },
        revertSupplementalQuotaPromotion: realSessions.revertSupplementalQuotaPromotion.bind(realSessions),
        markRunSessionQuotaAuditLogged: realSessions.markRunSessionQuotaAuditLogged.bind(realSessions),
        countRunQuotaFromSessions: realSessions.countRunQuotaFromSessions.bind(realSessions)
      }
    });

    await expect(crashingQuota3.includeSupplemental(RESEARCHER, s2)).rejects.toThrow('MONGO_CRASH_SUP_FINALIZE');
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });

    const recSup = await new StudyRunQuotaService().includeSupplemental(RESEARCHER, s2);
    expect(recSup.quotaStatus).toBe('INCLUDED');
    expect(recSup.auditLogged).toBe(true);
    expect((await runs().get(SUPERVISOR, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });
    expect((await new StudyRunQuotaService().reconcile(SUPERVISOR, runId)).matches).toBe(true);

    const audits = await withTestDb((db) =>
      db.collection('admin_audit').find({ targetId: { $in: [s1, s2, runId] } }).toArray()
    );
    expect(audits.length).toBeGreaterThanOrEqual(4);
  });
});
