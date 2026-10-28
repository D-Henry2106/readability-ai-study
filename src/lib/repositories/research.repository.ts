import { ObjectId, type Filter } from 'mongodb';
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
  QuestionSetDoc,
  ReadingSessionDoc,
  SessionDoc,
  StudyPhase,
  TestAttemptDoc,
  ValidityFlag
} from '@/types/research';

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

export class ResearchRepository {
  async getConfig(): Promise<ExperimentConfigDoc> {
    const { experimentConfig } = await collections();
    return (await experimentConfig.findOne({ key: 'active' })) ?? defaultConfig;
  }

  async upsertConfig(update: Partial<Omit<ExperimentConfigDoc, '_id' | 'key'>>): Promise<ExperimentConfigDoc> {
    const { experimentConfig } = await collections();
    await experimentConfig.updateOne(
      { key: 'active' },
      { $set: { ...update, updatedAt: new Date() }, $setOnInsert: { key: 'active' } },
      { upsert: true }
    );
    return (await experimentConfig.findOne({ key: 'active' })) as ExperimentConfigDoc;
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
      { id, currentStage: 'TEST_2', status: 'ACTIVE' },
      { $set: { currentStage: 'COMPLETED', status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() } },
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
    await adminAudit.insertOne(audit);
  }

  async listSessions(options: {
    page: number;
    pageSize: number;
    search?: string;
    packageCode?: string;
    status?: SessionDoc['status'];
    groupCode?: GroupCode;
    validityFlag?: ValidityFlag;
    phase?: StudyPhase;
    sort?: 'newest' | 'oldest';
  }): Promise<{ items: SessionDoc[]; total: number }> {
    const { sessions } = await collections();
    const filter: Filter<SessionDoc> = {};
    if (options.search) filter.id = { $regex: options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (options.status) filter.status = options.status;
    if (options.packageCode) filter.assignedPackageCode = options.packageCode.trim().toUpperCase();
    if (options.groupCode) filter.groupCode = options.groupCode;
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

  async dashboardCounts(phase?: StudyPhase, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}) {
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

  async listAllSessionsForExport(phase?: StudyPhase, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}): Promise<SessionDoc[]> {
    const { sessions } = await collections();
    return sessions.find(this.sessionFilter(phase, filters)).sort({ createdAt: 1 }).toArray();
  }

  private sessionFilter(phase?: StudyPhase, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}) {
    return { ...(phase ? { phase } : {}), ...(filters.group ? { groupCode: filters.group } : {}),
      ...(filters.packageCode ? { assignedPackageCode: filters.packageCode } : {}),
      ...(filters.revision ? { assignedPackageRevision: filters.revision } : {}) };
  }

  async analysisDataset(phase?: StudyPhase, completedOnly = true, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}) {
    const c = await collections();
    const sessions = await c.sessions.find({ ...this.sessionFilter(phase, filters), ...(completedOnly ? { status: 'COMPLETED' } : {}) }).toArray();
    const ids = sessions.map((s) => s.id);
    const [tests, readings] = ids.length ? await Promise.all([
      c.testAttempts.find({ sessionId: { $in: ids } }).toArray(),
      c.readingSessions.find({ sessionId: { $in: ids } }).toArray()
    ]) : [[], []];
    return { sessions, tests, readings };
  }

  async listEventData(phase?: StudyPhase, filters: { group?: GroupCode; packageCode?: string; revision?: number } = {}) {
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

  async publishQuestionSet(id: ObjectId): Promise<QuestionSetDoc | null> {
    const { questionSets } = await collections();
    return questionSets.findOneAndUpdate(
      { _id: id, status: 'DRAFT', locked: false },
      { $set: { status: 'PUBLISHED', locked: true, publishedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }
}
