import { ObjectId, type Filter } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { ensureIndexes } from '@/lib/db/indexes';
import type { Presentation } from '@/types/research';
import type { StudyRunAppliedQuotaTransition, StudyRunDoc, StudyRunStatus } from '@/types/study-run';

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
  'infoConsentReview',
  'presentation'
] as const;

export type StudyRunAdminUpdate = Partial<Pick<StudyRunDoc, (typeof STUDY_RUN_ADMIN_WRITABLE_FIELDS)[number]>>;

/**
 * P4: Narrow quota counter transitions on `arms.<variant>`. Only called by `StudyRunQuotaService` upon explicit Admin
 * validity/quota actions (architecture §2.4, §6.4, AC-03 clause 3). Never modifies status, version or configuration.
 */
export type StudyRunQuotaCounterTransition =
  | 'CLAIM_INCLUDED'
  | 'INCREMENT_SUPPLEMENTAL'
  | 'RELEASE_INCLUDED'
  | 'RELEASE_SUPPLEMENTAL'
  | 'PROMOTE_SUPPLEMENTAL'
  | 'REVERT_PROMOTE_SUPPLEMENTAL';

/** Narrow persistence port used by StudyRunService and StudyRunQuotaService (a fake implements it in unit tests). */
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
  /**
   * P2/P3: CAS `locked: false -> true`. When `expectedV2` is given the lock also requires the run to still be bound to exactly
   * that V2 presentation profile and version, so the binding that was validated is the binding that gets frozen (§6.5).
   */
  lockIfUnlocked(id: ObjectId, expectedV2?: { profileId: ObjectId; version: number }): Promise<StudyRunDoc | null>;
  /** P2: true when at least one OPEN run chose `legacyEntry = BLOCKED_WHILE_OPEN` (enforced by /api/session). */
  hasOpenRunBlockingLegacyEntry(): Promise<boolean>;
  /**
   * P4: Atomic bounded counter transition on `arms.<variant>`, idempotent by `transitionId`.
   * Writes the `quotaLedger.<transitionId>` marker and the `$inc` in the SAME single-document atomic operation on `study_runs`.
   */
  applyQuotaCounterTransition(
    id: ObjectId,
    variant: Presentation,
    transition: StudyRunQuotaCounterTransition,
    transitionId?: string,
    options?: StudyRunQuotaCounterOptions
  ): Promise<StudyRunDoc | null>;
}

export interface StudyRunQuotaCounterOptions {
  /** Session the counter change belongs to; recorded on the ledger marker. */
  sessionId?: string;
  /** Per-session monotonic `claimedAt` of the owning session transition; recorded on the ledger marker. */
  claimedAt?: Date;
  /**
   * Marks this transition as the compensation (rollback) of `compensates` (a ledger key). It is applied only if that
   * transition is in the ledger AND no other transition has already released the same session's slot since
   * (evaluated atomically in the same single-document update). Requires `sessionId`.
   */
  compensates?: string;
}

export function outcomeForTransition(transition: StudyRunQuotaCounterTransition): StudyRunAppliedQuotaTransition['outcome'] {
  switch (transition) {
    case 'CLAIM_INCLUDED':
    case 'PROMOTE_SUPPLEMENTAL':
      return 'INCLUDED';
    case 'INCREMENT_SUPPLEMENTAL':
    case 'REVERT_PROMOTE_SUPPLEMENTAL':
      return 'SUPPLEMENTAL';
    case 'RELEASE_INCLUDED':
    case 'RELEASE_SUPPLEMENTAL':
      return 'NOT_COUNTED';
  }
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

  async lockIfUnlocked(id: ObjectId, expectedV2?: { profileId: ObjectId; version: number }): Promise<StudyRunDoc | null> {
    const { studyRuns } = await collections();
    const filter = expectedV2
      ? { _id: id, locked: false, 'presentation.V2.profileId': expectedV2.profileId, 'presentation.V2.version': expectedV2.version }
      : { _id: id, locked: false };
    return studyRuns.findOneAndUpdate(filter, { $set: { locked: true }, $inc: { version: 1 } }, { returnDocument: 'after' });
  }

  async hasOpenRunBlockingLegacyEntry(): Promise<boolean> {
    const { studyRuns } = await collections();
    return (await studyRuns.countDocuments({ status: 'OPEN', 'entryPolicy.legacyEntry': 'BLOCKED_WHILE_OPEN' }, { limit: 1 })) > 0;
  }

  async applyQuotaCounterTransition(
    id: ObjectId,
    variant: Presentation,
    transition: StudyRunQuotaCounterTransition,
    transitionId?: string,
    options: StudyRunQuotaCounterOptions = {}
  ): Promise<StudyRunDoc | null> {
    if (variant !== 'V1' && variant !== 'V2') throw new Error('INVALID_PRESENTATION_VARIANT');
    const { studyRuns } = await collections();
    const txId = transitionId ?? new ObjectId().toHexString();
    const ledgerPath = `quotaLedger.${txId}`;
    const incPath = `arms.${variant}.validIncluded`;
    const supPath = `arms.${variant}.supplementalValid`;
    const marker: StudyRunAppliedQuotaTransition = {
      transitionId: txId,
      variant,
      transition,
      outcome: outcomeForTransition(transition),
      appliedAt: new Date(),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.claimedAt ? { claimedAt: options.claimedAt } : {})
    };

    let filter: Filter<StudyRunDoc>;
    let inc: Record<string, number>;
    switch (transition) {
      case 'CLAIM_INCLUDED':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          quotaPerArm: { $gt: 0 },
          $expr: { $lt: [`$${incPath}`, '$quotaPerArm'] }
        } as Filter<StudyRunDoc>;
        inc = { [incPath]: 1 };
        break;
      case 'INCREMENT_SUPPLEMENTAL':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          quotaPerArm: { $gt: 0 }
        } as Filter<StudyRunDoc>;
        inc = { [supPath]: 1 };
        break;
      case 'RELEASE_INCLUDED':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          [incPath]: { $gte: 1 }
        } as Filter<StudyRunDoc>;
        inc = { [incPath]: -1 };
        break;
      case 'RELEASE_SUPPLEMENTAL':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          [supPath]: { $gte: 1 }
        } as Filter<StudyRunDoc>;
        inc = { [supPath]: -1 };
        break;
      case 'PROMOTE_SUPPLEMENTAL':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          quotaPerArm: { $gt: 0 },
          [supPath]: { $gte: 1 },
          $expr: { $lt: [`$${incPath}`, '$quotaPerArm'] }
        } as Filter<StudyRunDoc>;
        inc = { [incPath]: 1, [supPath]: -1 };
        break;
      case 'REVERT_PROMOTE_SUPPLEMENTAL':
        filter = {
          _id: id,
          [ledgerPath]: { $exists: false },
          [incPath]: { $gte: 1 }
        } as Filter<StudyRunDoc>;
        inc = { [incPath]: -1, [supPath]: 1 };
        break;
    }

    if (options.compensates) {
      if (!options.sessionId) throw new Error('COMPENSATION_REQUIRES_SESSION');
      const target = `quotaLedger.${options.compensates}`;
      // Atomic ownership guard: the compensated transition must be recorded and no other release of THIS session's slot
      // may exist at or after its claim. Without it a slow request could release a slot a faster one already released.
      const alreadyReleased = {
        $anyElementTrue: [
          {
            $map: {
              input: { $objectToArray: { $ifNull: ['$quotaLedger', {}] } },
              as: 'e',
              in: {
                $and: [
                  { $eq: ['$$e.v.sessionId', options.sessionId] },
                  { $in: ['$$e.v.transition', ['RELEASE_INCLUDED', 'RELEASE_SUPPLEMENTAL']] },
                  { $gte: ['$$e.v.claimedAt', `$${target}.claimedAt`] }
                ]
              }
            }
          }
        ]
      };
      filter = { $and: [filter, { [target]: { $exists: true } }, { $expr: { $not: [alreadyReleased] } }] } as Filter<StudyRunDoc>;
    }

    const updated = await studyRuns.findOneAndUpdate(
      filter,
      { $inc: inc, $set: { [ledgerPath]: marker } },
      { returnDocument: 'after' }
    );
    if (updated) return updated;

    // Idempotent retry check: if `txId` was already applied in an earlier attempt (e.g. before a crash or network drop),
    // return the persisted document without modifying the counter a second time.
    if (transitionId) {
      const existing = await studyRuns.findOne({ _id: id });
      const applied = existing?.quotaLedger?.[transitionId];
      if (existing && applied && applied.transition === transition && applied.variant === variant) {
        return existing;
      }
    }
    return null;
  }
}
