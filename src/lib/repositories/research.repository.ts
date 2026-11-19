import { ObjectId, type Collection, type Filter } from 'mongodb';
import { collections } from '@/lib/db/collections';
import type {
  AdminAuditDoc,
  BreakDoc,
  ConsentDoc,
  ContentRevisionDoc,
  ContentPackageDoc,
  DemographicsDoc,
  ExperimentConfigDoc,
  ExperimentEventDoc,
  GroupCode,
  Presentation,
  QuestionSetDoc,
  QuotaStatus,
  ReadingSessionDoc,
  SessionDoc,
  SessionQuotaTransition,
  StudyPhase,
  TestAttemptDoc,
  ValidityFlag,
  VariantLock,
  VariantLocksDoc
} from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';

/** Session/export filters shared by the dashboard, the session list and every CSV. `variant` is the invitation's V1/V2 (P5). */
export type SessionExportFilters = { group?: GroupCode; packageCode?: string; revision?: number; variant?: Presentation; studyRunId?: string };

const UNLOCKED: VariantLock = { locked: false, changedBy: null, changedAt: null };

/** Read/write surface of the per-variant intake lock (P5-D). Implemented by ResearchRepository and by the test fakes. */
export interface VariantLockStore {
  getVariantLocks(): Promise<Record<Presentation, VariantLock>>;
  setVariantLock(variant: Presentation, locked: boolean, by: string, at: Date): Promise<void>;
}

/** Fails the claim while a COMMITTED/RECOVERED transition still owes its audit entry (`auditLogged === false`). */
const AUDIT_SETTLED_GUARD = {
  $nor: [{ 'quotaTransition.state': { $in: ['COMMITTED', 'RECOVERED'] }, 'quotaTransition.auditLogged': false }]
} as Filter<SessionDoc>;

export interface ClaimRunSessionQuotaTransitionInput {
  sessionId: string;
  studyRunId: ObjectId;
  variant: Presentation;
  expectedValidityFlag: ValidityFlag;
  expectedQuotaStatus: QuotaStatus | null;
  expectedReviewedAt?: Date | null;
  expectedQuotaRecordedAt?: Date | null;
  nextValidityFlag: ValidityFlag;
  nextQuotaStatus: QuotaStatus | null;
  reason: string | null;
  reviewedBy: string;
  checklistVersion: number | null;
  recordQuotaMeta: boolean;
  at: Date;
  transition?: SessionQuotaTransition | null;
}

export interface FinalizeRunSessionQuotaStatusInput {
  sessionId: string;
  studyRunId: ObjectId;
  variant: Presentation;
  expectedValidityFlag?: ValidityFlag;
  expectedQuotaStatus: QuotaStatus | null;
  expectedReviewedAt: Date;
  quotaStatus: QuotaStatus;
  recordedBy: string;
  at: Date;
  transitionId?: string;
  transitionState?: 'COMMITTED' | 'RECOVERED';
  auditLogged?: boolean;
}

export interface RevertRunSessionValidityClaimInput {
  sessionId: string;
  studyRunId: ObjectId;
  expectedReviewedAt: Date;
  claimedValidityFlag?: ValidityFlag;
  claimedQuotaStatus?: QuotaStatus | null;
  transitionId?: string;
  previousValidityFlag: ValidityFlag;
  previousReason: string | null;
  previousReviewedBy?: string;
  previousReviewedAt?: Date;
  previousChecklistVersion?: number | null;
  previousQuotaStatus: QuotaStatus | null;
  previousQuotaRecordedAt?: Date | null;
  previousQuotaRecordedBy?: string | null;
  previousUpdatedAt?: Date;
}

export interface ClaimSupplementalPromotionInput {
  sessionId: string;
  studyRunId: ObjectId;
  variant: Presentation;
  expectedRecordedAt: Date | null;
  recordedBy: string;
  at: Date;
  transition?: SessionQuotaTransition | null;
}

export interface RevertSupplementalPromotionInput {
  sessionId: string;
  studyRunId: ObjectId;
  variant: Presentation;
  claimAt: Date;
  transitionId?: string;
  previousRecordedAt: Date | null;
  previousRecordedBy: string | null;
  previousUpdatedAt?: Date;
}

/** Narrow session store port used by StudyRunQuotaService (P4). */
export interface QuotaSessionStore {
  getSession(id: string): Promise<SessionDoc | null>;
  claimRunSessionQuotaTransition(input: ClaimRunSessionQuotaTransitionInput): Promise<SessionDoc | null>;
  finalizeRunSessionQuotaStatus(input: FinalizeRunSessionQuotaStatusInput): Promise<SessionDoc | null>;
  revertRunSessionValidityClaim(input: RevertRunSessionValidityClaimInput): Promise<SessionDoc | null>;
  claimSupplementalQuotaPromotion(input: ClaimSupplementalPromotionInput): Promise<SessionDoc | null>;
  finalizeSupplementalQuotaPromotion(input: {
    sessionId: string;
    studyRunId: ObjectId;
    variant: Presentation;
    claimAt: Date;
    transitionId?: string;
    transitionState?: 'COMMITTED' | 'RECOVERED';
    auditLogged?: boolean;
  }): Promise<SessionDoc | null>;
  revertSupplementalQuotaPromotion(input: RevertSupplementalPromotionInput): Promise<SessionDoc | null>;
  /** Marks `quotaTransition.auditLogged = true` once the idempotent audit entry of that transition exists. */
  markRunSessionQuotaAuditLogged(sessionId: string, transitionId: string): Promise<void>;
  countRunQuotaFromSessions(studyRunId: ObjectId): Promise<StudyRunDoc['arms']>;
}

const defaultConfig: ExperimentConfigDoc = {
  key: 'active',
  phase: 'MAIN',
  studyPublished: false,
  assignmentMode: 'FIXED',
  fixedPackageId: null,
  mainRandomApproved: false,
  allowPilotRetakes: false,
  informationText: null,
  informationVersion: null,
  consentText: null,
  consentVersion: null,
  debriefText: null,
  debriefVersion: null,
  dataRightsText: null,
  findingsText: null,
  minimumReadingSeconds: null,
  minimumValidTarget: 40,
  recruitmentTarget: 60,
  updatedAt: new Date(0)
};

export class ResearchRepository implements QuotaSessionStore, VariantLockStore {
  async getConfig(): Promise<ExperimentConfigDoc> {
    const { experimentConfig } = await collections();
    return (await experimentConfig.findOne({ key: 'active' })) ?? defaultConfig;
  }

  /** Compare-and-swap: validation happens before this single write. Never unpublish on rejection. */
  async saveConfigIfUnchanged(
    expected: ExperimentConfigDoc,
    proposed: ExperimentConfigDoc
  ): Promise<ExperimentConfigDoc | null> {
    const { experimentConfig } = await collections();
    const { _id: _ignoreId, key: _ignoreKey, ...values } = proposed;
    void _ignoreId; void _ignoreKey;
    // Avoid same-millisecond timestamps bypassing optimistic concurrency.
    const updatedAt = new Date(Math.max(Date.now(), expected.updatedAt.getTime() + 1));
    try {
      const result = await experimentConfig.findOneAndUpdate(
        { key: 'active', updatedAt: expected.updatedAt },
        { $set: { ...values, updatedAt }, $setOnInsert: { key: 'active' } },
        { upsert: true, returnDocument: 'after' }
      );
      return result;
    } catch (error) {
      // If another admin created/changed this config, the unique key prevents overwrite.
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return null;
      throw error;
    }
  }

  async listPackages(): Promise<ContentPackageDoc[]> {
    const { contentPackages } = await collections();
    return contentPackages.find().sort({ createdAt: -1 }).toArray();
  }

  async listEligiblePackages(phase: StudyPhase): Promise<ContentPackageDoc[]> {
    const { contentPackages } = await collections();
    return contentPackages.find({ phase, status: 'PUBLISHED', enabled: true }).toArray();
  }

  async getPackageById(id: ObjectId): Promise<ContentPackageDoc | null> {
    const { contentPackages } = await collections();
    return contentPackages.findOne({ _id: id });
  }

  async countPublishedPackages(phase?: StudyPhase): Promise<number> {
    const { contentPackages } = await collections();
    return contentPackages.countDocuments({ ...(phase ? { phase } : {}), status: 'PUBLISHED', enabled: true });
  }

  async nextPackageRevision(code: string): Promise<number> {
    const { contentPackages } = await collections();
    const last = await contentPackages.find({ code }).sort({ revision: -1 }).limit(1).next();
    return (last?.revision ?? 0) + 1;
  }

  async insertPackage(pkg: ContentPackageDoc): Promise<ObjectId> {
    const { contentPackages } = await collections();
    return (await contentPackages.insertOne(pkg)).insertedId;
  }

  async updateDraftPackage(id: ObjectId, update: Partial<ContentPackageDoc>): Promise<ContentPackageDoc | null> {
    const { contentPackages } = await collections();
    return contentPackages.findOneAndUpdate({ _id: id, status: 'DRAFT' }, { $set: { ...update, updatedAt: new Date() } }, { returnDocument: 'after' });
  }

  /** True when a content/question revision belongs to a content package (those may only change through the package flow). */
  async isRevisionOwnedByPackage(kind: 'content' | 'questions', id: ObjectId): Promise<boolean> {
    const { contentPackages } = await collections();
    return (await contentPackages.countDocuments(kind === 'content' ? { contentRevisionId: id } : { questionSetId: id }, { limit: 1 })) > 0;
  }

  async publishPackage(id: ObjectId): Promise<ContentPackageDoc | null> {
    const { contentPackages } = await collections();
    return contentPackages.findOneAndUpdate({ _id: id, status: 'DRAFT' },
      { $set: { status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' });
  }

  async archivePackage(id: ObjectId): Promise<ContentPackageDoc | null> {
    const { contentPackages } = await collections();
    return contentPackages.findOneAndUpdate({ _id: id, status: 'PUBLISHED' },
      { $set: { status: 'ARCHIVED', enabled: false, archivedAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' });
  }

  async getPublishedContent(phase: StudyPhase): Promise<ContentRevisionDoc | null> {
    const { contentRevisions } = await collections();
    return contentRevisions.find({ phase, status: 'PUBLISHED' }).sort({ revision: -1 }).limit(1).next();
  }

  async getPublishedQuestionSet(phase: StudyPhase): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.find({ phase, status: 'PUBLISHED' }).sort({ revision: -1 }).limit(1).next();
  }

  async getContentById(id: ObjectId): Promise<ContentRevisionDoc | null> {
    const { contentRevisions } = await collections();
    return contentRevisions.findOne({ _id: id });
  }

  async getQuestionSetById(id: ObjectId): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOne({ _id: id });
  }

  async createSession(session: SessionDoc): Promise<void> {
    const { sessions } = await collections();
    await sessions.insertOne(session);
  }

  async getSession(id: string): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOne({ id });
  }

  async updateSession(id: string, update: Partial<SessionDoc>): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate({ id }, { $set: { ...update, updatedAt: new Date() } }, { returnDocument: 'after' });
  }

  async compareAndSetStage(id: string, expectedStage: SessionDoc['currentStage'], nextStage: SessionDoc['currentStage']): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate(
      { id, currentStage: expectedStage, status: 'ACTIVE' },
      { $set: { currentStage: nextStage, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  async claimPilotRestart(id: string): Promise<boolean> {
    const { sessions } = await collections();
    const result = await sessions.updateOne({ id, phase: 'PILOT', status: { $in: ['COMPLETED', 'WITHDRAWN', 'DECLINED'] }, pilotRestartedAt: { $exists: false } },
      { $set: { pilotRestartedAt: new Date() } });
    return result.modifiedCount === 1;
  }
  async releasePilotRestart(id: string): Promise<void> {
    const { sessions } = await collections();
    await sessions.updateOne({ id, pilotReplacementSessionId: { $exists: false } }, { $unset: { pilotRestartedAt: '' } });
  }
  async recordPilotReplacement(id: string, newId: string): Promise<void> {
    const { sessions } = await collections();
    await sessions.updateOne({ id, pilotRestartedAt: { $exists: true } }, { $set: { pilotReplacementSessionId: newId } });
  }

  async closeActiveSession(id: string, status: 'WITHDRAWN' | 'DECLINED', expectedStage?: SessionDoc['currentStage']) {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate({ id, status: 'ACTIVE', ...(expectedStage ? { currentStage: expectedStage } : {}) },
      { $set: { status, ...(status === 'WITHDRAWN' ? { withdrawnAt: new Date() } : {}), updatedAt: new Date() } },
      { returnDocument: 'after' });
  }

  async completeSessionIfReady(id: string): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate(
      { id, $or: [{ currentStage: 'TEST_1', status: 'ACTIVE' }, { currentStage: 'TEST_2', status: 'ACTIVE' }] },
      { $set: { currentStage: 'COMPLETED', status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  /**
   * P4: Completes an ACTIVE Study Run session directly from TEST_1 (single-round flow, architecture §4, AC-09).
   * Requires `studyRunId` to exist so a legacy session can never complete from TEST_1.
   */
  async completeRunSessionIfReady(id: string): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const now = new Date();
    return sessions.findOneAndUpdate(
      { id, currentStage: 'TEST_1', status: 'ACTIVE', studyRunId: { $exists: true, $ne: null as never } },
      { $set: { currentStage: 'COMPLETED', status: 'COMPLETED', completedAt: now, updatedAt: now } },
      { returnDocument: 'after' }
    );
  }

  async assignGroupIfMissing(id: string, groupCode: GroupCode): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const assigned = await sessions.findOneAndUpdate(
      { id, groupCode: null, status: 'ACTIVE' },
      { $set: { groupCode, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    return assigned ?? sessions.findOne({ id });
  }

  async countGroups(phase: StudyPhase): Promise<Record<GroupCode, number>> {
    const { sessions } = await collections();
    const [a, b] = await Promise.all([
      sessions.countDocuments({ phase, groupCode: 'A' }),
      sessions.countDocuments({ phase, groupCode: 'B' })
    ]);
    return { A: a, B: b };
  }

  async saveConsent(doc: ConsentDoc): Promise<ConsentDoc> {
    const { consents } = await collections();
    await consents.updateOne({ sessionId: doc.sessionId }, { $setOnInsert: doc }, { upsert: true });
    return (await consents.findOne({ sessionId: doc.sessionId }))!;
  }

  async saveDemographics(doc: DemographicsDoc): Promise<void> {
    const { demographics } = await collections();
    await demographics.updateOne({ sessionId: doc.sessionId }, { $setOnInsert: doc }, { upsert: true });
  }

  async getDemographics(sessionId: string): Promise<DemographicsDoc | null> {
    const { demographics } = await collections();
    return demographics.findOne({ sessionId });
  }

  async createReadingIfMissing(doc: ReadingSessionDoc): Promise<ReadingSessionDoc> {
    const { readingSessions } = await collections();
    await readingSessions.updateOne(
      { sessionId: doc.sessionId, roundNo: doc.roundNo },
      { $setOnInsert: doc },
      { upsert: true }
    );
    return (await readingSessions.findOne({ sessionId: doc.sessionId, roundNo: doc.roundNo })) as ReadingSessionDoc;
  }

  async getReading(sessionId: string, roundNo: 1 | 2): Promise<ReadingSessionDoc | null> {
    const { readingSessions } = await collections();
    return readingSessions.findOne({ sessionId, roundNo });
  }

  async finishReading(sessionId: string, roundNo: 1 | 2, update: Partial<ReadingSessionDoc>): Promise<ReadingSessionDoc | null> {
    const { readingSessions } = await collections();
    return readingSessions.findOneAndUpdate(
      { sessionId, roundNo, finishedAt: null },
      { $set: update },
      { returnDocument: 'after' }
    );
  }

  async testStartedAt(sessionId: string, roundNo: 1 | 2): Promise<Date | null> {
    const { experimentEvents } = await collections();
    const event = await experimentEvents.find({ sessionId, type: 'TEST_STARTED', roundNo }).sort({ createdAt: 1 }).limit(1).next();
    return event?.createdAt ?? null;
  }

  async getTestAttempt(sessionId: string, roundNo: 1 | 2): Promise<TestAttemptDoc | null> {
    const { testAttempts } = await collections();
    return testAttempts.findOne({ sessionId, roundNo });
  }

  async insertTestAttempt(doc: TestAttemptDoc): Promise<boolean> {
    const { testAttempts } = await collections();
    try {
      await testAttempts.insertOne(doc);
      return true;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 11000) return false;
      throw error;
    }
  }

  async createBreakIfMissing(doc: BreakDoc): Promise<BreakDoc> {
    const { breaks } = await collections();
    await breaks.updateOne({ sessionId: doc.sessionId }, { $setOnInsert: doc }, { upsert: true });
    return (await breaks.findOne({ sessionId: doc.sessionId })) as BreakDoc;
  }

  async getBreak(sessionId: string): Promise<BreakDoc | null> {
    const { breaks } = await collections();
    return breaks.findOne({ sessionId });
  }

  async finishBreak(sessionId: string, finishedAt: Date): Promise<BreakDoc | null> {
    const { breaks } = await collections();
    return breaks.findOneAndUpdate(
      { sessionId, finishedAt: null },
      { $set: { finishedAt } },
      { returnDocument: 'after' }
    );
  }

  async addEvent(event: ExperimentEventDoc): Promise<void> {
    const { experimentEvents } = await collections();
    // One canonical record per transition. Client retries and React StrictMode
    // must not produce duplicate research observations.
    const eventKey = `${event.sessionId}:${event.type}:${event.roundNo ?? 0}`;
    await experimentEvents.updateOne({ eventKey }, { $setOnInsert: { ...event, eventKey } }, { upsert: true });
  }

  async addAudit(audit: AdminAuditDoc): Promise<void> {
    const { adminAudit } = await collections();
    if (audit.dedupeKey) {
      // Idempotent: a retry after a crash (or a concurrent repair) never creates a second entry for the same key.
      await adminAudit.updateOne({ dedupeKey: audit.dedupeKey }, { $setOnInsert: audit }, { upsert: true });
      return;
    }
    await adminAudit.insertOne(audit);
  }

  async listSessions(options: {
    page: number;
    pageSize: number;
    search?: string;
    packageCode?: string;
    revision?: number;
    status?: SessionDoc['status'];
    groupCode?: GroupCode;
    variant?: Presentation;
    validityFlag?: ValidityFlag;
    phase?: StudyPhase;
    sort?: 'newest' | 'oldest';
  }): Promise<{ items: SessionDoc[]; total: number }> {
    const { sessions } = await collections();
    const filter: Filter<SessionDoc> = {};
    if (options.search) filter.id = { $regex: options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (options.status) filter.status = options.status;
    if (options.packageCode) filter.assignedPackageCode = options.packageCode.trim().toUpperCase();
    if (options.revision) filter.assignedPackageRevision = options.revision;
    if (options.groupCode) filter.groupCode = options.groupCode;
    if (options.variant) filter.presentationVariant = options.variant;
    if (options.validityFlag) filter.validityFlag = options.validityFlag;
    if (options.phase) filter.phase = options.phase;
    const [items, total] = await Promise.all([
      sessions
        .find(filter)
        .sort({ createdAt: options.sort === 'oldest' ? 1 : -1 })
        .skip((options.page - 1) * options.pageSize)
        .limit(options.pageSize)
        .toArray(),
      sessions.countDocuments(filter)
    ]);
    return { items, total };
  }

  async listTestScores(sessionIds: string[]): Promise<TestAttemptDoc[]> {
    if (!sessionIds.length) return [];
    const { testAttempts } = await collections();
    return testAttempts.find({ sessionId: { $in: sessionIds } }).toArray();
  }

  async getSessionBundle(sessionId: string) {
    const c = await collections();
    const [session, consent, demographics, readings, tests, events, breakDoc, validityHistory] = await Promise.all([
      c.sessions.findOne({ id: sessionId }),
      c.consents.findOne({ sessionId }),
      c.demographics.findOne({ sessionId }),
      c.readingSessions.find({ sessionId }).sort({ roundNo: 1 }).toArray(),
      c.testAttempts.find({ sessionId }).sort({ roundNo: 1 }).toArray(),
      c.experimentEvents.find({ sessionId }).sort({ createdAt: 1 }).toArray(),
      c.breaks.findOne({ sessionId }),
      c.adminAudit.find({ action: 'VALIDITY_CHANGED', targetType: 'session', targetId: sessionId }).sort({ createdAt: 1 }).toArray()
    ]);
    return { session, consent, demographics, readings, tests, events, breakDoc, validityHistory };
  }

  async setValidity(sessionId: string, flag: ValidityFlag, reason: string | null, reviewedBy: string, checklistVersion: number | null): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const at = new Date();
    return sessions.findOneAndUpdate({ id: sessionId, status: 'COMPLETED' },
      { $set: { validityFlag: flag, validityReason: reason, validityReviewedBy: reviewedBy, validityReviewedAt: at, validityChecklistVersion: checklistVersion, updatedAt: at },
        $push: { validityHistory: { flag, reason, reviewedBy, reviewedAt: at } } },
      { returnDocument: 'after' });
  }

  /**
   * P4: Compare-and-set on the prior `(validityFlag, quotaStatus)` pair of a COMPLETED Study Run session (§6.4, AC-15, AC-16, AC-31).
   */
  async claimRunSessionQuotaTransition(input: ClaimRunSessionQuotaTransitionInput): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const filter: Filter<SessionDoc> = {
      id: input.sessionId,
      status: 'COMPLETED',
      currentStage: 'COMPLETED',
      studyRunId: input.studyRunId,
      presentationVariant: input.variant,
      validityFlag: input.expectedValidityFlag,
      quotaStatus: (input.expectedQuotaStatus ?? null) as never,
      ...(input.expectedReviewedAt !== undefined ? { validityReviewedAt: (input.expectedReviewedAt ?? null) as never } : {}),
      ...(input.expectedQuotaRecordedAt !== undefined ? { quotaRecordedAt: (input.expectedQuotaRecordedAt ?? null) as never } : {}),
      // A transition that replaces `quotaTransition` must not destroy a settled transition whose audit is still owed.
      ...(input.transition !== undefined ? AUDIT_SETTLED_GUARD : {})
    };
    const setFields: Partial<SessionDoc> = {
      validityFlag: input.nextValidityFlag,
      validityReason: input.reason,
      validityReviewedBy: input.reviewedBy,
      validityReviewedAt: input.at,
      validityChecklistVersion: input.checklistVersion,
      ...(input.nextQuotaStatus !== null ? { quotaStatus: input.nextQuotaStatus } : {}),
      ...(input.recordQuotaMeta ? { quotaRecordedAt: input.at, quotaRecordedBy: input.reviewedBy } : {}),
      ...(input.transition !== undefined ? { quotaTransition: input.transition } : {}),
      updatedAt: input.at
    };
    return sessions.findOneAndUpdate(
      filter,
      {
        $set: setFields,
        $push: { validityHistory: { flag: input.nextValidityFlag, reason: input.reason, reviewedBy: input.reviewedBy, reviewedAt: input.at } }
      },
      { returnDocument: 'after' }
    );
  }

  async finalizeRunSessionQuotaStatus(input: FinalizeRunSessionQuotaStatusInput): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const setFields: Record<string, unknown> = {
      quotaStatus: input.quotaStatus,
      quotaRecordedAt: input.at,
      quotaRecordedBy: input.recordedBy,
      updatedAt: input.at
    };
    if (input.transitionId) {
      setFields['quotaTransition.state'] = input.transitionState ?? 'COMMITTED';
      setFields['quotaTransition.committedQuotaStatus'] = input.quotaStatus;
      setFields['quotaTransition.updatedAt'] = input.at;
      if (input.auditLogged !== undefined) {
        setFields['quotaTransition.auditLogged'] = input.auditLogged;
      }
    }
    return sessions.findOneAndUpdate(
      {
        id: input.sessionId,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        studyRunId: input.studyRunId,
        presentationVariant: input.variant,
        validityFlag: input.expectedValidityFlag ?? 'VALID',
        validityReviewedAt: input.expectedReviewedAt,
        quotaStatus: (input.expectedQuotaStatus ?? null) as never,
        ...(input.transitionId ? { 'quotaTransition.id': input.transitionId, 'quotaTransition.state': 'PENDING' } : {})
      } as Filter<SessionDoc>,
      { $set: setFields },
      { returnDocument: 'after' }
    );
  }

  async revertRunSessionValidityClaim(input: RevertRunSessionValidityClaimInput): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const expectedFlag = input.claimedValidityFlag ?? 'VALID';
    const expectedQuota = input.claimedQuotaStatus !== undefined ? input.claimedQuotaStatus : input.previousQuotaStatus;
    const setFields: Record<string, unknown> = {
      validityFlag: input.previousValidityFlag,
      validityReason: input.previousReason,
      validityChecklistVersion: input.previousChecklistVersion ?? null,
      quotaTransition: null,
      updatedAt: input.previousUpdatedAt ?? input.expectedReviewedAt
    };
    const unsetFields: Record<string, ''> = {};

    if (input.previousReviewedBy !== undefined) {
      setFields.validityReviewedBy = input.previousReviewedBy;
    } else {
      unsetFields.validityReviewedBy = '';
    }
    if (input.previousReviewedAt !== undefined) {
      setFields.validityReviewedAt = input.previousReviewedAt;
    } else {
      unsetFields.validityReviewedAt = '';
    }
    if (input.previousQuotaStatus !== null) {
      setFields.quotaStatus = input.previousQuotaStatus;
    } else {
      unsetFields.quotaStatus = '';
    }
    if (input.previousQuotaRecordedAt !== undefined && input.previousQuotaRecordedAt !== null) {
      setFields.quotaRecordedAt = input.previousQuotaRecordedAt;
    } else {
      unsetFields.quotaRecordedAt = '';
    }
    if (input.previousQuotaRecordedBy !== undefined && input.previousQuotaRecordedBy !== null) {
      setFields.quotaRecordedBy = input.previousQuotaRecordedBy;
    } else {
      unsetFields.quotaRecordedBy = '';
    }

    return sessions.findOneAndUpdate(
      {
        id: input.sessionId,
        status: 'COMPLETED',
        studyRunId: input.studyRunId,
        validityFlag: expectedFlag,
        validityReviewedAt: input.expectedReviewedAt,
        quotaStatus: (expectedQuota ?? null) as never,
        ...(input.transitionId ? { 'quotaTransition.id': input.transitionId } : {})
      } as Filter<SessionDoc>,
      {
        $set: setFields,
        ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
        $pop: { validityHistory: 1 }
      },
      { returnDocument: 'after' }
    );
  }

  async claimSupplementalQuotaPromotion(input: ClaimSupplementalPromotionInput): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate(
      {
        id: input.sessionId,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        studyRunId: input.studyRunId,
        presentationVariant: input.variant,
        validityFlag: 'VALID',
        quotaStatus: 'SUPPLEMENTAL',
        quotaRecordedAt: (input.expectedRecordedAt ?? null) as never,
        ...AUDIT_SETTLED_GUARD
      },
      {
        $set: {
          quotaRecordedAt: input.at,
          quotaRecordedBy: input.recordedBy,
          ...(input.transition !== undefined ? { quotaTransition: input.transition } : {}),
          updatedAt: input.at
        }
      },
      { returnDocument: 'after' }
    );
  }

  async finalizeSupplementalQuotaPromotion(input: {
    sessionId: string;
    studyRunId: ObjectId;
    variant: Presentation;
    claimAt: Date;
    transitionId?: string;
    transitionState?: 'COMMITTED' | 'RECOVERED';
    auditLogged?: boolean;
  }): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    const setFields: Record<string, unknown> = {
      quotaStatus: 'INCLUDED',
      updatedAt: input.claimAt
    };
    if (input.transitionId) {
      setFields['quotaTransition.state'] = input.transitionState ?? 'COMMITTED';
      setFields['quotaTransition.committedQuotaStatus'] = 'INCLUDED';
      setFields['quotaTransition.updatedAt'] = input.claimAt;
      if (input.auditLogged !== undefined) {
        setFields['quotaTransition.auditLogged'] = input.auditLogged;
      }
    }
    return sessions.findOneAndUpdate(
      {
        id: input.sessionId,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        studyRunId: input.studyRunId,
        presentationVariant: input.variant,
        validityFlag: 'VALID',
        quotaStatus: 'SUPPLEMENTAL',
        quotaRecordedAt: input.claimAt,
        ...(input.transitionId ? { 'quotaTransition.id': input.transitionId, 'quotaTransition.state': 'PENDING' } : {})
      } as Filter<SessionDoc>,
      { $set: setFields },
      { returnDocument: 'after' }
    );
  }

  async markRunSessionQuotaAuditLogged(sessionId: string, transitionId: string): Promise<void> {
    const { sessions } = await collections();
    await sessions.updateOne(
      { id: sessionId, 'quotaTransition.id': transitionId } as Filter<SessionDoc>,
      { $set: { 'quotaTransition.auditLogged': true } }
    );
  }

  async revertSupplementalQuotaPromotion(input: RevertSupplementalPromotionInput): Promise<SessionDoc | null> {
    const { sessions } = await collections();
    return sessions.findOneAndUpdate(
      {
        id: input.sessionId,
        status: 'COMPLETED',
        studyRunId: input.studyRunId,
        presentationVariant: input.variant,
        validityFlag: 'VALID',
        quotaStatus: 'SUPPLEMENTAL',
        quotaRecordedAt: input.claimAt,
        ...(input.transitionId ? { 'quotaTransition.id': input.transitionId } : {})
      } as Filter<SessionDoc>,
      {
        $set: {
          quotaRecordedAt: input.previousRecordedAt,
          quotaRecordedBy: input.previousRecordedBy,
          quotaTransition: null,
          updatedAt: input.previousUpdatedAt ?? input.claimAt
        }
      },
      { returnDocument: 'after' }
    );
  }

  /** P4: Read-only reconciliation count of COMPLETED + VALID Study Run sessions by arm and quotaStatus (§6.4). */
  async countRunQuotaFromSessions(studyRunId: ObjectId): Promise<StudyRunDoc['arms']> {
    const { sessions } = await collections();
    const base = { studyRunId, status: 'COMPLETED' as const, validityFlag: 'VALID' as const };
    const [v1Included, v1Supplemental, v2Included, v2Supplemental] = await Promise.all([
      sessions.countDocuments({ ...base, presentationVariant: 'V1', quotaStatus: 'INCLUDED' }),
      sessions.countDocuments({ ...base, presentationVariant: 'V1', quotaStatus: 'SUPPLEMENTAL' }),
      sessions.countDocuments({ ...base, presentationVariant: 'V2', quotaStatus: 'INCLUDED' }),
      sessions.countDocuments({ ...base, presentationVariant: 'V2', quotaStatus: 'SUPPLEMENTAL' })
    ]);
    return {
      V1: { validIncluded: v1Included, supplementalValid: v1Supplemental },
      V2: { validIncluded: v2Included, supplementalValid: v2Supplemental }
    };
  }

  async dashboardCounts(phase?: StudyPhase, filters: SessionExportFilters = {}) {
    const { sessions } = await collections();
    const base = { ...(phase ? { phase } : {}), ...(filters.group ? { groupCode: filters.group } : {}), ...(filters.packageCode ? { assignedPackageCode: filters.packageCode } : {}), ...(filters.revision ? { assignedPackageRevision: filters.revision } : {}) };
    const [started, completed, active, incomplete, withdrawn, consented, valid, invalid, review, groupA, groupB, groupAValid, groupBValid] = await Promise.all([
      sessions.countDocuments(base),
      sessions.countDocuments({ ...base, status: 'COMPLETED' }),
      sessions.countDocuments({ ...base, status: 'ACTIVE' }),
      sessions.countDocuments({ ...base, status: 'INCOMPLETE' }),
      sessions.countDocuments({ ...base, status: 'WITHDRAWN' }),
      (await collections()).consents.aggregate([{ $match: { decision: 'ACCEPTED' } }, { $lookup: { from: 'sessions', localField: 'sessionId', foreignField: 'id', as: 's' } }, { $unwind: '$s' }, { $match: { ...(phase ? { 's.phase': phase } : {}), ...(filters.group ? { 's.groupCode': filters.group } : {}), ...(filters.packageCode ? { 's.assignedPackageCode': filters.packageCode } : {}), ...(filters.revision ? { 's.assignedPackageRevision': filters.revision } : {}) } }, { $count: 'n' }]).toArray().then(a => a[0]?.n ?? 0),
      sessions.countDocuments({ ...base, status: 'COMPLETED', validityFlag: 'VALID' }),
      sessions.countDocuments({ ...base, status: 'COMPLETED', validityFlag: 'INVALID' }),
      sessions.countDocuments({ ...base, status: 'COMPLETED', validityFlag: 'REVIEW_REQUIRED' }),
      sessions.countDocuments({ ...base, groupCode: 'A' }),
      sessions.countDocuments({ ...base, groupCode: 'B' }),
      sessions.countDocuments({ ...base, status: 'COMPLETED', groupCode: 'A', validityFlag: 'VALID' }),
      sessions.countDocuments({ ...base, status: 'COMPLETED', groupCode: 'B', validityFlag: 'VALID' })
    ]);
    return { started, completed, active, incomplete, withdrawn, consented, valid, invalid, review, groupA, groupB, groupAValid, groupBValid };
  }

  async listAllSessionsForExport(phase?: StudyPhase, filters: SessionExportFilters = {}): Promise<SessionDoc[]> {
    const { sessions } = await collections();
    return sessions.find(this.sessionFilter(phase, filters)).sort({ createdAt: 1 }).toArray();
  }

  private sessionFilter(phase?: StudyPhase, filters: SessionExportFilters = {}) {
    return {
      ...(phase ? { phase } : {}),
      ...(filters.group ? { groupCode: filters.group } : {}),
      ...(filters.variant ? { presentationVariant: filters.variant } : {}),
      ...(filters.packageCode ? { assignedPackageCode: filters.packageCode } : {}),
      ...(filters.revision ? { assignedPackageRevision: filters.revision } : {}),
      ...(filters.studyRunId ? { studyRunId: new ObjectId(filters.studyRunId) } : {})
    };
  }

  async analysisDataset(phase?: StudyPhase, completedOnly = true, filters: SessionExportFilters = {}) {
    const c = await collections();
    const sessions = await c.sessions.find({ ...this.sessionFilter(phase, filters), ...(completedOnly ? { status: 'COMPLETED' } : {}) }).toArray();
    const ids = sessions.map((s) => s.id);
    const [tests, readings] = ids.length ? await Promise.all([
      c.testAttempts.find({ sessionId: { $in: ids } }).toArray(),
      c.readingSessions.find({ sessionId: { $in: ids } }).toArray()
    ]) : [[], []];
    return { sessions, tests, readings };
  }

  async listEventData(phase?: StudyPhase, filters: SessionExportFilters = {}) {
    const c = await collections();
    const sessions = await c.sessions.find(this.sessionFilter(phase, filters)).project({ id: 1 }).toArray();
    const ids = sessions.map((s) => s.id);
    return ids.length ? c.experimentEvents.find({ sessionId: { $in: ids } }).sort({ createdAt: 1 }).toArray() : [];
  }

  async nextContentRevision(phase: StudyPhase): Promise<number> {
    const { contentRevisions } = await collections();
    const latest = await contentRevisions.find({ phase }).sort({ revision: -1 }).limit(1).next();
    return (latest?.revision ?? 0) + 1;
  }

  async nextQuestionRevision(phase: StudyPhase): Promise<number> {
    const { questionSets } = await collections();
    const latest = await questionSets.find({ phase }).sort({ revision: -1 }).limit(1).next();
    return (latest?.revision ?? 0) + 1;
  }

  async listContent(): Promise<ContentRevisionDoc[]> {
    const { contentRevisions } = await collections();
    return contentRevisions.find({}).sort({ revision: -1 }).toArray();
  }

  async listQuestionSets(): Promise<QuestionSetDoc[]> {
    const { questionSets } = await collections();
    return questionSets.find({}).sort({ revision: -1 }).toArray();
  }

  async insertContent(doc: ContentRevisionDoc): Promise<ObjectId> {
    const { contentRevisions } = await collections();
    return (await contentRevisions.insertOne(doc)).insertedId;
  }

  async updateDraftContent(id: ObjectId, update: Pick<ContentRevisionDoc, 'topicLabel' | 'rawContent' | 'contentHash' | 'wordCount'>): Promise<ContentRevisionDoc | null> {
    const { contentRevisions } = await collections();
    return contentRevisions.findOneAndUpdate(
      { _id: id, status: 'DRAFT', locked: false },
      { $set: update },
      { returnDocument: 'after' }
    );
  }

  async publishContent(id: ObjectId): Promise<ContentRevisionDoc | null> {
    const { contentRevisions } = await collections();
    return contentRevisions.findOneAndUpdate(
      { _id: id, status: 'DRAFT', locked: false },
      { $set: { status: 'PUBLISHED', locked: true, publishedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  async insertQuestionSet(doc: QuestionSetDoc): Promise<ObjectId> {
    const { questionSets } = await collections();
    return (await questionSets.insertOne(doc)).insertedId;
  }

  async updateDraftQuestionSet(id: ObjectId, update: Pick<QuestionSetDoc, 'label' | 'questions'>): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOneAndUpdate(
      { _id: id, status: 'DRAFT', locked: false },
      { $set: update },
      { returnDocument: 'after' }
    );
  }

  /** Updates a question set (both draft and published). */
  async updateQuestionSet(id: ObjectId, update: Pick<QuestionSetDoc, 'label' | 'questions'>): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOneAndUpdate(
      { _id: id },
      { $set: { label: update.label, questions: update.questions } },
      { returnDocument: 'after' }
    );
  }

  /** Checks if any participant test attempt has been recorded for this question set. */
  async hasTestAttemptsForQuestionSet(id: ObjectId): Promise<boolean> {
    const { testAttempts } = await collections();
    return (await testAttempts.countDocuments({ questionSetId: id }, { limit: 1 })) > 0;
  }

  /** Deletes if unreferenced, or archives (soft delete) if responses or packages reference it. */
  async deleteOrArchiveQuestionSet(id: ObjectId, by: string, at: Date): Promise<{ deleted: boolean; archived: boolean }> {
    const { questionSets, testAttempts, contentPackages } = await collections();
    const hasAttempts = (await testAttempts.countDocuments({ questionSetId: id }, { limit: 1 })) > 0;
    const isOwned = (await contentPackages.countDocuments({ questionSetId: id }, { limit: 1 })) > 0;
    if (hasAttempts || isOwned) {
      await questionSets.findOneAndUpdate({ _id: id, archivedAt: null }, { $set: { archivedAt: at, archivedBy: by } });
      return { deleted: false, archived: true };
    }
    const res = await questionSets.deleteOne({ _id: id });
    return { deleted: res.deletedCount > 0, archived: false };
  }

  /** P5: hides a question set from new Study Runs. Nothing is edited or deleted; runs and sessions that already use it are unaffected. */
  async archiveQuestionSet(id: ObjectId, by: string, at: Date): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOneAndUpdate({ _id: id, archivedAt: null }, { $set: { archivedAt: at, archivedBy: by } }, { returnDocument: 'after' });
  }

  /** P5-D. Both variants default to unlocked; a missing document means nothing was ever locked. */
  async getVariantLocks(): Promise<Record<Presentation, VariantLock>> {
    const { experimentConfig } = await collections();
    const doc = await (experimentConfig as unknown as Collection<VariantLocksDoc>).findOne({ key: 'variant-locks' });
    return { V1: doc?.locks?.V1 ?? UNLOCKED, V2: doc?.locks?.V2 ?? UNLOCKED };
  }

  /** Touches ONLY the given variant's entry: locking V1 can never change V2. */
  async setVariantLock(variant: Presentation, locked: boolean, by: string, at: Date): Promise<void> {
    const { experimentConfig } = await collections();
    const lock: VariantLock = { locked, changedBy: by, changedAt: at };
    await (experimentConfig as unknown as Collection<VariantLocksDoc>).updateOne(
      { key: 'variant-locks' },
      { $set: { [`locks.${variant}`]: lock, updatedAt: at } },
      { upsert: true }
    );
  }

  async publishQuestionSet(id: ObjectId): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOneAndUpdate(
      { _id: id, status: 'DRAFT', locked: false },
      { $set: { status: 'PUBLISHED', locked: true, publishedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }
}
