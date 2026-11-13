import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { ReadingService } from '@/lib/services/reading.service';
import {
  checkRunSessionValidity,
  checkValidity,
  VALIDITY_CHECKLIST_VERSION,
  type RunValidityBundle
} from '@/lib/services/validity.service';
import {
  reviewSessionValidity,
  VALIDITY_CHECKLIST_VERSION as REVIEW_CHECKLIST_VERSION
} from '@/lib/services/validity-review.service';
import { VALIDITY_CHECKLIST_VERSION as QUOTA_CHECKLIST_VERSION } from '@/lib/services/study-run-quota.service';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { PresentationProfileDoc } from '@/types/presentation-profile';
import type {
  ExperimentEventDoc,
  QuestionSetDoc,
  ReadingSessionDoc,
  SessionDoc,
  TestAttemptDoc
} from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';
import { makeHarness, RESEARCHER } from '../helpers/study-run-fakes';

const now = new Date('2026-11-11T09:00:00Z');
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const contentId = new ObjectId();
const questionId = new ObjectId();
const packageId = new ObjectId();
const studyRunId = new ObjectId();
const invitationId = new ObjectId();
const profileId = new ObjectId();

const questions: QuestionSetDoc = {
  _id: questionId,
  revision: 1,
  label: 'MAIN test',
  phase: 'MAIN',
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `q${index}`,
    prompt: `Question ${index}`,
    options: Array.from({ length: 4 }, (_, i) => ({
      id: `q${index}o${i}`,
      text: `Option ${i}`,
      isCorrect: i === 0
    }))
  })),
  status: 'PUBLISHED',
  locked: true,
  createdAt: now,
  publishedAt: now
};

const lockedV2Profile: PresentationProfileDoc = {
  _id: profileId,
  contentRevisionId: contentId,
  contentHash: 'hash',
  variant: 'V2',
  version: 1,
  status: 'LOCKED',
  segmentation: { mode: 'SENTENCE_BLOCKS', sentencesPerBlock: 2 },
  style: { preset: 'READER_V2_ACCESSIBLE' },
  emphasis: [{ start: 0, end: 5, text: 'First' }],
  editRevision: 1,
  previewedBy: 'researcher',
  previewedAt: now,
  previewedRevision: 1,
  confirmedBy: 'researcher',
  confirmedAt: now,
  lockedAt: now,
  createdBy: 'researcher',
  createdAt: now,
  updatedAt: now
};

const fixtureRun: StudyRunDoc = {
  _id: studyRunId,
  code: 'RUN-FIXTURE',
  name: 'Fixture Study Run',
  phase: 'MAIN',
  status: 'OPEN',
  entryMode: 'INVITATION_ONLY',
  entryPolicy: {
    entryMode: 'INVITATION_ONLY',
    legacyEntry: 'UNCHANGED',
    confirmedAt: now,
    confirmedBy: 'researcher'
  },
  targetSampleSize: 4,
  quotaPerArm: 2,
  quotaConfirmedAt: now,
  quotaConfirmedBy: 'researcher',
  snapshot: {
    packageId,
    packageCode: 'FIXTURE_MAIN',
    packageRevision: 3,
    contentRevisionId: contentId,
    questionSetId: questionId
  },
  presentation: {
    V1: { version: 1 },
    V2: {
      profileId,
      version: 1
    }
  },
  arms: {
    V1: { validIncluded: 0, supplementalValid: 0 },
    V2: { validIncluded: 0, supplementalValid: 0 }
  },
  infoConsentReview: null,
  locked: true,
  version: 5,
  createdBy: 'researcher',
  createdAt: now,
  statusChangedBy: 'researcher',
  statusChangedAt: now
};

function makeRunEvidence(variant: 'V1' | 'V2' = 'V1'): RunValidityBundle {
  const session: SessionDoc = {
    id: `run-session-${variant}`,
    status: 'COMPLETED',
    currentStage: 'COMPLETED',
    groupCode: null,
    assignedPackageId: packageId,
    assignedPackageCode: 'FIXTURE_MAIN',
    assignedPackageRevision: 3,
    contentRevisionId: contentId,
    questionSetId: questionId,
    phase: 'MAIN',
    deviceType: 'desktop',
    minimumReadingSeconds: 60,
    informationVersion: 'I1',
    consentVersion: 'C1',
    debriefVersion: 'D1',
    validityFlag: 'REVIEW_REQUIRED',
    validityReason: null,
    studyRunId,
    invitationId,
    presentationVariant: variant,
    presentationVersion: 1,
    ...(variant === 'V2' ? { presentationProfileId: profileId } : {}),
    createdAt: now,
    updatedAt: at(300),
    completedAt: at(300),
    withdrawnAt: null
  };
  const reading: ReadingSessionDoc = {
    sessionId: session.id,
    roundNo: 1,
    presentation: variant,
    presentationVersion: 1,
    startedAt: at(20),
    finishedAt: at(100),
    renderedAt: at(20),
    nextClickedAt: at(100),
    readingSeconds: 80,
    scrollCount: 2,
    maxScrollDepthPercent: 100
  };
  const attempt: TestAttemptDoc = {
    sessionId: session.id,
    roundNo: 1,
    presentation: variant,
    presentationVersion: 1,
    questionSetId: questionId,
    startedAt: at(120),
    submittedAt: at(180),
    score: 5,
    answers: questions.questions.map((q) => ({
      questionId: q.id,
      selectedOptionId: `${q.id}o0`,
      isCorrect: true
    }))
  };
  const event = (type: ExperimentEventDoc['type'], roundNo?: 1 | 2 | null): ExperimentEventDoc => ({
    sessionId: session.id,
    type,
    roundNo: roundNo ?? null,
    createdAt: now
  });
  return {
    session,
    consent: { sessionId: session.id, informationVersion: 'I1', consentVersion: 'C1', decision: 'ACCEPTED', decidedAt: now },
    readings: [reading],
    tests: [attempt],
    events: [
      event('SESSION_STARTED', null),
      event('READING_STARTED', 1),
      event('READING_FINISHED', 1),
      event('TEST_STARTED', 1),
      event('TEST_SUBMITTED', 1),
      event('SESSION_COMPLETED', null)
    ],
    breakDoc: null,
    questions,
    run: fixtureRun,
    profile: variant === 'V2' ? lockedV2Profile : undefined
  };
}

describe('Single-round validity checklist: checkRunSessionValidity vs checkValidity (AC-09, AC-10, AC-11, AC-15)', () => {
  it('unifies VALIDITY_CHECKLIST_VERSION across validity, review, and quota services (Section J)', () => {
    expect(VALIDITY_CHECKLIST_VERSION).toBe(1);
    expect(REVIEW_CHECKLIST_VERSION).toBe(VALIDITY_CHECKLIST_VERSION);
    expect(QUOTA_CHECKLIST_VERSION).toBe(VALIDITY_CHECKLIST_VERSION);
  });

  it('passes a valid 1-round V1 and V2 Study Run session with MongoDB roundNo: null on session events', () => {
    for (const variant of ['V1', 'V2'] as const) {
      const report = checkRunSessionValidity(makeRunEvidence(variant));
      expect(report.eligible).toBe(true);
      expect(report.hasFailure).toBe(false);
    }
  });

  it('detects duplicate session-level or round-1 events and wrong event rounds (Section B)', () => {
    const base = makeRunEvidence('V1');
    const dupStart = checkRunSessionValidity({
      ...base,
      events: [...base.events, { sessionId: base.session.id, type: 'SESSION_STARTED', roundNo: null, createdAt: now }]
    });
    expect(dupStart.eligible).toBe(false);
    expect(dupStart.checks.find((c) => c.code === 'EVENTS')?.status).toBe('REVIEW_REQUIRED');

    const dupReadingStart = checkRunSessionValidity({
      ...base,
      events: [...base.events, { sessionId: base.session.id, type: 'READING_STARTED', roundNo: 1, createdAt: now }]
    });
    expect(dupReadingStart.eligible).toBe(false);
    expect(dupReadingStart.checks.find((c) => c.code === 'EVENTS')?.status).toBe('REVIEW_REQUIRED');

    const round2ReadingEvent = checkRunSessionValidity({
      ...base,
      events: base.events.map((e) => (e.type === 'READING_STARTED' ? { ...e, roundNo: 2 as const } : e))
    });
    expect(round2ReadingEvent.eligible).toBe(false);
    expect(round2ReadingEvent.checks.find((c) => c.code === 'EVENTS')?.status).toBe('FAIL');
  });

  it('rejects a Study Run session that has a breakDoc, break events, round 2 data or non-null groupCode', () => {
    const base = makeRunEvidence('V1');
    expect(
      checkRunSessionValidity({
        ...base,
        breakDoc: { sessionId: base.session.id, startedAt: at(190), finishedAt: at(250) }
      }).checks.find((c) => c.code === 'BREAK')?.status
    ).toBe('FAIL');

    expect(
      checkRunSessionValidity({
        ...base,
        events: [...base.events, { sessionId: base.session.id, type: 'BREAK_STARTED', createdAt: at(185) }]
      }).eligible
    ).toBe(false);

    expect(
      checkRunSessionValidity({
        ...base,
        readings: [...base.readings, { ...base.readings[0], roundNo: 2 }]
      }).checks.find((c) => c.code === 'READING')?.status
    ).toBe('FAIL');

    expect(
      checkRunSessionValidity({
        ...base,
        tests: [...base.tests, { ...base.tests[0], roundNo: 2 }]
      }).checks.find((c) => c.code === 'QUIZ')?.status
    ).toBe('FAIL');

    expect(
      checkRunSessionValidity({
        ...base,
        session: { ...base.session, groupCode: 'A' }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
  });

  it('requires a real Study Run snapshot and LOCKED V2 profile, and rejects any snapshot or presentationVersion mismatch (Sections D, E)', () => {
    const v1 = makeRunEvidence('V1');
    const v2 = makeRunEvidence('V2');

    // Missing run -> FAIL (never defaults to PASS)
    expect(checkRunSessionValidity({ ...v1, run: undefined }).checks.find((c) => c.code === 'ASSIGNMENT')?.status).toBe('FAIL');
    expect(checkRunSessionValidity({ ...v1, run: null }).checks.find((c) => c.code === 'ASSIGNMENT')?.status).toBe('FAIL');

    // Snapshot mismatches on run -> FAIL
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, _id: new ObjectId() }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, snapshot: { ...fixtureRun.snapshot, packageId: new ObjectId() } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, snapshot: { ...fixtureRun.snapshot, packageCode: 'OTHER' } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, snapshot: { ...fixtureRun.snapshot, packageRevision: 99 } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, snapshot: { ...fixtureRun.snapshot, contentRevisionId: new ObjectId() } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, snapshot: { ...fixtureRun.snapshot, questionSetId: new ObjectId() } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, presentation: { ...fixtureRun.presentation, V1: { version: 2 } } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        run: { ...fixtureRun, presentation: { ...fixtureRun.presentation, V2: { profileId: null, version: null } } }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');

    // V1 must not have a V2 profile or presentationProfileId
    expect(
      checkRunSessionValidity({
        ...v1,
        session: { ...v1.session, presentationProfileId: profileId }
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({
        ...v1,
        profile: lockedV2Profile
      }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');

    // V2 profile checks: must exist, match profileId, contentRevisionId, variant V2, version, and be LOCKED
    expect(checkRunSessionValidity({ ...v2, profile: null }).checks.find((c) => c.code === 'ASSIGNMENT')?.status).toBe('FAIL');
    expect(checkRunSessionValidity({ ...v2, profile: undefined }).checks.find((c) => c.code === 'ASSIGNMENT')?.status).toBe('FAIL');
    expect(
      checkRunSessionValidity({ ...v2, profile: { ...lockedV2Profile, status: 'DRAFT' } }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({ ...v2, profile: { ...lockedV2Profile, status: 'CONFIRMED' } }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({ ...v2, profile: { ...lockedV2Profile, version: 2 } }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');
    expect(
      checkRunSessionValidity({ ...v2, profile: { ...lockedV2Profile, contentRevisionId: new ObjectId() } }).checks.find((c) => c.code === 'ASSIGNMENT')?.status
    ).toBe('FAIL');

    // Section E: presentationVersion on reading_sessions and test_attempts must exist and match session.presentationVersion
    for (const badVersion of [null, undefined, 2] as const) {
      expect(
        checkRunSessionValidity({
          ...v2,
          readings: [{ ...v2.readings[0], presentationVersion: badVersion }]
        }).checks.find((c) => c.code === 'READING')?.status
      ).toBe('FAIL');
      expect(
        checkRunSessionValidity({
          ...v2,
          tests: [{ ...v2.tests[0], presentationVersion: badVersion }]
        }).checks.find((c) => c.code === 'QUIZ')?.status
      ).toBe('FAIL');
    }
  });

  it('preserves checkValidity behavior for legacy 2-round sessions (requires 2 rounds, break and groupCode)', () => {
    const v1Run = makeRunEvidence('V1');
    const legacyReportOnSingleRound = checkValidity(v1Run);
    expect(legacyReportOnSingleRound.eligible).toBe(false);
    expect(legacyReportOnSingleRound.checks.find((c) => c.code === 'READING')?.status).toBe('FAIL');
    expect(legacyReportOnSingleRound.checks.find((c) => c.code === 'QUIZ')?.status).toBe('FAIL');
  });
});

describe('Single-round ReadingService, completeRunSessionIfReady and reviewSessionValidity (AC-09, AC-11, Sections D, E, G)', () => {
  it('ReadingService requires integer presentationVersion on READING_1 and refuses READING_2 for Study Run sessions', async () => {
    const base = makeRunEvidence('V2').session;
    const created: ReadingSessionDoc[] = [];
    const repo = {
      createReadingIfMissing: async (doc: ReadingSessionDoc) => {
        created.push(doc);
        return doc;
      },
      getReading: async () => created[0] ?? null
    } as unknown as ResearchRepository;

    const svc = new ReadingService(repo);
    const r1 = await svc.start({ ...base, status: 'ACTIVE', currentStage: 'READING_1', presentationVersion: 2 });
    expect(r1.roundNo).toBe(1);
    expect(r1.presentation).toBe('V2');
    expect(r1.presentationVersion).toBe(2);

    await expect(
      svc.start({ ...base, status: 'ACTIVE', currentStage: 'READING_1', presentationVersion: null })
    ).rejects.toThrow('PRESENTATION_VERSION_NOT_ASSIGNED');
    await expect(
      svc.start({ ...base, status: 'ACTIVE', currentStage: 'READING_1', presentationVersion: undefined })
    ).rejects.toThrow('PRESENTATION_VERSION_NOT_ASSIGNED');

    await expect(
      svc.start({ ...base, status: 'ACTIVE', currentStage: 'READING_2' })
    ).rejects.toThrow('INVALID_READING_STAGE');
    await expect(
      svc.finish({ ...base, status: 'ACTIVE', currentStage: 'READING_2' }, { scrollCount: 1, maxScrollDepthPercent: 50 })
    ).rejects.toThrow('INVALID_READING_STAGE');

    // Legacy session still allows READING_2 via presentationForRound without presentationVersion
    const legacyCreated: ReadingSessionDoc[] = [];
    const legacyRepo = {
      createReadingIfMissing: async (doc: ReadingSessionDoc) => {
        legacyCreated.push(doc);
        return doc;
      }
    } as unknown as ResearchRepository;
    const legacyR2 = await new ReadingService(legacyRepo).start({
      ...base,
      studyRunId: undefined,
      presentationVariant: undefined,
      presentationVersion: undefined,
      groupCode: 'A',
      status: 'ACTIVE',
      currentStage: 'READING_2'
    });
    expect(legacyR2.roundNo).toBe(2);
    expect(legacyR2.presentation).toBe('V2');
    expect('presentationVersion' in legacyR2).toBe(false);
  });

  it('ResearchRepository exposes both completeSessionIfReady (TEST_2) and completeRunSessionIfReady (TEST_1 + studyRunId)', () => {
    expect(typeof ResearchRepository.prototype.completeSessionIfReady).toBe('function');
    expect(typeof ResearchRepository.prototype.completeRunSessionIfReady).toBe('function');
  });

  it('reviewSessionValidity verifies Study Run snapshot, classifies 400/404/409 errors, and rethrows unexpected DB errors for 500 handling (Sections D, G)', async () => {
    const h = makeHarness();
    let run = (await h.service.create(RESEARCHER, {
      code: 'RUN-REV',
      name: 'Review Run',
      phase: 'MAIN',
      packageId: h.packageId.toHexString(),
      targetSampleSize: 4
    })).run;
    const runId = run._id!.toHexString();
    run = (await h.service.confirmQuota(RESEARCHER, runId, { expectedVersion: run.version, quotaPerArm: 2 })).run;
    const profile = await h.confirmDefaultProfile();
    run = (await h.service.confirmPresentationProfile(RESEARCHER, runId, {
      expectedVersion: run.version,
      profileId: profile._id!.toHexString()
    })).run;

    const evidence = makeRunEvidence('V1');
    const runSession: SessionDoc = {
      ...evidence.session,
      studyRunId: run._id!,
      assignedPackageId: h.packageId,
      assignedPackageCode: 'FIXTURE_MAIN',
      assignedPackageRevision: 3,
      contentRevisionId: h.contentId,
      questionSetId: h.questionSetId,
      minimumReadingSeconds: 60
    };
    const alignedQuestions: QuestionSetDoc = { ...questions, _id: h.questionSetId };
    const alignedAttempts: TestAttemptDoc[] = [{ ...evidence.tests[0], questionSetId: h.questionSetId }];
    h.quotaSessions.put(runSession);

    let setValidityCalled = false;
    const fakeRepo = {
      getSessionBundle: async () => ({
        session: await h.quotaSessions.getSession(runSession.id),
        consent: evidence.consent,
        demographics: null,
        readings: evidence.readings,
        tests: alignedAttempts,
        events: evidence.events,
        breakDoc: null,
        validityHistory: []
      }),
      getQuestionSetById: async () => alignedQuestions,
      setValidity: async () => {
        setValidityCalled = true;
        return null;
      },
      addAudit: async () => undefined,
      getSession: h.quotaSessions.getSession.bind(h.quotaSessions),
      claimRunSessionQuotaTransition: h.quotaSessions.claimRunSessionQuotaTransition.bind(h.quotaSessions),
      finalizeRunSessionQuotaStatus: h.quotaSessions.finalizeRunSessionQuotaStatus.bind(h.quotaSessions),
      revertRunSessionValidityClaim: h.quotaSessions.revertRunSessionValidityClaim.bind(h.quotaSessions),
      claimSupplementalQuotaPromotion: h.quotaSessions.claimSupplementalQuotaPromotion.bind(h.quotaSessions),
      finalizeSupplementalQuotaPromotion: h.quotaSessions.finalizeSupplementalQuotaPromotion.bind(h.quotaSessions),
      revertSupplementalQuotaPromotion: h.quotaSessions.revertSupplementalQuotaPromotion.bind(h.quotaSessions),
      countRunQuotaFromSessions: h.quotaSessions.countRunQuotaFromSessions.bind(h.quotaSessions)
    } as unknown as ResearchRepository;

    // 400 when validation fails (e.g., INVALID with empty reason)
    const badInputRes = await reviewSessionValidity(
      runSession.id,
      { validityFlag: 'INVALID', reason: '' },
      RESEARCHER,
      fakeRepo,
      { profiles: h.profiles, runs: h.store }
    );
    expect(badInputRes.status).toBe(400);

    // 409 when Study Run does not exist and caller requests VALID (ASSIGNMENT check fails)
    const missingRunStore = {
      getById: async () => null,
      applyQuotaCounterTransition: h.store.applyQuotaCounterTransition.bind(h.store)
    };
    const missingRunValidRes = await reviewSessionValidity(
      runSession.id,
      { validityFlag: 'VALID', reason: null },
      RESEARCHER,
      fakeRepo,
      { profiles: h.profiles, runs: missingRunStore }
    );
    expect(missingRunValidRes.status).toBe(409);
    if (missingRunValidRes.status !== 200) {
      expect(missingRunValidRes.body.checks?.find((c) => c.code === 'ASSIGNMENT')?.status).toBe('FAIL');
    }

    // 404 when Study Run does not exist and caller requests INVALID
    const missingRunInvalidRes = await reviewSessionValidity(
      runSession.id,
      { validityFlag: 'INVALID', reason: 'missing run' },
      RESEARCHER,
      fakeRepo,
      { profiles: h.profiles, runs: missingRunStore }
    );
    expect(missingRunInvalidRes.status).toBe(404);

    // Unexpected database failure is rethrown (not mapped to 409 or leaked)
    const dbFailureStore = {
      getById: h.store.getById.bind(h.store),
      applyQuotaCounterTransition: async () => {
        throw new Error('MongoNetworkError: connection 10.0.0.12 closed');
      }
    };
    await expect(
      reviewSessionValidity(
        runSession.id,
        { validityFlag: 'VALID', reason: null },
        RESEARCHER,
        fakeRepo,
        { profiles: h.profiles, runs: dbFailureStore }
      )
    ).rejects.toThrow('MongoNetworkError');

    // Recover & succeed with real store
    const res = await reviewSessionValidity(
      runSession.id,
      { validityFlag: 'VALID', reason: null },
      RESEARCHER,
      fakeRepo,
      { profiles: h.profiles, runs: h.store }
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect(res.body.quotaStatus).toBe('INCLUDED');
    }
    expect(setValidityCalled).toBe(false);
    expect((await h.service.get(RESEARCHER, runId)).arms.V1).toEqual({ validIncluded: 1, supplementalValid: 0 });
  });
});
