import { ObjectId } from 'mongodb';
import { assertRole } from '@/lib/auth/roles';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { InvitationRepository, type InvitationAdminStore } from '@/lib/repositories/invitation.repository';
import {
  PresentationProfileRepository,
  type PresentationProfileStore
} from '@/lib/repositories/presentation-profile.repository';
import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { StudyRunError } from '@/lib/study-run/errors';
import { buildInvitationLink, generateInvitationToken, hashInvitationToken } from '@/lib/study-run/invitation-token';
import {
  invitationCreateSchema, invitationReplaceSchema, invitationRevokeSchema, recoveryAuthorizeSchema
} from '@/lib/validation/invitation-schemas';
import type { AdminRole } from '@/types/research';
import type { InvitationDoc } from '@/types/invitation';
import type { StudyRunDoc } from '@/types/study-run';

export interface InvitationActor { username: string; role: AdminRole }

export interface InvitationServiceDeps {
  invitations?: InvitationAdminStore;
  runs?: Pick<StudyRunStore, 'getById' | 'lockIfUnlocked'>;
  profiles?: Pick<PresentationProfileStore, 'getById' | 'lockIfConfirmed'>;
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
 * Admin-side invitation operations (architecture §2.2, §6.5). Every write requires RESEARCHER and is audited; audit entries carry the
 * invitation id (its "code"), never the token or its hash. The system never creates, revokes or expires an invitation by itself.
 * Issuing the first invitation of a run atomically locks both the run (`locked: false -> true`) and its V2 presentation profile
 * (`CONFIRMED -> LOCKED`) via compare-and-set.
 */
export class InvitationService {
  private readonly invitations: InvitationAdminStore;
  private readonly runs: NonNullable<InvitationServiceDeps['runs']>;
  private readonly profiles: NonNullable<InvitationServiceDeps['profiles']>;
  private readonly research: NonNullable<InvitationServiceDeps['research']>;
  private readonly audit: NonNullable<InvitationServiceDeps['audit']>;
  private readonly baseUrl: () => string;
  private readonly now: () => Date;

  constructor(deps: InvitationServiceDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.invitations = deps.invitations ?? new InvitationRepository();
    this.runs = deps.runs ?? new StudyRunRepository();
    this.profiles = deps.profiles ?? new PresentationProfileRepository();
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
   * Issues `count` invitations for ONE variant of a run. Returns each link once. The first invitation of a run locks both the run
   * (`locked: true`) and its V2 presentation profile (`status: 'LOCKED'`). Allowed in any run status (once V2 profile is confirmed)
   * and after the quota is reached: the system never decides how many to issue.
   */
  async create(actor: InvitationActor, payload: unknown): Promise<{ issued: IssuedInvitation[]; auditLogged: boolean }> {
    assertRole(actor, ['RESEARCHER']);
    const input = invitationCreateSchema.parse(payload);
    const run = await this.runs.getById(new ObjectId(input.studyRunId));
    if (!run?._id) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    return this.issue(actor, run, input.variant, input.count, input.label ?? null, null);
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
    const { issued, auditLogged } = await this.issue(actor, run, original.variant, 1, input.label ?? original.label, original._id!);
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
    actor: InvitationActor, run: StudyRunDoc, variant: 'V1' | 'V2', count: number, label: string | null,
    replaces: ObjectId | null
  ): Promise<{ issued: IssuedInvitation[]; auditLogged: boolean }> {
    const studyRunId = run._id!;
    const profileId = run.presentation.V2.profileId;
    if (!profileId) throw new StudyRunError('PRESENTATION_PROFILE_NOT_CONFIRMED', 409);
    const profile = await this.profiles.getById(profileId);
    if (!profile || (profile.status !== 'CONFIRMED' && profile.status !== 'LOCKED')) {
      throw new StudyRunError('PRESENTATION_PROFILE_NOT_CONFIRMED', 409);
    }
    if (!profile.contentRevisionId.equals(run.snapshot.contentRevisionId) || profile.version !== run.presentation.V2.version) {
      throw new StudyRunError('PRESENTATION_PROFILE_CONTENT_MISMATCH', 409);
    }

    const now = this.now();
    const base = this.baseUrl();
    const issued: IssuedInvitation[] = [];
    const docs: InvitationDoc[] = [];
    // Built in memory only: nothing is written before the profile and the run are locked (below).
    for (let i = 0; i < count; i += 1) {
      const token = generateInvitationToken();
      const _id = new ObjectId();
      docs.push({
        _id, studyRunId, variant, tokenHash: hashInvitationToken(token), status: 'ISSUED', redeemedAt: null, revokedAt: null,
        revokedBy: null, revokedReason: null, replacesInvitationId: replaces, label, recovery: null, createdBy: actor.username, createdAt: now
      });
      issued.push({ invitationId: _id.toHexString(), variant, token, link: buildInvitationLink(base, token) });
    }

    // 1) Lock the V2 profile (CAS CONFIRMED -> LOCKED). From now on no edit of it can succeed (§6.5, AC-14).
    let lockedProfileNow = false;
    if (profile.status !== 'LOCKED') {
      const lockedProfile = await this.profiles.lockIfConfirmed(profileId, now);
      if (lockedProfile) {
        lockedProfileNow = true;
      } else {
        const recheck = await this.profiles.getById(profileId);
        if (recheck?.status !== 'LOCKED') throw new StudyRunError('PRESENTATION_PROFILE_NOT_CONFIRMED', 409);
      }
    }

    // 2) Lock the run (CAS locked: false -> true) bound to EXACTLY the profile and version validated above, and do it BEFORE any
    //    invitation exists. Another Admin cannot rebind the run once it is locked, and the CAS refuses to lock a run that was
    //    rebound after we read it, so a session can never be pinned to a profile other than the one that was locked.
    let lockedRunNow = false;
    if (!run.locked) {
      const lockedRun = await this.runs.lockIfUnlocked(studyRunId, { profileId, version: profile.version });
      if (lockedRun) {
        lockedRunNow = true;
      } else {
        const current = await this.runs.getById(studyRunId);
        const sameBinding = current?.locked === true
          && current.presentation.V2.profileId?.equals(profileId) === true
          && current.presentation.V2.version === profile.version;
        if (!sameBinding) throw new StudyRunError('PRESENTATION_PROFILE_BINDING_CHANGED', 409);
      }
    }

    // 3) Persist. If this fails the locks above stay (idempotent: a retry finds both locked and consistent) and are still audited.
    let auditLogged = true;
    const auditLocks = async (firstInvitationId: string | null) => {
      if (lockedProfileNow) {
        auditLogged = (await this.recordRaw(actor, 'PRESENTATION_PROFILE_LOCKED', 'presentation_profile', profileId.toHexString(), {
          studyRunId: studyRunId.toHexString(), firstInvitationId, version: profile.version
        })) && auditLogged;
      }
      if (lockedRunNow) {
        auditLogged = (await this.recordRaw(actor, 'STUDY_RUN_LOCKED', 'study_run', studyRunId.toHexString(), { firstInvitationId })) && auditLogged;
      }
    };
    try {
      await this.invitations.insertMany(docs);
    } catch (error) {
      await auditLocks(null);
      throw error;
    }
    await auditLocks(docs[0]._id!.toHexString());
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
