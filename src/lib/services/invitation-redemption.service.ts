import { randomUUID } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { InvitationRedemptionRepository, type InvitationRedemptionStore } from '@/lib/repositories/invitation.repository';
import type { VariantLockStore } from '@/lib/repositories/research.repository';
import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { RunSessionService } from './run-session.service';
import { ExperimentStateService } from './state.service';
import { StudyRunError } from '@/lib/study-run/errors';
import { hashInvitationToken, isWellFormedInvitationToken } from '@/lib/study-run/invitation-token';
import type { DeviceType, SessionDoc } from '@/types/research';
import type { InvitationDoc } from '@/types/invitation';

/** A claimed invitation whose session does not exist yet is "in flight" for this long before a retry may finish the job. */
export const REDEEM_IN_FLIGHT_MS = 15_000;

export interface RedeemInput {
  token: string;
  deviceType: DeviceType;
  /** Session id from the participant cookie, if the browser has a valid one (decoded by the route). */
  cookieSessionId: string | null;
}

export interface RedeemResult {
  outcome: 'CREATED' | 'RECOVERED' | 'RESUMED';
  sessionId: string;
  nextRoute: string;
  /** The route sets the participant cookie only when this is true. RESUMED never issues a cookie (the browser already has one). */
  grantCookie: boolean;
}

export interface RedemptionDeps {
  invitations?: InvitationRedemptionStore;
  runs?: Pick<StudyRunStore, 'getById'>;
  research?: Pick<ResearchRepository, 'getSession'>;
  /** P5-D: per-variant intake lock. Defaults to the research repository. */
  locks?: Pick<VariantLockStore, 'getVariantLocks'>;
  runSessions?: Pick<RunSessionService, 'build' | 'persist'>;
  audit?: Pick<AuditService, 'record'>;
  routeFor?: (session: SessionDoc) => string;
  newSessionId?: () => string;
  now?: () => Date;
  inFlightMs?: number;
}

const unavailable = () => new StudyRunError('INVITATION_UNAVAILABLE', 404);
const alreadyUsed = () => new StudyRunError('INVITATION_ALREADY_USED', 409);
const browserBusy = () => new StudyRunError('ACTIVE_SESSION_IN_BROWSER', 409);
const inProgress = () => new StudyRunError('INVITATION_REDEEM_IN_PROGRESS', 409);

/**
 * Participant-side redeem (architecture §6.1). Writes only through the two CAS operations of InvitationRedemptionStore plus the
 * idempotent creation of the one session whose id the first CAS allocated. It never logs or returns the token, and it never changes
 * a variant: the session takes the variant of the invitation.
 */
export class InvitationRedemptionService {
  private readonly invitations: InvitationRedemptionStore;
  private readonly runs: NonNullable<RedemptionDeps['runs']>;
  private readonly research: NonNullable<RedemptionDeps['research']>;
  private readonly locks: NonNullable<RedemptionDeps['locks']>;
  private readonly runSessions: NonNullable<RedemptionDeps['runSessions']>;
  private readonly audit: NonNullable<RedemptionDeps['audit']>;
  private readonly routeFor: (session: SessionDoc) => string;
  private readonly newSessionId: () => string;
  private readonly now: () => Date;
  private readonly inFlightMs: number;

  constructor(deps: RedemptionDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.invitations = deps.invitations ?? new InvitationRedemptionRepository();
    this.runs = deps.runs ?? new StudyRunRepository();
    this.research = research;
    this.locks = deps.locks ?? new ResearchRepository();
    this.runSessions = deps.runSessions ?? new RunSessionService();
    this.audit = deps.audit ?? new AuditService();
    this.routeFor = deps.routeFor ?? ((s) => new ExperimentStateService(research as ResearchRepository).routeFor(s));
    this.newSessionId = deps.newSessionId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
    this.inFlightMs = deps.inFlightMs ?? REDEEM_IN_FLIGHT_MS;
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    // One generic answer for: malformed, unknown or revoked token, and a run that is not open (§6.1 step 1).
    if (!isWellFormedInvitationToken(input.token)) throw unavailable();
    const invitation = await this.invitations.findByTokenHash(hashInvitationToken(input.token));
    if (!invitation?._id || invitation.status === 'REVOKED') throw unavailable();
    const cookieSession = input.cookieSessionId ? await this.research.getSession(input.cookieSessionId) : null;
    return invitation.status === 'ISSUED' ? this.redeemIssued(invitation, input, cookieSession) : this.redeemUsed(invitation, input, cookieSession);
  }

  private async redeemIssued(invitation: InvitationDoc, input: RedeemInput, cookieSession: SessionDoc | null): Promise<RedeemResult> {
    const run = await this.runs.getById(invitation.studyRunId);
    if (!run || run.status !== 'OPEN') throw unavailable();
    // P5-D: a locked variant redeems no UNUSED invitation. Only here: resume/recovery of an already started session (redeemUsed)
    // and test submit never look at the lock, so participants who started before the lock can still finish.
    if ((await this.locks.getVariantLocks())[invitation.variant].locked) throw unavailable();
    // A browser that already holds another ACTIVE session is refused BEFORE the invitation is consumed (one person, one link).
    if (cookieSession?.status === 'ACTIVE') throw browserBusy();
    const sessionId = this.newSessionId();
    // Build (and so validate) the session first: a deterministic failure must never burn the link.
    const session = await this.runSessions.build({ sessionId, run, invitation, deviceType: input.deviceType });
    const claimed = await this.invitations.claimIssued(invitation._id!, sessionId, this.now());
    if (!claimed) {
      // Lost a race (concurrent redeem, or a revoke). Decide from the current state; never create a second session.
      const current = await this.invitations.findById(invitation._id!);
      if (!current || current.status === 'REVOKED' || current.status === 'ISSUED') throw unavailable();
      return this.redeemUsed(current, input, cookieSession);
    }
    await this.runSessions.persist(session);
    return { outcome: 'CREATED', sessionId, nextRoute: this.routeFor(session), grantCookie: true };
  }

  private async redeemUsed(invitation: InvitationDoc, input: RedeemInput, cookieSession: SessionDoc | null): Promise<RedeemResult> {
    const sessionId = invitation.sessionId;
    if (!sessionId) throw alreadyUsed();
    const session = await this.research.getSession(sessionId);
    const now = this.now();

    if (!session) {
      // The invitation was claimed but its session was never written (crash or error between the two steps).
      if (invitation.redeemedAt && now.getTime() - invitation.redeemedAt.getTime() < this.inFlightMs) throw inProgress();
      if (cookieSession?.status === 'ACTIVE') throw browserBusy();
      const run = await this.runs.getById(invitation.studyRunId);
      if (!run) throw unavailable();
      const rebuilt = await this.runSessions.build({ sessionId, run, invitation, deviceType: input.deviceType });
      await this.runSessions.persist(rebuilt);
      return { outcome: 'CREATED', sessionId, nextRoute: this.routeFor(rebuilt), grantCookie: true };
    }

    // (a) Resume: only the browser that holds a valid cookie of exactly this session, and only while it is ACTIVE.
    if (session.status === 'ACTIVE' && input.cookieSessionId === sessionId) {
      return { outcome: 'RESUMED', sessionId, nextRoute: this.routeFor(session), grantCookie: false };
    }
    // (b) Recovery: only with a usable Admin authorization; a finished session is never recoverable.
    const recovery = invitation.recovery;
    if (session.status === 'ACTIVE' && recovery && !recovery.consumedAt && !recovery.cancelledAt && recovery.expiresAt.getTime() > now.getTime()) {
      if (cookieSession?.status === 'ACTIVE' && cookieSession.id !== sessionId) throw browserBusy();
      if (await this.invitations.consumeRecovery(invitation._id!, now)) {
        await this.recordConsumed(invitation);
        return { outcome: 'RECOVERED', sessionId, nextRoute: this.routeFor(session), grantCookie: true };
      }
    }
    // (c) Everything else: no cookie, and nothing about the session is revealed.
    throw alreadyUsed();
  }

  private async recordConsumed(invitation: InvitationDoc): Promise<void> {
    try {
      await this.audit.record({
        username: 'participant-redemption', role: 'SYSTEM', action: 'INVITATION_RECOVERY_CONSUMED', targetType: 'invitation',
        targetId: invitation._id!.toHexString(), metadata: { studyRunId: invitation.studyRunId.toHexString(), variant: invitation.variant }
      });
    } catch {
      console.error('Invitation recovery audit entry failed after a successful consume.');
    }
  }
}
