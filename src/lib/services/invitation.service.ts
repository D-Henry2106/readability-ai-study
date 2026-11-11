import { ObjectId } from 'mongodb';
import { assertRole } from '@/lib/auth/roles';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { InvitationRepository, type InvitationAdminStore } from '@/lib/repositories/invitation.repository';
import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { StudyRunError } from '@/lib/study-run/errors';
import { buildInvitationLink, generateInvitationToken, hashInvitationToken } from '@/lib/study-run/invitation-token';
import {
  invitationCreateSchema, invitationReplaceSchema, invitationRevokeSchema, recoveryAuthorizeSchema
} from '@/lib/validation/invitation-schemas';
import type { AdminRole } from '@/types/research';
import type { InvitationDoc } from '@/types/invitation';

export interface InvitationActor { username: string; role: AdminRole }

export interface InvitationServiceDeps {
  invitations?: InvitationAdminStore;
  runs?: Pick<StudyRunStore, 'getById' | 'lockIfUnlocked'>;
  research?: Pick<ResearchRepository, 'getSession' | 'addAudit'>;
  audit?: Pick<AuditService, 'record'>;
  /** Public base URL used to build links (defaults to APP_URL). */
  baseUrl?: () => string;
  now?: () => Date;
}

/** A freshly issued invitation. `token` and `link` exist ONLY in this return value: nothing stores or logs them. */
export interface IssuedInvitation { invitationId: string; variant: 'V1' | 'V2'; token: string; link: string }

/** Admin view of an invitation: never includes the token hash. */
export type InvitationView = Omit<InvitationDoc, 'tokenHash'>;
const view = ({ tokenHash: _hash, ...rest }: InvitationDoc): InvitationView => { void _hash; return rest; };

/**
 * Admin-side invitation operations (architecture §2.2). Every write requires RESEARCHER and is audited; audit entries carry the
 * invitation id (its "code"), never the token or its hash. The system never creates, revokes or expires an invitation by itself.
 */
export class InvitationService {
  private readonly invitations: InvitationAdminStore;
  private readonly runs: NonNullable<InvitationServiceDeps['runs']>;
  private readonly research: NonNullable<InvitationServiceDeps['research']>;
  private readonly audit: NonNullable<InvitationServiceDeps['audit']>;
  private readonly baseUrl: () => string;
  private readonly now: () => Date;

  constructor(deps: InvitationServiceDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.invitations = deps.invitations ?? new InvitationRepository();
    this.runs = deps.runs ?? new StudyRunRepository();
    this.research = research;
    this.audit = deps.audit ?? new AuditService(research as ResearchRepository);
    this.baseUrl = deps.baseUrl ?? (() => process.env.APP_URL ?? 'http://localhost:3000');
    this.now = deps.now ?? (() => new Date());
  }

  async list(actor: InvitationActor, studyRunId: string): Promise<InvitationView[]> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return (await this.invitations.listByRun(this.objectId(studyRunId, 'STUDY_RUN_NOT_FOUND'))).map(view);
  }

  /**
   * Issues `count` invitations for ONE variant of a run. Returns each link once. The first invitation of a run locks it
   * (`locked: true`). Allowed in any run status and after the quota is reached: the system never decides how many to issue.
   */
  async create(actor: InvitationActor, payload: unknown): Promise<{ issued: IssuedInvitation[]; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = invitationCreateSchema.parse(payload);
    const run = await this.runs.getById(new ObjectId(input.studyRunId));
    if (!run?._id) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    return this.issue(actor, run._id, input.variant, input.count, input.label ?? null, null, run.locked);
  }

  /** CAS ISSUED -> REVOKED. A REDEEMED invitation already owns a session and cannot be revoked. */
  async revoke(actor: InvitationActor, invitationId: string, payload: unknown): Promise<{ invitation: InvitationView; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = invitationRevokeSchema.parse(payload);
    const existing = await this.load(invitationId);
    const saved = await this.invitations.revokeIfIssued(existing._id!, actor.username, input.reason, this.now());
    if (!saved) throw new StudyRunError(existing.status === 'REDEEMED' ? 'INVITATION_ALREADY_REDEEMED' : 'INVITATION_NOT_ISSUED', 409);
    const auditLogged = await this.record(actor, 'INVITATION_REVOKED', saved, { reason: input.reason });
    return { invitation: view(saved), auditLogged };
  }

  /**
   * Issues ONE new invitation (same run and variant) that points at the one it replaces. The original must already be REVOKED
   * or REDEEMED (revoke an unused one first, so two valid links never exist for one participant). A replaced session is never
   * counted toward quota and its data is kept (nothing is deleted).
   */
  async replace(actor: InvitationActor, invitationId: string, payload: unknown): Promise<{ issued: IssuedInvitation; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = invitationReplaceSchema.parse(payload ?? {});
    const original = await this.load(invitationId);
    if (original.status === 'ISSUED') throw new StudyRunError('INVITATION_REVOKE_FIRST', 409);
    const run = await this.runs.getById(original.studyRunId);
    if (!run?._id) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    const { issued, auditLogged } = await this.issue(actor, run._id, original.variant, 1, input.label ?? original.label, original._id!, run.locked);
    return { issued: issued[0], auditLogged };
  }

  /**
   * Recovery (architecture §6.2): Admin allows ONE new browser to take over the session of a REDEEMED invitation whose
   * session is still ACTIVE. Time-boxed (<= 72 h, chosen by the Admin) and single-use (consumed by CAS at redeem time).
   */
  async authorizeRecovery(actor: InvitationActor, invitationId: string, payload: unknown): Promise<{ invitation: InvitationView; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = recoveryAuthorizeSchema.parse(payload);
    const invitation = await this.load(invitationId);
    if (invitation.status !== 'REDEEMED' || !invitation.sessionId) throw new StudyRunError('RECOVERY_NOT_APPLICABLE', 409);
    const session = await this.research.getSession(invitation.sessionId);
    if (!session || session.status !== 'ACTIVE') throw new StudyRunError('RECOVERY_NOT_APPLICABLE', 409);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + input.validForHours * 3_600_000);
    const saved = await this.invitations.authorizeRecovery(invitation._id!, {
      authorizedBy: actor.username, authorizedAt: now, reason: input.reason, expiresAt, consumedAt: null, cancelledAt: null
    }, now);
    if (!saved) throw new StudyRunError('RECOVERY_ALREADY_AUTHORIZED', 409);
    const auditLogged = await this.record(actor, 'INVITATION_RECOVERY_AUTHORIZED', saved, {
      reason: input.reason, validForHours: input.validForHours, expiresAt: expiresAt.toISOString()
    });
    return { invitation: view(saved), auditLogged };
  }

  /** Cancels an authorization that has not been used. */
  async cancelRecovery(actor: InvitationActor, invitationId: string): Promise<{ invitation: InvitationView; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const invitation = await this.load(invitationId);
    const saved = await this.invitations.cancelRecovery(invitation._id!, this.now());
    if (!saved) throw new StudyRunError('RECOVERY_NOT_CANCELLABLE', 409);
    const auditLogged = await this.record(actor, 'INVITATION_RECOVERY_CANCELLED', saved, {});
    return { invitation: view(saved), auditLogged };
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  private async issue(
    actor: InvitationActor, studyRunId: ObjectId, variant: 'V1' | 'V2', count: number, label: string | null,
    replaces: ObjectId | null, alreadyLocked: boolean
  ): Promise<{ issued: IssuedInvitation[]; auditLogged: boolean }> {
    const now = this.now();
    const base = this.baseUrl();
    const issued: IssuedInvitation[] = [];
    const docs: InvitationDoc[] = [];
    for (let i = 0; i < count; i += 1) {
      const token = generateInvitationToken();
      const _id = new ObjectId();
      docs.push({
        _id, studyRunId, variant, tokenHash: hashInvitationToken(token), status: 'ISSUED', redeemedAt: null, revokedAt: null,
        revokedBy: null, revokedReason: null, replacesInvitationId: replaces, label, recovery: null, createdBy: actor.username, createdAt: now
      });
      issued.push({ invitationId: _id.toHexString(), variant, token, link: buildInvitationLink(base, token) });
    }
    await this.invitations.insertMany(docs);
    let auditLogged = true;
    if (!alreadyLocked) {
      // First invitation of the run: lock it (CAS, so only one concurrent creator audits the lock).
      const locked = await this.runs.lockIfUnlocked(studyRunId);
      if (locked) auditLogged = (await this.recordRaw(actor, 'STUDY_RUN_LOCKED', 'study_run', studyRunId.toHexString(), { firstInvitationId: docs[0]._id!.toHexString() })) && auditLogged;
    }
    for (const doc of docs) {
      auditLogged = (await this.record(actor, 'INVITATION_ISSUED', doc, {
        studyRunId: studyRunId.toHexString(), variant, replacesInvitationId: replaces ? replaces.toHexString() : null
      })) && auditLogged;
    }
    return { issued, auditLogged };
  }

  private async load(id: string): Promise<InvitationDoc> {
    const doc = await this.invitations.getById(this.objectId(id, 'INVITATION_NOT_FOUND'));
    if (!doc) throw new StudyRunError('INVITATION_NOT_FOUND', 404);
    return doc;
  }

  private objectId(id: string, code: string): ObjectId {
    if (!/^[a-fA-F0-9]{24}$/.test(id)) throw new StudyRunError(code, 404);
    return new ObjectId(id);
  }

  private record(actor: InvitationActor, action: string, doc: InvitationDoc, metadata: Record<string, string | number | boolean | null>) {
    return this.recordRaw(actor, action, 'invitation', doc._id!.toHexString(), metadata);
  }

  private async recordRaw(actor: InvitationActor, action: string, targetType: string, targetId: string, metadata: Record<string, string | number | boolean | null>): Promise<boolean> {
    try {
      await this.audit.record({ username: actor.username, role: actor.role, action, targetType, targetId, metadata });
      return true;
    } catch {
      console.error('Invitation audit entry failed after a successful write.');
      return false;
    }
  }
}
