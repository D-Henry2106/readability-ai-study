import { ObjectId } from 'mongodb';
import { assertRole } from '@/lib/auth/roles';
import { ResearchRepository, type QuotaSessionStore } from '@/lib/repositories/research.repository';
import { StudyRunRepository, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { VALIDITY_CHECKLIST_VERSION } from './validity.service';
import { StudyRunError } from '@/lib/study-run/errors';
import {
  armCountersEqual,
  evaluateQuotaWarnings,
  hasSettlingRelease,
  type QuotaArmSnapshot,
  type QuotaWarningCode
} from '@/lib/study-run/quota';
import { validitySchema } from '@/lib/validation/schemas';
import type {
  AdminRole,
  Presentation,
  QuotaStatus,
  SessionDoc,
  SessionQuotaTransition,
  ValidityFlag
} from '@/types/research';
import type { StudyRunDoc } from '@/types/study-run';

export { VALIDITY_CHECKLIST_VERSION };

type CounterCompensationOutcome = 'COMPENSATED' | 'ALREADY_SETTLED' | 'FAILED';

export interface QuotaActor {
  username: string;
  role: AdminRole;
}

export interface StudyRunQuotaServiceDeps {
  runs?: Pick<StudyRunStore, 'getById' | 'applyQuotaCounterTransition'>;
  sessions?: QuotaSessionStore;
  audit?: Pick<AuditService, 'record'>;
  now?: () => Date;
}

export interface QuotaValidityDecisionResult {
  session: SessionDoc;
  run: StudyRunDoc;
  variant: Presentation;
  previousValidityFlag: ValidityFlag;
  validityFlag: ValidityFlag;
  previousQuotaStatus: QuotaStatus | null;
  quotaStatus: QuotaStatus;
  counterChanged: boolean;
  warnings: QuotaWarningCode[];
  auditLogged: boolean;
}

export interface QuotaIncludeSupplementalResult {
  session: SessionDoc;
  run: StudyRunDoc;
  variant: Presentation;
  previousQuotaStatus: 'SUPPLEMENTAL';
  quotaStatus: 'INCLUDED';
  warnings: QuotaWarningCode[];
  auditLogged: boolean;
}

export interface QuotaReconciliationResult {
  studyRunId: string;
  matches: boolean;
  stored: QuotaArmSnapshot;
  counted: QuotaArmSnapshot;
  warnings: QuotaWarningCode[];
}

/**
 * Study Run Quota Recording Service (P4: architecture §2.3, §2.4, §6.4, AC-03 clause 3, AC-15..AC-18, AC-31).
 *
 * Durable state machine & crash recovery (standalone mongod compatible, no multi-document transactions required):
 *  - Every counter-affecting transition (`VALID_CLAIM`, `DEMOTE_VALID`, `PROMOTE_SUPPLEMENTAL`) writes a durable
 *    `quotaTransition` (`id`, `kind`, `state: 'PENDING'`, prior snapshot, target state) on `sessions` in Step 1.
 *  - Step 2 applies the bounded counter update on `study_runs.arms.<variant>` and records `quotaLedger.<transitionId>`
 *    in the SAME single-document `findOneAndUpdate` on `study_runs`, making counter transitions strictly idempotent
 *    by `transitionId` across retries, concurrent workers, and process restarts.
 *  - Step 3 finalizes `sessions` (`quotaStatus` and `quotaTransition.state = 'COMMITTED' | 'RECOVERED'`).
 *  - If a process crashes or throws after Step 1 or Step 2, the `PENDING` transition on `sessions` is recovered
 *    deterministically by any subsequent retry or new `StudyRunQuotaService` instance without double-counting,
 *    without negative counters, without exceeding `quotaPerArm`, and without guessing or time-based assumptions.
 */
export class StudyRunQuotaService {
  private readonly runs: NonNullable<StudyRunQuotaServiceDeps['runs']>;
  private readonly sessions: QuotaSessionStore;
  private readonly audit: NonNullable<StudyRunQuotaServiceDeps['audit']>;
  private readonly now: () => Date;
  private readonly activeTransitionIds = new Set<string>();

  constructor(deps: StudyRunQuotaServiceDeps = {}) {
    const research = new ResearchRepository();
    this.runs = deps.runs ?? new StudyRunRepository();
    this.sessions = deps.sessions ?? research;
    this.audit = deps.audit ?? new AuditService(research);
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Explicitly recovers any in-flight `PENDING` quota transition on a session after a crash or network failure.
   */
  async recoverSession(
    actor: QuotaActor,
    sessionId: string
  ): Promise<QuotaValidityDecisionResult | QuotaIncludeSupplementalResult | null> {
    assertRole(actor, ['RESEARCHER']);
    const session = await this.sessions.getSession(sessionId);
    if (!session) throw new StudyRunError('SESSION_NOT_FOUND', 404);
    if (!session.studyRunId || !session.presentationVariant) {
      throw new StudyRunError('SESSION_NOT_IN_STUDY_RUN', 409);
    }
    if (session.quotaTransition?.state !== 'PENDING') {
      // Nothing to drive forward, but a transition committed by a process that died before writing its audit entry
      // still owes one (idempotent by transition id).
      await this.ensureTransitionAudit(session);
      return null;
    }
    return this.recoverPendingTransition(session, actor);
  }

  /**
   * Applies an Admin validity decision (`VALID`, `INVALID`, or `REVIEW_REQUIRED`) to a COMPLETED Study Run session
   * and updates `study_runs.arms` according to the §6.4 transition matrix.
   */
  async recordValidity(
    actor: QuotaActor,
    sessionId: string,
    payload: unknown,
    options: { checklistEligible?: boolean } = {}
  ): Promise<QuotaValidityDecisionResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = validitySchema.parse(payload);
    if (input.validityFlag === 'VALID' && options.checklistEligible === false) {
      throw new StudyRunError('SESSION_VALIDITY_NOT_ELIGIBLE', 409);
    }

    let auditBlocked = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let session = await this.sessions.getSession(sessionId);
      if (!session) throw new StudyRunError('SESSION_NOT_FOUND', 404);
      if (!session.studyRunId || !session.presentationVariant) {
        throw new StudyRunError('SESSION_NOT_IN_STUDY_RUN', 409);
      }
      if (session.status !== 'COMPLETED' || session.currentStage !== 'COMPLETED') {
        throw new StudyRunError('SESSION_NOT_COMPLETED', 409);
      }

      const studyRunId = session.studyRunId;
      const variant = session.presentationVariant;
      const run = await this.runs.getById(studyRunId);
      if (!run) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);

      const pending = session.quotaTransition?.state === 'PENDING' ? session.quotaTransition : null;
      if (pending) {
        const isLiveOnThisInstance = this.activeTransitionIds.has(pending.id);
        if (input.validityFlag === 'VALID' && pending.kind === 'VALID_CLAIM') {
          const settled = await this.waitForInFlightValidClaim(session.id, studyRunId, session, actor);
          if (settled) return settled;
          continue;
        }
        if (!isLiveOnThisInstance) {
          const recovered = await this.recoverPendingTransition(session, actor);
          if (
            recovered &&
            'validityFlag' in recovered &&
            recovered.validityFlag === input.validityFlag &&
            (input.validityFlag === 'VALID' || session.validityReason === input.reason)
          ) {
            return recovered;
          }
          session = await this.sessions.getSession(sessionId);
          if (!session) throw new StudyRunError('SESSION_NOT_FOUND', 404);
        }
      }

      // A settled transition that still owes its audit entry is repaired BEFORE a new transition can replace it
      // (the session store also refuses to overwrite it), so no admin audit entry is ever lost.
      if (
        session.quotaTransition &&
        session.quotaTransition.state !== 'PENDING' &&
        session.quotaTransition.auditLogged === false
      ) {
        if ((await this.ensureTransitionAudit(session)) === false) auditBlocked = true;
      }

      const prevFlag = session.validityFlag;
      const prevQuota: QuotaStatus | null = session.quotaStatus ?? null;
      const nextFlag = input.validityFlag;
      const checklistVersion = nextFlag === 'VALID' ? VALIDITY_CHECKLIST_VERSION : null;
      const at = this.monotonicTimestamp(session);

      // Row 3: Setting VALID again when already INCLUDED or SUPPLEMENTAL -> idempotent, counters unchanged.
      if (nextFlag === 'VALID' && (prevQuota === 'INCLUDED' || prevQuota === 'SUPPLEMENTAL')) {
        const updatedSession = await this.sessions.claimRunSessionQuotaTransition({
          sessionId: session.id,
          studyRunId,
          variant,
          expectedValidityFlag: prevFlag,
          expectedQuotaStatus: prevQuota,
          nextValidityFlag: 'VALID',
          nextQuotaStatus: prevQuota,
          reason: input.reason,
          reviewedBy: actor.username,
          checklistVersion,
          recordQuotaMeta: false,
          at
        });
        if (!updatedSession) continue;
        const freshRun = (await this.runs.getById(studyRunId)) ?? run;
        const auditLogged = await this.recordValidityAudit(actor, updatedSession, prevFlag, prevQuota, prevQuota, false);
        return {
          session: updatedSession,
          run: freshRun,
          variant,
          previousValidityFlag: prevFlag,
          validityFlag: 'VALID',
          previousQuotaStatus: prevQuota,
          quotaStatus: prevQuota,
          counterChanged: false,
          warnings: evaluateQuotaWarnings(freshRun),
          auditLogged
        };
      }

      // Row 6: Setting INVALID or REVIEW_REQUIRED when prior quotaStatus is null or NOT_COUNTED -> counters unchanged.
      if (nextFlag !== 'VALID' && (prevQuota === null || prevQuota === 'NOT_COUNTED')) {
        const updatedSession = await this.sessions.claimRunSessionQuotaTransition({
          sessionId: session.id,
          studyRunId,
          variant,
          expectedValidityFlag: prevFlag,
          expectedQuotaStatus: prevQuota,
          nextValidityFlag: nextFlag,
          nextQuotaStatus: 'NOT_COUNTED',
          reason: input.reason,
          reviewedBy: actor.username,
          checklistVersion: null,
          recordQuotaMeta: prevQuota !== 'NOT_COUNTED',
          at,
          transition: null
        });
        if (!updatedSession) continue;
        const freshRun = (await this.runs.getById(studyRunId)) ?? run;
        const auditLogged = await this.recordValidityAudit(actor, updatedSession, prevFlag, prevQuota, 'NOT_COUNTED', false);
        return {
          session: updatedSession,
          run: freshRun,
          variant,
          previousValidityFlag: prevFlag,
          validityFlag: nextFlag,
          previousQuotaStatus: prevQuota,
          quotaStatus: 'NOT_COUNTED',
          counterChanged: false,
          warnings: evaluateQuotaWarnings(freshRun),
          auditLogged
        };
      }

      // Rows 4 & 5: Demoting VALID (INCLUDED or SUPPLEMENTAL) -> INVALID or REVIEW_REQUIRED.
      if (nextFlag !== 'VALID' && (prevQuota === 'INCLUDED' || prevQuota === 'SUPPLEMENTAL')) {
        const transitionId = new ObjectId().toHexString();
        const transition: SessionQuotaTransition = {
          id: transitionId,
          kind: 'DEMOTE_VALID',
          state: 'PENDING',
          previousValidityFlag: 'VALID',
          previousReason: session.validityReason,
          previousReviewedBy: session.validityReviewedBy,
          previousReviewedAt: session.validityReviewedAt ?? null,
          previousChecklistVersion: session.validityChecklistVersion ?? null,
          previousQuotaStatus: prevQuota,
          previousQuotaRecordedAt: session.quotaRecordedAt ?? null,
          previousQuotaRecordedBy: session.quotaRecordedBy ?? null,
          previousUpdatedAt: session.updatedAt,
          targetValidityFlag: nextFlag,
          reason: input.reason,
          actorUsername: actor.username,
          actorRole: actor.role,
          checklistVersion: null,
          claimedAt: at,
          updatedAt: at,
          auditLogged: false
        };

        this.activeTransitionIds.add(transitionId);
        try {
          const claimed = await this.sessions.claimRunSessionQuotaTransition({
            sessionId: session.id,
            studyRunId,
            variant,
            expectedValidityFlag: 'VALID',
            expectedQuotaStatus: prevQuota,
            expectedQuotaRecordedAt: session.quotaRecordedAt ?? null,
            nextValidityFlag: nextFlag,
            nextQuotaStatus: 'NOT_COUNTED',
            reason: input.reason,
            reviewedBy: actor.username,
            checklistVersion: null,
            recordQuotaMeta: true,
            at,
            transition
          });
          if (!claimed) continue;

          return await this.executePendingDemoteClaim(claimed, transition, actor, false);
        } finally {
          this.activeTransitionIds.delete(transitionId);
        }
      }

      // Rows 1 & 2: Setting VALID when prior quotaStatus is null or NOT_COUNTED.
      if (run.quotaPerArm === null) {
        throw new StudyRunError('STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);
      }

      // If another concurrent VALID call already claimed Step 1 (validityFlag === 'VALID' while quotaStatus is still null/NOT_COUNTED):
      if (prevFlag === 'VALID') {
        const settled = await this.waitForInFlightValidClaim(session.id, studyRunId, session, actor);
        if (settled) return settled;
        continue;
      }

      const transitionId = new ObjectId().toHexString();
      const transition: SessionQuotaTransition = {
        id: transitionId,
        kind: 'VALID_CLAIM',
        state: 'PENDING',
        previousValidityFlag: prevFlag,
        previousReason: session.validityReason,
        previousReviewedBy: session.validityReviewedBy,
        previousReviewedAt: session.validityReviewedAt ?? null,
        previousChecklistVersion: session.validityChecklistVersion ?? null,
        previousQuotaStatus: prevQuota,
        previousQuotaRecordedAt: session.quotaRecordedAt ?? null,
        previousQuotaRecordedBy: session.quotaRecordedBy ?? null,
        previousUpdatedAt: session.updatedAt,
        targetValidityFlag: 'VALID',
        reason: input.reason,
        actorUsername: actor.username,
        actorRole: actor.role,
        checklistVersion,
        claimedAt: at,
        updatedAt: at,
        auditLogged: false
      };

      this.activeTransitionIds.add(transitionId);
      try {
        const claimed = await this.sessions.claimRunSessionQuotaTransition({
          sessionId: session.id,
          studyRunId,
          variant,
          expectedValidityFlag: prevFlag,
          expectedQuotaStatus: prevQuota,
          expectedReviewedAt: session.validityReviewedAt ?? null,
          nextValidityFlag: 'VALID',
          nextQuotaStatus: prevQuota,
          reason: input.reason,
          reviewedBy: actor.username,
          checklistVersion,
          recordQuotaMeta: false,
          at,
          transition
        });

        if (!claimed) {
          const current = await this.sessions.getSession(session.id);
          if (current?.validityFlag === 'VALID') {
            const settled = await this.waitForInFlightValidClaim(session.id, studyRunId, current, actor);
            if (settled) return settled;
          }
          continue;
        }

        return await this.executePendingValidClaim(claimed, transition, actor, false);
      } finally {
        this.activeTransitionIds.delete(transitionId);
      }
    }

    throw new StudyRunError(auditBlocked ? 'STUDY_RUN_QUOTA_AUDIT_PENDING' : 'STUDY_RUN_QUOTA_CONFLICT', 409);
  }

  /**
   * Explicit Admin action "Đưa vào quota" (architecture §2.2, §6.4 Row 7, AC-31).
   * Promotes a COMPLETED + VALID + SUPPLEMENTAL session to INCLUDED when its arm has an open quota slot.
   */
  async includeSupplemental(actor: QuotaActor, sessionId: string): Promise<QuotaIncludeSupplementalResult> {
    assertRole(actor, ['RESEARCHER']);
    let session = await this.sessions.getSession(sessionId);
    if (!session) throw new StudyRunError('SESSION_NOT_FOUND', 404);
    if (!session.studyRunId || !session.presentationVariant) {
      throw new StudyRunError('SESSION_NOT_IN_STUDY_RUN', 409);
    }
    if (session.status !== 'COMPLETED' || session.currentStage !== 'COMPLETED') {
      throw new StudyRunError('SESSION_NOT_COMPLETED', 409);
    }

    if (session.quotaTransition?.state === 'PENDING' && !this.activeTransitionIds.has(session.quotaTransition.id)) {
      if (session.quotaTransition.kind === 'PROMOTE_SUPPLEMENTAL') {
        return this.executePendingSupplementalPromotion(session, session.quotaTransition, actor, true);
      }
      await this.recoverPendingTransition(session, actor);
      session = await this.sessions.getSession(sessionId);
      if (!session) throw new StudyRunError('SESSION_NOT_FOUND', 404);
    }

    if (session.validityFlag !== 'VALID' || session.quotaStatus !== 'SUPPLEMENTAL') {
      throw new StudyRunError('QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
    }

    if (
      session.quotaTransition &&
      session.quotaTransition.state !== 'PENDING' &&
      session.quotaTransition.auditLogged === false &&
      (await this.ensureTransitionAudit(session)) === false
    ) {
      throw new StudyRunError('STUDY_RUN_QUOTA_AUDIT_PENDING', 409);
    }

    const studyRunId = session.studyRunId!;
    const variant = session.presentationVariant!;
    const run = await this.runs.getById(studyRunId);
    if (!run) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    if (run.quotaPerArm === null) throw new StudyRunError('STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);
    if (run.arms[variant].validIncluded >= run.quotaPerArm) {
      throw new StudyRunError('STUDY_RUN_QUOTA_FULL', 409);
    }

    const claimAt = this.monotonicTimestamp(session);
    const prevRecordedAt = session.quotaRecordedAt ?? null;
    const prevRecordedBy = session.quotaRecordedBy ?? null;
    const transitionId = new ObjectId().toHexString();
    const transition: SessionQuotaTransition = {
      id: transitionId,
      kind: 'PROMOTE_SUPPLEMENTAL',
      state: 'PENDING',
      previousValidityFlag: 'VALID',
      previousReason: session.validityReason,
      previousReviewedBy: session.validityReviewedBy,
      previousReviewedAt: session.validityReviewedAt ?? null,
      previousChecklistVersion: session.validityChecklistVersion ?? null,
      previousQuotaStatus: 'SUPPLEMENTAL',
      previousQuotaRecordedAt: prevRecordedAt,
      previousQuotaRecordedBy: prevRecordedBy,
      previousUpdatedAt: session.updatedAt,
      targetValidityFlag: 'VALID',
      reason: session.validityReason,
      actorUsername: actor.username,
      actorRole: actor.role,
      checklistVersion: session.validityChecklistVersion ?? VALIDITY_CHECKLIST_VERSION,
      claimedAt: claimAt,
      updatedAt: claimAt,
      auditLogged: false
    };

    this.activeTransitionIds.add(transitionId);
    try {
      // Step 1: Claim promotion on the session (keeps quotaStatus = SUPPLEMENTAL with a new quotaRecordedAt and PENDING transition).
      const claimed = await this.sessions.claimSupplementalQuotaPromotion({
        sessionId: session.id,
        studyRunId,
        variant,
        expectedRecordedAt: prevRecordedAt,
        recordedBy: actor.username,
        at: claimAt,
        transition
      });
      if (!claimed) {
        const latest = await this.sessions.getSession(session.id);
        if (latest?.quotaTransition?.state === 'PENDING' && latest.quotaTransition.kind === 'PROMOTE_SUPPLEMENTAL') {
          return await this.executePendingSupplementalPromotion(latest, latest.quotaTransition, actor, true);
        }
        throw new StudyRunError('QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
      }

      return await this.executePendingSupplementalPromotion(claimed, transition, actor, false);
    } finally {
      this.activeTransitionIds.delete(transitionId);
    }
  }

  /**
   * Read-only reconciliation (architecture §2.3, §6.4): compares `study_runs.arms` against counts aggregated
   * from `sessions`. Never mutates `study_runs` or `sessions`; mismatches only emit `QUOTA_COUNTER_MISMATCH`.
   */
  async reconcile(actor: QuotaActor, studyRunId: string): Promise<QuotaReconciliationResult> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    if (!/^[a-fA-F0-9]{24}$/.test(studyRunId)) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    const id = new ObjectId(studyRunId);
    const run = await this.runs.getById(id);
    if (!run) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    const counted = await this.sessions.countRunQuotaFromSessions(id);
    const matches = armCountersEqual(run.arms, counted);
    const warnings = evaluateQuotaWarnings(run, { counterMismatch: !matches });
    return {
      studyRunId: id.toHexString(),
      matches,
      stored: run.arms,
      counted,
      warnings
    };
  }

  private monotonicTimestamp(session: SessionDoc): Date {
    const floor = Math.max(
      session.validityReviewedAt?.getTime() ?? 0,
      session.quotaRecordedAt?.getTime() ?? 0,
      session.quotaTransition?.claimedAt?.getTime() ?? 0
    );
    return new Date(Math.max(this.now().getTime(), floor + 1));
  }

  private async recoverPendingTransition(
    session: SessionDoc,
    actor: QuotaActor
  ): Promise<QuotaValidityDecisionResult | QuotaIncludeSupplementalResult | null> {
    const transition = session.quotaTransition;
    if (!transition || transition.state !== 'PENDING') return null;
    if (transition.kind === 'VALID_CLAIM') {
      return this.executePendingValidClaim(session, transition, actor, true);
    }
    if (transition.kind === 'DEMOTE_VALID') {
      return this.executePendingDemoteClaim(session, transition, actor, true);
    }
    if (transition.kind === 'PROMOTE_SUPPLEMENTAL') {
      return this.executePendingSupplementalPromotion(session, transition, actor, true);
    }
    return null;
  }

  private async executePendingValidClaim(
    session: SessionDoc,
    transition: SessionQuotaTransition,
    actor: QuotaActor,
    isRecovery: boolean
  ): Promise<QuotaValidityDecisionResult> {
    const studyRunId = session.studyRunId!;
    const variant = session.presentationVariant!;
    const prevFlag = transition.previousValidityFlag;
    const prevQuota = transition.previousQuotaStatus;
    const at = transition.claimedAt;
    const counterOptions = { sessionId: session.id, claimedAt: transition.claimedAt };

    let assignedStatus: 'INCLUDED' | 'SUPPLEMENTAL' = 'INCLUDED';
    let updatedRun = await this.runs.applyQuotaCounterTransition(studyRunId, variant, 'CLAIM_INCLUDED', transition.id, counterOptions);
    if (!updatedRun) {
      assignedStatus = 'SUPPLEMENTAL';
      updatedRun = await this.runs.applyQuotaCounterTransition(studyRunId, variant, 'INCREMENT_SUPPLEMENTAL', transition.id, counterOptions);
    }
    if (!updatedRun) {
      const latestRun = await this.runs.getById(studyRunId);
      const ledgerEntry = latestRun?.quotaLedger?.[transition.id];
      if (
        latestRun &&
        ledgerEntry &&
        (ledgerEntry.transition === 'CLAIM_INCLUDED' || ledgerEntry.transition === 'INCREMENT_SUPPLEMENTAL')
      ) {
        assignedStatus = ledgerEntry.transition === 'CLAIM_INCLUDED' ? 'INCLUDED' : 'SUPPLEMENTAL';
        updatedRun = latestRun;
      }
    }
    // This transition's counter increment was already compensated (rolled back) earlier: it must never be finalized.
    if (updatedRun?.quotaLedger?.[`${transition.id}:rollback`]) updatedRun = null;

    if (!updatedRun) {
      const reverted = await this.sessions.revertRunSessionValidityClaim({
        sessionId: session.id,
        studyRunId,
        expectedReviewedAt: at,
        claimedValidityFlag: 'VALID',
        claimedQuotaStatus: prevQuota,
        transitionId: transition.id,
        previousValidityFlag: prevFlag,
        previousReason: transition.previousReason,
        previousReviewedBy: transition.previousReviewedBy,
        previousReviewedAt: transition.previousReviewedAt ?? undefined,
        previousChecklistVersion: transition.previousChecklistVersion ?? null,
        previousQuotaStatus: prevQuota,
        previousQuotaRecordedAt: transition.previousQuotaRecordedAt ?? null,
        previousQuotaRecordedBy: transition.previousQuotaRecordedBy ?? null,
        previousUpdatedAt: transition.previousUpdatedAt
      });
      if (!reverted) {
        const afterRevertMiss = await this.sessions.getSession(session.id);
        if (
          afterRevertMiss &&
          afterRevertMiss.validityFlag === prevFlag &&
          (afterRevertMiss.quotaStatus ?? null) === prevQuota &&
          afterRevertMiss.quotaTransition?.state !== 'PENDING'
        ) {
          throw new StudyRunError('STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);
        }
        throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
      }
      throw new StudyRunError('STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);
    }

    const appliedTransition = updatedRun.quotaLedger?.[transition.id]?.transition;
    if (appliedTransition === 'CLAIM_INCLUDED') assignedStatus = 'INCLUDED';
    else if (appliedTransition === 'INCREMENT_SUPPLEMENTAL') assignedStatus = 'SUPPLEMENTAL';

    const finalized = await this.sessions.finalizeRunSessionQuotaStatus({
      sessionId: session.id,
      studyRunId,
      variant,
      expectedValidityFlag: 'VALID',
      expectedQuotaStatus: prevQuota,
      expectedReviewedAt: at,
      quotaStatus: assignedStatus,
      recordedBy: transition.actorUsername,
      at,
      transitionId: transition.id,
      transitionState: isRecovery ? 'RECOVERED' : 'COMMITTED'
    });

    if (!finalized) {
      const after = await this.sessions.getSession(session.id);
      if (
        after &&
        after.validityFlag === 'VALID' &&
        (after.quotaStatus === 'INCLUDED' || after.quotaStatus === 'SUPPLEMENTAL') &&
        after.quotaTransition?.state !== 'PENDING'
      ) {
        const freshRun = (await this.runs.getById(studyRunId)) ?? updatedRun;
        const auditLogged =
          (await this.ensureTransitionAudit(after)) ??
          (await this.recordValidityAudit(actor, after, 'VALID', after.quotaStatus, after.quotaStatus, false));
        return {
          session: after,
          run: freshRun,
          variant,
          previousValidityFlag: 'VALID',
          validityFlag: 'VALID',
          previousQuotaStatus: after.quotaStatus,
          quotaStatus: after.quotaStatus,
          counterChanged: false,
          warnings: evaluateQuotaWarnings(freshRun),
          auditLogged
        };
      }

      // Another Admin concurrently changed the session between Step 1 and Step 3. Roll back OUR counter increment, but
      // only if nobody else already released this session's slot (e.g. a concurrent recovery + demotion): releasing it
      // a second time would steal a slot from another session.
      const outcome = await this.compensateCounter(
        studyRunId,
        variant,
        assignedStatus === 'INCLUDED' ? 'RELEASE_INCLUDED' : 'RELEASE_SUPPLEMENTAL',
        transition,
        session.id
      );
      if (outcome === 'FAILED') throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
      throw new StudyRunError('STUDY_RUN_QUOTA_CONFLICT', 409);
    }

    const warnings = evaluateQuotaWarnings(updatedRun);
    const auditActor: QuotaActor = { username: transition.actorUsername, role: transition.actorRole };
    const auditLogged =
      (await this.ensureTransitionAudit(finalized)) ??
      (await this.recordValidityAudit(auditActor, finalized, prevFlag, prevQuota, assignedStatus, true));
    return {
      session: finalized,
      run: updatedRun,
      variant,
      previousValidityFlag: prevFlag,
      validityFlag: 'VALID',
      previousQuotaStatus: prevQuota,
      quotaStatus: assignedStatus,
      counterChanged: true,
      warnings,
      auditLogged
    };
  }

  private async executePendingDemoteClaim(
    session: SessionDoc,
    transition: SessionQuotaTransition,
    actor: QuotaActor,
    isRecovery: boolean
  ): Promise<QuotaValidityDecisionResult> {
    const studyRunId = session.studyRunId!;
    const variant = session.presentationVariant!;
    const prevFlag = transition.previousValidityFlag;
    const prevQuota = transition.previousQuotaStatus as 'INCLUDED' | 'SUPPLEMENTAL';
    const nextFlag = transition.targetValidityFlag;
    const at = transition.claimedAt;
    const counterOp = prevQuota === 'INCLUDED' ? 'RELEASE_INCLUDED' : 'RELEASE_SUPPLEMENTAL';

    const updatedRun = await this.runs.applyQuotaCounterTransition(studyRunId, variant, counterOp, transition.id, {
      sessionId: session.id,
      claimedAt: transition.claimedAt
    });
    if (!updatedRun) {
      const reverted = await this.sessions.revertRunSessionValidityClaim({
        sessionId: session.id,
        studyRunId,
        expectedReviewedAt: at,
        claimedValidityFlag: nextFlag,
        claimedQuotaStatus: 'NOT_COUNTED',
        transitionId: transition.id,
        previousValidityFlag: prevFlag,
        previousReason: transition.previousReason,
        previousReviewedBy: transition.previousReviewedBy,
        previousReviewedAt: transition.previousReviewedAt ?? undefined,
        previousChecklistVersion: transition.previousChecklistVersion ?? null,
        previousQuotaStatus: prevQuota,
        previousQuotaRecordedAt: transition.previousQuotaRecordedAt ?? null,
        previousQuotaRecordedBy: transition.previousQuotaRecordedBy ?? null,
        previousUpdatedAt: transition.previousUpdatedAt
      });
      if (!reverted) {
        throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
      }
      throw new StudyRunError('STUDY_RUN_QUOTA_COUNTER_CONFLICT', 409);
    }

    const finalized = await this.sessions.finalizeRunSessionQuotaStatus({
      sessionId: session.id,
      studyRunId,
      variant,
      expectedValidityFlag: nextFlag,
      expectedQuotaStatus: 'NOT_COUNTED',
      expectedReviewedAt: at,
      quotaStatus: 'NOT_COUNTED',
      recordedBy: transition.actorUsername,
      at,
      transitionId: transition.id,
      transitionState: isRecovery ? 'RECOVERED' : 'COMMITTED'
    });

    const finalSession = finalized ?? (await this.sessions.getSession(session.id));
    if (
      !finalSession ||
      finalSession.validityFlag !== nextFlag ||
      finalSession.quotaStatus !== 'NOT_COUNTED' ||
      finalSession.quotaTransition?.state === 'PENDING'
    ) {
      throw new StudyRunError('STUDY_RUN_QUOTA_TRANSITION_PENDING', 409);
    }

    const warnings = evaluateQuotaWarnings(updatedRun, {
      vacancyOnArm: prevQuota === 'INCLUDED' ? variant : null
    });
    const auditActor: QuotaActor = finalized ? { username: transition.actorUsername, role: transition.actorRole } : actor;
    const auditLogged =
      (await this.ensureTransitionAudit(finalSession)) ??
      (await this.recordValidityAudit(auditActor, finalSession, prevFlag, prevQuota, 'NOT_COUNTED', Boolean(finalized)));
    return {
      session: finalSession,
      run: updatedRun,
      variant,
      previousValidityFlag: prevFlag,
      validityFlag: nextFlag,
      previousQuotaStatus: prevQuota,
      quotaStatus: 'NOT_COUNTED',
      counterChanged: Boolean(finalized),
      warnings,
      auditLogged
    };
  }

  private async executePendingSupplementalPromotion(
    session: SessionDoc,
    transition: SessionQuotaTransition,
    actor: QuotaActor,
    isRecovery: boolean
  ): Promise<QuotaIncludeSupplementalResult> {
    const studyRunId = session.studyRunId!;
    const variant = session.presentationVariant!;
    const claimAt = transition.claimedAt;
    const prevRecordedAt = transition.previousQuotaRecordedAt ?? null;
    const prevRecordedBy = transition.previousQuotaRecordedBy ?? null;

    // Step 2: Atomically move 1 from supplementalValid to validIncluded if under quotaPerArm (idempotent by transition.id).
    const counterOptions = { sessionId: session.id, claimedAt: transition.claimedAt };
    let updatedRun = await this.runs.applyQuotaCounterTransition(
      studyRunId,
      variant,
      'PROMOTE_SUPPLEMENTAL',
      transition.id,
      counterOptions
    );
    // Already compensated earlier: the promotion must not be finalized (the session is reverted below).
    if (updatedRun?.quotaLedger?.[`${transition.id}:rollback`]) updatedRun = null;
    if (!updatedRun) {
      const reverted = await this.sessions.revertSupplementalQuotaPromotion({
        sessionId: session.id,
        studyRunId,
        variant,
        claimAt,
        transitionId: transition.id,
        previousRecordedAt: prevRecordedAt,
        previousRecordedBy: prevRecordedBy,
        previousUpdatedAt: transition.previousUpdatedAt
      });
      const currentRun = await this.runs.getById(studyRunId);
      if (currentRun && currentRun.quotaPerArm === null) {
        if (!reverted) throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
        throw new StudyRunError('STUDY_RUN_QUOTA_NOT_CONFIRMED', 409);
      }
      const currentSession = await this.sessions.getSession(session.id);
      if (!currentSession || currentSession.validityFlag !== 'VALID' || currentSession.quotaStatus !== 'SUPPLEMENTAL') {
        throw new StudyRunError('QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
      }
      if (!reverted) {
        throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
      }
      throw new StudyRunError('STUDY_RUN_QUOTA_FULL', 409);
    }

    // Step 3: Finalize quotaStatus = INCLUDED on the session.
    const finalized = await this.sessions.finalizeSupplementalQuotaPromotion({
      sessionId: session.id,
      studyRunId,
      variant,
      claimAt,
      transitionId: transition.id,
      transitionState: isRecovery ? 'RECOVERED' : 'COMMITTED'
    });
    if (!finalized) {
      const after = await this.sessions.getSession(session.id);
      if (
        after &&
        after.validityFlag === 'VALID' &&
        after.quotaStatus === 'INCLUDED' &&
        after.quotaTransition?.state !== 'PENDING'
      ) {
        const freshRun = (await this.runs.getById(studyRunId)) ?? updatedRun;
        const auditLogged =
          (await this.ensureTransitionAudit(after)) ??
          (await this.recordSupplementalAudit(actor, session.id, studyRunId, variant, freshRun));
        return {
          session: after,
          run: freshRun,
          variant,
          previousQuotaStatus: 'SUPPLEMENTAL',
          quotaStatus: 'INCLUDED',
          warnings: evaluateQuotaWarnings(freshRun),
          auditLogged
        };
      }
      const outcome = await this.compensateCounter(studyRunId, variant, 'REVERT_PROMOTE_SUPPLEMENTAL', transition, session.id);
      if (outcome === 'FAILED') throw new StudyRunError('STUDY_RUN_QUOTA_ROLLBACK_FAILED', 409);
      throw new StudyRunError('QUOTA_SESSION_NOT_SUPPLEMENTAL', 409);
    }

    const auditActor: QuotaActor = { username: transition.actorUsername, role: transition.actorRole };
    const auditLogged =
      (await this.ensureTransitionAudit(finalized)) ??
      (await this.recordSupplementalAudit(auditActor, session.id, studyRunId, variant, updatedRun));

    return {
      session: finalized,
      run: updatedRun,
      variant,
      previousQuotaStatus: 'SUPPLEMENTAL',
      quotaStatus: 'INCLUDED',
      warnings: evaluateQuotaWarnings(updatedRun),
      auditLogged
    };
  }

  /**
   * Resolves an in-flight or pending VALID claim by reading finalized state from persistence or driving the
   * pending transition idempotently to completion. Never guesses `quotaStatus`, never defaults `auditLogged = true`,
   * and never uses a 15-second timeout to assume completion (C2).
   */
  private async waitForInFlightValidClaim(
    sessionId: string,
    studyRunId: ObjectId,
    initial: SessionDoc,
    actor: QuotaActor
  ): Promise<QuotaValidityDecisionResult | null> {
    let current: SessionDoc | null = initial;
    for (let i = 0; i < 4; i += 1) {
      if (
        current &&
        current.validityFlag === 'VALID' &&
        (current.quotaStatus === 'INCLUDED' || current.quotaStatus === 'SUPPLEMENTAL') &&
        current.quotaTransition?.state !== 'PENDING'
      ) {
        const freshRun = await this.runs.getById(studyRunId);
        if (!freshRun) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
        const auditLogged =
          (await this.ensureTransitionAudit(current)) ??
          (await this.recordValidityAudit(actor, current, 'VALID', current.quotaStatus, current.quotaStatus, false));
        return {
          session: current,
          run: freshRun,
          variant: current.presentationVariant!,
          previousValidityFlag: 'VALID',
          validityFlag: 'VALID',
          previousQuotaStatus: current.quotaStatus,
          quotaStatus: current.quotaStatus,
          counterChanged: false,
          warnings: evaluateQuotaWarnings(freshRun),
          auditLogged
        };
      }

      if (current?.quotaTransition?.state === 'PENDING' && current.quotaTransition.kind === 'VALID_CLAIM') {
        return this.executePendingValidClaim(current, current.quotaTransition, actor, true);
      }

      current = await this.sessions.getSession(sessionId);
    }

    if (current?.validityFlag === 'VALID' && (current.quotaStatus !== 'INCLUDED' && current.quotaStatus !== 'SUPPLEMENTAL')) {
      throw new StudyRunError('STUDY_RUN_QUOTA_TRANSITION_PENDING', 409);
    }
    return null;
  }

  /**
   * Gives back the counter increment that `transition` applied, but ONLY while this transition still owns the slot.
   * If another transition already released this session's slot (typically: another instance recovered the pending
   * transition and an Admin then demoted the session), a second release would steal a slot from a different session,
   * so nothing is touched and the caller reports a conflict instead.
   */
  private async compensateCounter(
    studyRunId: ObjectId,
    variant: Presentation,
    operation: 'RELEASE_INCLUDED' | 'RELEASE_SUPPLEMENTAL' | 'REVERT_PROMOTE_SUPPLEMENTAL',
    transition: SessionQuotaTransition,
    sessionId: string
  ): Promise<CounterCompensationOutcome> {
    const applied = await this.runs.applyQuotaCounterTransition(studyRunId, variant, operation, `${transition.id}:rollback`, {
      sessionId,
      claimedAt: transition.claimedAt,
      compensates: transition.id
    });
    if (applied) return 'COMPENSATED';
    const latest = await this.runs.getById(studyRunId);
    return hasSettlingRelease(latest?.quotaLedger, sessionId, transition.claimedAt) ? 'ALREADY_SETTLED' : 'FAILED';
  }

  /**
   * Makes sure the `admin_audit` entry of a settled (COMMITTED/RECOVERED) transition exists. Idempotent by transition id,
   * so it is safe to call from the happy path, from every retry and from crash recovery.
   * Returns `null` when the session carries no transition that owes an audit (none, still PENDING, or created before
   * `auditLogged` existed), otherwise whether the entry is now durably written.
   */
  private async ensureTransitionAudit(session: SessionDoc): Promise<boolean | null> {
    const transition = session.quotaTransition;
    if (!transition || transition.state === 'PENDING' || transition.auditLogged === undefined) return null;
    if (transition.auditLogged === true) return true;

    const actor: QuotaActor = { username: transition.actorUsername, role: transition.actorRole };
    const dedupeKey = `quota-transition:${transition.id}`;
    let written: boolean;
    if (transition.kind === 'PROMOTE_SUPPLEMENTAL') {
      const run = session.studyRunId ? await this.runs.getById(session.studyRunId) : null;
      if (!run || !session.studyRunId || !session.presentationVariant) return false;
      written = await this.recordSupplementalAudit(actor, session.id, session.studyRunId, session.presentationVariant, run, dedupeKey);
    } else {
      written = await this.recordValidityAudit(
        actor,
        session,
        transition.previousValidityFlag,
        transition.previousQuotaStatus,
        transition.committedQuotaStatus ?? session.quotaStatus ?? 'NOT_COUNTED',
        true,
        { transition, dedupeKey }
      );
    }
    if (!written) return false;
    try {
      await this.sessions.markRunSessionQuotaAuditLogged(session.id, transition.id);
    } catch {
      // The entry exists; the flag is retried (idempotently) by the next repair.
    }
    return true;
  }

  private async recordSupplementalAudit(
    actor: QuotaActor,
    sessionId: string,
    studyRunId: ObjectId,
    variant: Presentation,
    run: StudyRunDoc,
    dedupeKey?: string
  ): Promise<boolean> {
    try {
      await this.audit.record({
        username: actor.username,
        role: actor.role,
        action: 'STUDY_RUN_QUOTA_SUPPLEMENTAL_INCLUDED',
        targetType: 'study_run',
        targetId: studyRunId.toHexString(),
        ...(dedupeKey ? { dedupeKey } : {}),
        metadata: {
          sessionId,
          variant,
          validIncluded: run.arms[variant].validIncluded,
          supplementalValid: run.arms[variant].supplementalValid,
          quotaPerArm: run.quotaPerArm
        }
      });
      return true;
    } catch {
      console.error('Study Run supplemental quota inclusion audit entry failed after a successful write.');
      return false;
    }
  }

  private async recordValidityAudit(
    actor: QuotaActor,
    session: SessionDoc,
    previousFlag: ValidityFlag,
    previousQuotaStatus: QuotaStatus | null,
    quotaStatus: QuotaStatus,
    counterChanged: boolean,
    fromTransition?: { transition: SessionQuotaTransition; dedupeKey: string }
  ): Promise<boolean> {
    // An audit entry written for a transition describes THAT transition (not whatever the session looks like later),
    // so a repaired entry is identical to the one the original request would have written.
    const decided = fromTransition?.transition;
    const validityFlag = decided ? decided.targetValidityFlag : session.validityFlag;
    try {
      await this.audit.record({
        username: actor.username,
        role: actor.role,
        action: 'VALIDITY_CHANGED',
        targetType: 'session',
        targetId: session.id,
        ...(fromTransition ? { dedupeKey: fromTransition.dedupeKey } : {}),
        metadata: {
          previousFlag,
          validityFlag,
          reason: decided ? decided.reason : session.validityReason,
          allChecksPass: validityFlag === 'VALID',
          checklistVersion: (decided ? decided.checklistVersion : session.validityChecklistVersion) ?? 0,
          studyRunId: session.studyRunId?.toHexString() ?? null,
          presentationVariant: session.presentationVariant ?? null,
          previousQuotaStatus,
          quotaStatus,
          counterChanged
        }
      });
      return true;
    } catch {
      console.error('Validity audit mirror could not be written; embedded history was retained.');
      return false;
    }
  }
}
