import type { ObjectId } from 'mongodb';
import { collections } from '@/lib/db/collections';
import { ensureIndexes } from '@/lib/db/indexes';
import type { InvitationDoc, InvitationRecovery } from '@/types/invitation';

/** Admin-side persistence (used only by InvitationService, which checks the RESEARCHER role). */
export interface InvitationAdminStore {
  /** Documents carry their own `_id` (the invitation code). */
  insertMany(docs: InvitationDoc[]): Promise<void>;
  getById(id: ObjectId): Promise<InvitationDoc | null>;
  listByRun(studyRunId: ObjectId): Promise<InvitationDoc[]>;
  /** CAS ISSUED -> REVOKED. */
  revokeIfIssued(id: ObjectId, by: string, reason: string, at: Date): Promise<InvitationDoc | null>;
  /** CAS: sets `recovery` only if the invitation is REDEEMED and has no authorization that is still usable. */
  authorizeRecovery(id: ObjectId, recovery: InvitationRecovery, now: Date): Promise<InvitationDoc | null>;
  /** CAS: cancels an authorization that is neither consumed nor cancelled. */
  cancelRecovery(id: ObjectId, at: Date): Promise<InvitationDoc | null>;
}

/**
 * Participant-side persistence (architecture §2.4). Its ONLY writes are the two CAS operations below; there is no
 * general update. Reads are by token hash or id.
 */
export interface InvitationRedemptionStore {
  findByTokenHash(tokenHash: string): Promise<InvitationDoc | null>;
  findById(id: ObjectId): Promise<InvitationDoc | null>;
  /** CAS ISSUED -> REDEEMED, recording the pre-allocated sessionId. Null when someone else already claimed it. */
  claimIssued(id: ObjectId, sessionId: string, at: Date): Promise<InvitationDoc | null>;
  /** CAS on `recovery.consumedAt: null -> now` (only while REDEEMED, not cancelled, not expired). */
  consumeRecovery(id: ObjectId, now: Date): Promise<InvitationDoc | null>;
}

export class InvitationRepository implements InvitationAdminStore {
  async insertMany(docs: InvitationDoc[]): Promise<void> {
    // Unique tokenHash / sessionId indexes are what enforce one-invitation-one-session; make sure they exist.
    await ensureIndexes();
    const { invitations } = await collections();
    await invitations.insertMany(docs, { ordered: true });
  }
  async getById(id: ObjectId): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOne({ _id: id });
  }
  async listByRun(studyRunId: ObjectId): Promise<InvitationDoc[]> {
    const { invitations } = await collections();
    return invitations.find({ studyRunId }).sort({ createdAt: 1, _id: 1 }).toArray();
  }
  async revokeIfIssued(id: ObjectId, by: string, reason: string, at: Date): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOneAndUpdate({ _id: id, status: 'ISSUED' },
      { $set: { status: 'REVOKED', revokedAt: at, revokedBy: by, revokedReason: reason } }, { returnDocument: 'after' });
  }
  async authorizeRecovery(id: ObjectId, recovery: InvitationRecovery, now: Date): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOneAndUpdate(
      { _id: id, status: 'REDEEMED', $or: [
        { recovery: null }, { 'recovery.consumedAt': { $ne: null } }, { 'recovery.cancelledAt': { $ne: null } }, { 'recovery.expiresAt': { $lte: now } }
      ] },
      { $set: { recovery } }, { returnDocument: 'after' });
  }
  async cancelRecovery(id: ObjectId, at: Date): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOneAndUpdate(
      { _id: id, status: 'REDEEMED', recovery: { $ne: null }, 'recovery.consumedAt': null, 'recovery.cancelledAt': null },
      { $set: { 'recovery.cancelledAt': at } }, { returnDocument: 'after' });
  }
}

export class InvitationRedemptionRepository implements InvitationRedemptionStore {
  async findByTokenHash(tokenHash: string): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOne({ tokenHash });
  }
  async findById(id: ObjectId): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOne({ _id: id });
  }
  async claimIssued(id: ObjectId, sessionId: string, at: Date): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOneAndUpdate({ _id: id, status: 'ISSUED' },
      { $set: { status: 'REDEEMED', sessionId, redeemedAt: at } }, { returnDocument: 'after' });
  }
  async consumeRecovery(id: ObjectId, now: Date): Promise<InvitationDoc | null> {
    const { invitations } = await collections();
    return invitations.findOneAndUpdate(
      { _id: id, status: 'REDEEMED', recovery: { $ne: null }, 'recovery.consumedAt': null, 'recovery.cancelledAt': null, 'recovery.expiresAt': { $gt: now } },
      { $set: { 'recovery.consumedAt': now } }, { returnDocument: 'after' });
  }
}
