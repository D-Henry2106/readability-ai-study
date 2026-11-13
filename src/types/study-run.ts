import type { ObjectId } from 'mongodb';
import type { StudyPhase } from './research';

export type StudyRunStatus = 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
/** Independent of StudyRunStatus: how a Study Run session may be created. */
export type StudyRunEntryMode = 'INVITATION_ONLY';
/** Effect of an OPEN run on the legacy public entry point (/api/session). Enforced from P2, stored from P1. */
export type LegacyEntryPolicy = 'UNCHANGED' | 'BLOCKED_WHILE_OPEN';

export interface StudyRunArmCounters {
  validIncluded: number;
  supplementalValid: number;
}

export interface StudyRunAppliedQuotaTransition {
  transitionId: string;
  variant: 'V1' | 'V2';
  transition: string;
  outcome: 'INCLUDED' | 'SUPPLEMENTAL' | 'NOT_COUNTED';
  appliedAt: Date;
  /** Session the counter change belongs to (lets a compensation prove nobody else already released it). */
  sessionId?: string;
  /** Per-session monotonic `claimedAt` of the owning session transition (not an app-server clock). */
  claimedAt?: Date;
}

export interface StudyRunEntryPolicy {
  entryMode: StudyRunEntryMode;
  legacyEntry: LegacyEntryPolicy;
  confirmedBy: string;
  confirmedAt: Date;
}

/** Admin's manual confirmation that Information/Consent/Debrief fit the one-round design. Texts themselves are never edited. */
export interface StudyRunInfoConsentReview {
  confirmedBy: string;
  confirmedAt: Date;
  informationVersion: string;
  consentVersion: string;
  debriefVersion: string;
  informationSha256: string;
  consentSha256: string;
  debriefSha256: string;
}

/** Immutable after creation. */
export interface StudyRunSnapshot {
  packageId: ObjectId;
  packageCode: string;
  packageRevision: number;
  contentRevisionId: ObjectId;
  questionSetId: ObjectId;
  /** P5: revision of the snapshotted question set. Absent on runs created before P5. */
  questionSetRevision?: number;
}

export interface StudyRunDoc {
  _id?: ObjectId;
  code: string;
  name: string;
  phase: StudyPhase;
  status: StudyRunStatus;
  entryMode: StudyRunEntryMode;
  /** null until the Admin explicitly confirms it; there is no implicit default. */
  entryPolicy: StudyRunEntryPolicy | null;
  /** Even, >= 2. */
  targetSampleSize: number;
  /** null until the Admin confirms the proposed N/2 split; reset to null whenever targetSampleSize changes. */
  quotaPerArm: number | null;
  quotaConfirmedBy: string | null;
  quotaConfirmedAt: Date | null;
  snapshot: StudyRunSnapshot;
  /** V2 stays empty until P3 (presentation profiles). */
  presentation: {
    V1: { version: number | null };
    V2: { profileId: ObjectId | null; version: number | null };
  };
  /** Quota counters: initialised to 0 in P1 and NOT written by any P1 code path (quota recording is P4). */
  arms: { V1: StudyRunArmCounters; V2: StudyRunArmCounters };
  /** Durable idempotency ledger for P4 quota counter transitions, written atomically with `arms` updates. */
  quotaLedger?: Record<string, StudyRunAppliedQuotaTransition>;
  infoConsentReview: StudyRunInfoConsentReview | null;
  /** Set by P2 when the first invitation is issued; never written in P1. */
  locked: boolean;
  /** Optimistic-locking counter; starts at 1 and is incremented by every admin write. */
  version: number;
  createdBy: string;
  createdAt: Date;
  statusChangedBy: string;
  statusChangedAt: Date;
}
