import { ObjectId, type Filter } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { ensureIndexes } from '@/lib/db/indexes';
import type { StudyRunDoc, StudyRunStatus } from '@/types/study-run';

/**
 * The ONLY fields an admin write may change after creation. Deliberately absent:
 * `arms` (quota counters belong to the P4 quota service), `snapshot`, `code`, `locked` (P2), `version`
 * (managed by the compare-and-set itself) and the audit-style creation fields.
 */
export const STUDY_RUN_ADMIN_WRITABLE_FIELDS = [
  'status',
  'statusChangedBy',
  'statusChangedAt',
  'targetSampleSize',
  'quotaPerArm',
  'quotaConfirmedBy',
  'quotaConfirmedAt',
  'entryPolicy',
  'infoConsentReview'
] as const;

export type StudyRunAdminUpdate = Partial<Pick<StudyRunDoc, (typeof STUDY_RUN_ADMIN_WRITABLE_FIELDS)[number]>>;

/** Narrow persistence port used by StudyRunService (a fake implements it in unit tests). */
export interface StudyRunStore {
  insert(doc: StudyRunDoc): Promise<ObjectId>;
  getById(id: ObjectId): Promise<StudyRunDoc | null>;
  list(filter?: { status?: StudyRunStatus }): Promise<StudyRunDoc[]>;
  /**
   * Compare-and-set on `version`: applies `update` and increments `version` only when the stored version equals
   * `expectedVersion` (and `guard`, when given, also matches). Returns the new document, or null when nothing matched.
   */
  updateIfVersion(
    id: ObjectId,
    expectedVersion: number,
    update: StudyRunAdminUpdate,
    guard?: Filter<StudyRunDoc>
  ): Promise<StudyRunDoc | null>;
}

export class StudyRunRepository implements StudyRunStore {
  async insert(doc: StudyRunDoc): Promise<ObjectId> {
    // The unique `code` index is what rejects duplicate run codes; make sure it exists (same pattern as SessionService.create).
    await ensureIndexes();
    const { studyRuns } = await collections();
    return (await studyRuns.insertOne(doc)).insertedId;
  }

  async getById(id: ObjectId): Promise<StudyRunDoc | null> {
    const { studyRuns } = await collections();
    return studyRuns.findOne({ _id: id });
  }

  async list(filter: { status?: StudyRunStatus } = {}): Promise<StudyRunDoc[]> {
    const { studyRuns } = await collections();
    return studyRuns.find(filter.status ? { status: filter.status } : {}).sort({ createdAt: -1 }).toArray();
  }

  async updateIfVersion(
    id: ObjectId,
    expectedVersion: number,
    update: StudyRunAdminUpdate,
    guard: Filter<StudyRunDoc> = {}
  ): Promise<StudyRunDoc | null> {
    const allowed = new Set<string>(STUDY_RUN_ADMIN_WRITABLE_FIELDS);
    const keys = Object.keys(update);
    // Runtime guard in addition to the type: a stray key (e.g. `arms`) must never reach the database.
    if (!keys.length || keys.some((key) => !allowed.has(key))) throw new Error('STUDY_RUN_FIELD_NOT_WRITABLE');
    const { studyRuns } = await collections();
    return studyRuns.findOneAndUpdate(
      { ...guard, _id: id, version: expectedVersion },
      { $set: update, $inc: { version: 1 } },
      { returnDocument: 'after' }
    );
  }
}
