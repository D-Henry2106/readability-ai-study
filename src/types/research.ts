import type { ObjectId } from 'mongodb';

export type ExperimentStage =
  | 'INFORMATION'
  | 'CONSENT'
  | 'DEMOGRAPHICS'
  | 'READING_1'
  | 'REVIEW_1'
  | 'TEST_1'
  | 'BREAK'
  | 'READING_2'
  | 'REVIEW_2'
  | 'TEST_2'
  | 'COMPLETED';

export type SessionStatus = 'ACTIVE' | 'DECLINED' | 'WITHDRAWN' | 'INCOMPLETE' | 'COMPLETED';
export type GroupCode = 'A' | 'B';
export type Presentation = 'V1' | 'V2';
export type ValidityFlag = 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';
export type QuotaStatus = 'INCLUDED' | 'SUPPLEMENTAL' | 'NOT_COUNTED';
export type QuotaTransitionKind = 'VALID_CLAIM' | 'DEMOTE_VALID' | 'PROMOTE_SUPPLEMENTAL';
export type QuotaTransitionState = 'PENDING' | 'COMMITTED' | 'RECOVERED';
export type StudyPhase = 'PILOT' | 'MAIN';
export type AdminRole = 'RESEARCHER' | 'SUPERVISOR';
export type PublicationStatus = 'DRAFT' | 'PUBLISHED';
export type PackageStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AssignmentMode = 'FIXED' | 'RANDOM';
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

/**
 * Durable record of one counter-affecting quota transition, stored on the session (P4).
 * Field names are the contract used by StudyRunQuotaService, the session store and the test fakes.
 */
export interface SessionQuotaTransition {
  id: string;
  kind: QuotaTransitionKind;
  state: QuotaTransitionState;
  previousValidityFlag: ValidityFlag;
  previousReason: string | null;
  previousReviewedBy?: string;
  previousReviewedAt: Date | null;
  previousChecklistVersion: number | null;
  previousQuotaStatus: QuotaStatus | null;
  previousQuotaRecordedAt: Date | null;
  previousQuotaRecordedBy: string | null;
  previousUpdatedAt: Date;
  targetValidityFlag: ValidityFlag;
  reason: string | null;
  actorUsername: string;
  actorRole: AdminRole;
  checklistVersion: number | null;
  /** Per-session monotonic timestamp of the claim (also the claim's `validityReviewedAt`). */
  claimedAt: Date;
  updatedAt: Date;
  /** Written by the finalize step. */
  committedQuotaStatus?: QuotaStatus;
  /**
   * `false` from creation until the `admin_audit` entry for this transition is durably written
   * (idempotent by `quota-transition:<id>`); `true` afterwards. Absent on transitions created before this field existed.
   */
  auditLogged?: boolean;
}

export interface ExperimentConfigDoc {
  _id?: ObjectId;
  key: 'active';
  phase: StudyPhase;
  studyPublished?: boolean;
  assignmentMode?: AssignmentMode;
  fixedPackageId?: string | null;
  mainRandomApproved?: boolean;
  allowPilotRetakes?: boolean;
  informationText: string | null;
  informationVersion: string | null;
  consentText: string | null;
  consentVersion: string | null;
  debriefText: string | null;
  debriefVersion: string | null;
  dataRightsText: string | null;
  findingsText: string | null;
  minimumReadingSeconds: number | null;
  minimumValidTarget: number;
  recruitmentTarget: number;
  updatedAt: Date;
}

export interface SessionDoc {
  _id?: ObjectId;
  id: string;
  participantId?: string;
  status: SessionStatus;
  currentStage: ExperimentStage;
  groupCode: GroupCode | null;
  contentRevisionId: ObjectId;
  questionSetId: ObjectId;
  assignedPackageId?: ObjectId;
  assignedPackageRevision?: number;
  assignedPackageCode?: string;
  assignedPackageTopic?: string;
  packageAssignmentMethod?: AssignmentMode | 'LEGACY';
  packageAssignedAt?: Date;
  informationVersion: string;
  consentVersion: string;
  debriefVersion: string;
  informationTextSnapshot?: string;
  consentTextSnapshot?: string;
  debriefTextSnapshot?: string;
  dataRightsTextSnapshot?: string;
  findingsTextSnapshot?: string;
  minimumReadingSeconds?: number;
  phase: StudyPhase;
  deviceType: DeviceType;
  validityFlag: ValidityFlag;
  validityReason: string | null;
  validityReviewedBy?: string;
  validityReviewedAt?: Date;
  /** Set only after the full evidence checklist passes at review time. */
  validityChecklistVersion?: number | null;
  validityHistory?: Array<{ flag: ValidityFlag; reason: string | null; reviewedBy: string; reviewedAt: Date }>;
  pilotRestartedAt?: Date;
  /** Study Run fields (P2). Absent on every legacy session: absence means the legacy flow. */
  studyRunId?: ObjectId;
  invitationId?: ObjectId;
  presentationVariant?: Presentation;
  presentationVersion?: number | null;
  presentationProfileId?: ObjectId;
  /** Revision of the question set pinned by the invitation (P5). Absent on older sessions. */
  questionSetRevision?: number;
  /** Study Run quota recording fields (P4). Only written by the quota service on Admin validity/quota actions. */
  quotaStatus?: QuotaStatus;
  quotaRecordedAt?: Date | null;
  quotaRecordedBy?: string | null;
  quotaTransition?: SessionQuotaTransition | null;
  pilotReplacementSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  withdrawnAt: Date | null;
}

export interface ConsentDoc {
  _id?: ObjectId;
  sessionId: string;
  informationVersion: string;
  consentVersion: string;
  decision: 'ACCEPTED' | 'DECLINED';
  decidedAt: Date;
}

export interface DemographicsDoc {
  _id?: ObjectId;
  sessionId: string;
  ageRange: string | null;
  gender: string | null;
  fieldOfStudy: string | null;
  yearOfStudy: string | null;
  aiUsageFrequency: string | null;
  onlineReadingFrequency: string | null;
  submittedAt: Date;
}

export interface ContentRevisionDoc {
  _id?: ObjectId;
  revision: number;
  topicLabel: string;
  rawContent: string;
  v2Content?: string | null;
  contentHash: string;
  wordCount: number;
  status: PublicationStatus;
  locked: boolean;
  phase: StudyPhase;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface QuestionItem {
  id: string;
  prompt: string;
  category?: 'CONCEPTUAL' | 'TERMINOLOGY' | 'RELATIONSHIP' | 'CONDITIONAL' | 'INFERENTIAL';
  options: QuestionOption[];
}

export interface QuestionSetDoc {
  _id?: ObjectId;
  revision: number;
  label: string;
  questions: QuestionItem[];
  status: PublicationStatus;
  locked: boolean;
  phase: StudyPhase;
  createdAt: Date;
  publishedAt: Date | null;
  /** P5: archiving only hides a set from new Study Runs. Absent on older documents. The set itself is never edited or deleted. */
  archivedAt?: Date | null;
  archivedBy?: string | null;
}

/** P5-D: per-variant intake lock. Locking V1 never touches V2. Stored once, in `experiment_config` under key 'variant-locks'. */
export interface VariantLock {
  locked: boolean;
  changedBy: string | null;
  changedAt: Date | null;
}
export interface VariantLocksDoc {
  _id?: ObjectId;
  key: 'variant-locks';
  locks: Record<Presentation, VariantLock>;
  updatedAt: Date;
}

export interface ContentPackageDoc {
  _id?: ObjectId;
  code: string;
  title: string;
  topic: string;
  description: string;
  phase: StudyPhase;
  contentRevisionId: ObjectId;
  questionSetId?: ObjectId | null;
  revision: number;
  status: PackageStatus;
  enabled: boolean;
  aiSource: string | null;
  v2Content?: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
}

export interface ReadingSessionDoc {
  _id?: ObjectId;
  sessionId: string;
  roundNo: 1 | 2;
  presentation: Presentation;
  presentationVersion?: number | null;
  renderedAt: Date | null;
  nextClickedAt: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
  readingSeconds: number | null;
  scrollCount: number;
  maxScrollDepthPercent: number;
}

export interface TestAnswer {
  questionId: string;
  selectedOptionId: string | null;
  isCorrect: boolean | null;
}

export interface TestAttemptDoc {
  _id?: ObjectId;
  sessionId: string;
  roundNo: 1 | 2;
  presentation: Presentation;
  presentationVersion?: number | null;
  questionSetId: ObjectId;
  answers: TestAnswer[];
  score: number;
  startedAt: Date;
  submittedAt: Date;
}

export interface BreakDoc {
  _id?: ObjectId;
  sessionId: string;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ExperimentEventDoc {
  _id?: ObjectId;
  eventKey?: string;
  stage?: ExperimentStage;
  sessionId: string;
  type:
    | 'SESSION_STARTED'
    | 'INFORMATION_SHOWN'
    | 'CONSENT_ACCEPTED'
    | 'CONSENT_DECLINED'
    | 'DEMOGRAPHICS_SUBMITTED'
    | 'GROUP_ASSIGNED'
    | 'PACKAGE_ASSIGNED'
    | 'READING_STARTED'
    | 'READING_FINISHED'
    | 'TEST_REVIEW_CONFIRMED'
    | 'TEST_STARTED'
    | 'TEST_SUBMITTED'
    | 'BREAK_STARTED'
    | 'BREAK_FINISHED'
    | 'SESSION_COMPLETED'
    | 'WITHDRAWAL_REQUESTED'
    | 'SESSION_ABANDONED';
  roundNo?: 1 | 2 | null;
  createdAt: Date;
}

export interface AdminDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  role: AdminRole;
  createdAt: Date;
  /** Set when an account is disabled; a disabled admin can neither log in nor keep a session. */
  disabledAt?: Date | null;
  passwordChangedAt?: Date | null;
}

/** Server-side admin session. Only the hash of the random cookie token is stored. */
export interface AdminSessionDoc {
  _id?: ObjectId;
  tokenHash: string;
  username: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason?: string | null;
}

/** Fixed-window counter shared by every server instance (keys are keyed hashes, never raw IPs). */
export interface RateLimitDoc {
  _id?: ObjectId;
  key: string;
  windowStart: Date;
  count: number;
  expiresAt: Date;
}

export interface AdminAuditDoc {
  _id?: ObjectId;
  username: string;
  role: AdminRole | 'SYSTEM';
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
  /** Optional idempotency key: at most one audit entry per key (unique partial index). */
  dedupeKey?: string;
}
