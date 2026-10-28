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
export type StudyPhase = 'PILOT' | 'MAIN';
export type AdminRole = 'RESEARCHER' | 'SUPERVISOR';
export type PublicationStatus = 'DRAFT' | 'PUBLISHED';
export type PackageStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AssignmentMode = 'FIXED' | 'RANDOM';
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

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
}

export interface ContentPackageDoc {
  _id?: ObjectId;
  code: string;
  title: string;
  topic: string;
  description: string;
  phase: StudyPhase;
  contentRevisionId: ObjectId;
  questionSetId: ObjectId;
  revision: number;
  status: PackageStatus;
  enabled: boolean;
  aiSource: string | null;
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
  roundNo?: 1 | 2;
  createdAt: Date;
}

export interface AdminDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  role: AdminRole;
  createdAt: Date;
}

export interface AdminAuditDoc {
  _id?: ObjectId;
  username: string;
  role: AdminRole;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: Date;
}
