import type { ObjectId } from 'mongodb';
import type { Presentation } from './research';

export type InvitationStatus = 'ISSUED' | 'REDEEMED' | 'REVOKED';

/** One Admin-issued permission to hand a REDEEMED invitation's session to a new browser (architecture §6.2). */
export interface InvitationRecovery {
  authorizedBy: string;
  authorizedAt: Date;
  reason: string;
  expiresAt: Date;
  consumedAt: Date | null;
  cancelledAt: Date | null;
}

/** The raw token is never stored: only its SHA-256. There is no automatic expiry. */
export interface InvitationDoc {
  _id?: ObjectId;
  studyRunId: ObjectId;
  variant: Presentation;
  /** P5: the question set (and its revision) the link will use, copied from the run snapshot when the link is issued. Absent on older invitations. */
  questionSetId?: ObjectId;
  questionSetRevision?: number;
  tokenHash: string;
  status: InvitationStatus;
  /** Allocated by the redeem CAS (absent while ISSUED) so a retry after a mid-way failure reuses the same id. */
  sessionId?: string;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  replacesInvitationId: ObjectId | null;
  /** Short administrative note. Must not contain personal data. */
  label: string | null;
  recovery: InvitationRecovery | null;
  createdBy: string;
  createdAt: Date;
}
