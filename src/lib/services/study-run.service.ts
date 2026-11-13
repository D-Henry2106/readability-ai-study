import { ObjectId } from 'mongodb';
import { assertRole } from '@/lib/auth/roles';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import {
  PresentationProfileRepository,
  type PresentationProfileStore
} from '@/lib/repositories/presentation-profile.repository';
import { StudyRunRepository, type StudyRunAdminUpdate, type StudyRunStore } from '@/lib/repositories/study-run.repository';
import { AuditService } from './audit.service';
import { PackageService } from './package.service';
import { StudyRunError } from '@/lib/study-run/errors';
import { missingCapabilities, STUDY_RUN_CAPABILITIES, type StudyRunCapabilities } from '@/lib/study-run/capabilities';
import { currentInfoConsent, infoConsentState, type InfoConsentState } from '@/lib/study-run/info-consent';
import { proposeQuotaPerArm } from '@/lib/study-run/quota';
import {
  studyRunCreateSchema,
  studyRunEntryPolicySchema,
  studyRunInfoConsentSchema,
  studyRunPresentationProfileSchema,
  studyRunQuotaConfirmSchema,
  studyRunSampleSizeSchema,
  studyRunTransitionSchema
} from '@/lib/validation/study-run-schemas';
import { questionSetSchema } from '@/lib/validation/schemas';
import type { AdminRole, ContentPackageDoc, QuestionSetDoc } from '@/types/research';
import type { StudyRunDoc, StudyRunStatus } from '@/types/study-run';

export interface StudyRunActor { username: string; role: AdminRole }

export interface StudyRunServiceDeps {
  store?: StudyRunStore;
  profiles?: Pick<PresentationProfileStore, 'getById'>;
  research?: Pick<ResearchRepository, 'getConfig' | 'getPackageById' | 'getContentById' | 'getQuestionSetById' | 'addAudit'>;
  packages?: Pick<PackageService, 'verifyPackage'>;
  audit?: Pick<AuditService, 'record'>;
  /** Production default: singleRoundFlow and quotaRecording stay false until P4. Tests inject true. */
  capabilities?: StudyRunCapabilities;
  now?: () => Date;
}

/** Result of a write: the saved run plus whether the audit entry was written (same tolerance as config updates). */
export interface StudyRunWriteResult {
  run: StudyRunDoc;
  /** What the system PROPOSES for each arm (N/2). Nothing is stored until an Admin confirms it. */
  proposedQuotaPerArm: number;
  auditLogged: boolean;
}

const TRANSITIONS: Record<StudyRunStatus, readonly StudyRunStatus[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['PAUSED', 'CLOSED'],
  PAUSED: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN']
};

/**
 * Study Run core (P1 + P3 presentation profile readiness). Every write requires RESEARCHER and an `expectedVersion`
 * (optimistic locking), and is audited. Nothing here changes status, quota, entry policy or variant on its own, and
 * nothing here writes the `arms` counters.
 */
export class StudyRunService {
  private readonly store: StudyRunStore;
  private readonly profiles: NonNullable<StudyRunServiceDeps['profiles']>;
  private readonly research: NonNullable<StudyRunServiceDeps['research']>;
  private readonly packages: NonNullable<StudyRunServiceDeps['packages']>;
  private readonly audit: NonNullable<StudyRunServiceDeps['audit']>;
  private readonly capabilities: StudyRunCapabilities;
  private readonly now: () => Date;

  constructor(deps: StudyRunServiceDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.store = deps.store ?? new StudyRunRepository();
    this.profiles = deps.profiles ?? new PresentationProfileRepository();
    this.research = research;
    this.packages = deps.packages ?? new PackageService(research as ResearchRepository);
    this.audit = deps.audit ?? new AuditService(research as ResearchRepository);
    this.capabilities = deps.capabilities ?? STUDY_RUN_CAPABILITIES;
    this.now = deps.now ?? (() => new Date());
  }

  // ---- reads (RESEARCHER and SUPERVISOR) -------------------------------------------------------------------

  async get(actor: StudyRunActor, id: string): Promise<StudyRunDoc> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return this.load(id);
  }

  async list(actor: StudyRunActor, filter: { status?: StudyRunStatus } = {}): Promise<StudyRunDoc[]> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    return this.store.list(filter);
  }

  /** Warning state for the Information/Consent confirmation (changed content only warns; it never blocks an open run). */
  async infoConsentState(actor: StudyRunActor, id: string): Promise<InfoConsentState> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    const run = await this.load(id);
    return infoConsentState(run.infoConsentReview, await this.research.getConfig());
  }

  /** What currently prevents DRAFT/CLOSED -> OPEN. Read-only. */
  async checkOpenReadiness(actor: StudyRunActor, id: string): Promise<{ ready: boolean; missing: string[] }> {
    assertRole(actor, ['RESEARCHER', 'SUPERVISOR']);
    const missing = await this.openMissing(await this.load(id), 'FULL');
    return { ready: missing.length === 0, missing };
  }

  // ---- writes (RESEARCHER only) ----------------------------------------------------------------------------

  async create(actor: StudyRunActor, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunCreateSchema.parse(payload);
    const pkg = await this.research.getPackageById(new ObjectId(input.packageId));
    if (!pkg?._id) throw new StudyRunError('STUDY_RUN_PACKAGE_NOT_FOUND', 404);
    // P5: the run snapshots ONE question set (15 questions, PUBLISHED) used by both V1 and V2 links.
    const questionSetId = input.questionSetId ? new ObjectId(input.questionSetId) : (pkg.questionSetId ?? null);
    if (!questionSetId) throw new StudyRunError('STUDY_RUN_QUESTION_SET_REQUIRED', 400);
    const problems = await this.packageProblems(pkg, { phase: input.phase, questionSetId });
    if (problems.length) throw new StudyRunError('STUDY_RUN_PACKAGE_NOT_ELIGIBLE', 409, problems);

    const now = this.now();
    const doc: StudyRunDoc = {
      code: input.code.toUpperCase(),
      name: input.name,
      phase: input.phase,
      status: 'DRAFT',
      entryMode: 'INVITATION_ONLY',
      entryPolicy: null,
      targetSampleSize: input.targetSampleSize,
      quotaPerArm: null,
      quotaConfirmedBy: null,
      quotaConfirmedAt: null,
      snapshot: {
        packageId: pkg._id,
        packageCode: pkg.code,
        packageRevision: pkg.revision,
        contentRevisionId: pkg.contentRevisionId,
        questionSetId,
        questionSetRevision: (await this.research.getQuestionSetById(questionSetId))!.revision
      },
      presentation: { V1: { version: null }, V2: { profileId: null, version: null } },
      arms: { V1: { validIncluded: 0, supplementalValid: 0 }, V2: { validIncluded: 0, supplementalValid: 0 } },
      infoConsentReview: null,
      locked: false,
      version: 1,
      createdBy: actor.username,
      createdAt: now,
      statusChangedBy: actor.username,
      statusChangedAt: now
    };
    let insertedId: ObjectId;
    try {
      insertedId = await this.store.insert(doc);
    } catch (error) {
      if (isDuplicateKey(error)) throw new StudyRunError('STUDY_RUN_CODE_EXISTS', 409);
      throw error;
    }
    const run: StudyRunDoc = { ...doc, _id: insertedId };
    const auditLogged = await this.record(actor, 'STUDY_RUN_CREATED', run, {
      code: run.code, phase: run.phase, targetSampleSize: run.targetSampleSize,
      packageCode: run.snapshot.packageCode, packageRevision: run.snapshot.packageRevision
    });
    return this.result(run, auditLogged);
  }

  /**
   * Changes the total sample size. The stored quota confirmation is reset: the Admin must confirm the new N/2 split.
   * Refused while OPEN (an OPEN run must always have a confirmed quota: pause it first) and when the new per-arm
   * quota would fall below the number of valid sessions already included in either arm.
   */
  async updateSampleSize(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunSampleSizeSchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    if (run.status === 'OPEN') throw new StudyRunError('STUDY_RUN_OPEN_PAUSE_FIRST', 409);
    if (input.targetSampleSize === run.targetSampleSize) throw new StudyRunError('STUDY_RUN_SAMPLE_SIZE_UNCHANGED', 409);
    const perArm = proposeQuotaPerArm(input.targetSampleSize);
    const floor = Math.max(run.arms.V1.validIncluded, run.arms.V2.validIncluded);
    const belowIncluded = () => new StudyRunError('STUDY_RUN_SAMPLE_SIZE_BELOW_VALID_INCLUDED', 409, [`validIncluded=${floor}`]);
    if (perArm < floor) throw belowIncluded();
    const saved = await this.commit(run, input.expectedVersion, {
      targetSampleSize: input.targetSampleSize, quotaPerArm: null, quotaConfirmedBy: null, quotaConfirmedAt: null
    }, belowIncluded, { 'arms.V1.validIncluded': { $lte: perArm }, 'arms.V2.validIncluded': { $lte: perArm } });
    const auditLogged = await this.record(actor, 'STUDY_RUN_SAMPLE_SIZE_CHANGED', saved, {
      previousTargetSampleSize: run.targetSampleSize, targetSampleSize: saved.targetSampleSize,
      proposedQuotaPerArm: perArm, previousQuotaWasConfirmed: run.quotaPerArm !== null
    });
    return this.result(saved, auditLogged);
  }

  /** The Admin confirms the equal split. The value sent must equal the proposed N/2 for the current sample size. */
  async confirmQuota(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunQuotaConfirmSchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    const proposed = proposeQuotaPerArm(run.targetSampleSize);
    if (input.quotaPerArm !== proposed) throw new StudyRunError('STUDY_RUN_QUOTA_MISMATCH', 409, [`proposed=${proposed}`]);
    const saved = await this.commit(run, input.expectedVersion, {
      quotaPerArm: proposed, quotaConfirmedBy: actor.username, quotaConfirmedAt: this.now()
    });
    const auditLogged = await this.record(actor, 'STUDY_RUN_QUOTA_CONFIRMED', saved, {
      targetSampleSize: saved.targetSampleSize, quotaPerArm: proposed
    });
    return this.result(saved, auditLogged);
  }

  /** Stores the Admin's explicit choice. P1 does NOT enforce it: /api/session is unchanged (enforcement is P2). */
  async confirmEntryPolicy(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunEntryPolicySchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    const saved = await this.commit(run, input.expectedVersion, {
      entryPolicy: { entryMode: 'INVITATION_ONLY', legacyEntry: input.legacyEntry, confirmedBy: actor.username, confirmedAt: this.now() }
    });
    const auditLogged = await this.record(actor, 'STUDY_RUN_ENTRY_POLICY_CONFIRMED', saved, {
      legacyEntry: input.legacyEntry, previousLegacyEntry: run.entryPolicy?.legacyEntry ?? null
    });
    return this.result(saved, auditLogged);
  }

  /** Records who confirmed, when, and the versions + SHA-256 of the three texts. The texts themselves are never edited. */
  async confirmInfoConsentReview(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunInfoConsentSchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    const current = currentInfoConsent(await this.research.getConfig());
    if (!current.ok) throw new StudyRunError('STUDY_RUN_PROTOCOL_NOT_READY', 409, current.missing);
    const saved = await this.commit(run, input.expectedVersion, {
      infoConsentReview: { confirmedBy: actor.username, confirmedAt: this.now(), ...current.value }
    });
    const auditLogged = await this.record(actor, 'STUDY_RUN_INFO_CONSENT_REVIEWED', saved, {
      informationVersion: current.value.informationVersion, consentVersion: current.value.consentVersion,
      debriefVersion: current.value.debriefVersion, informationSha256: current.value.informationSha256,
      consentSha256: current.value.consentSha256, debriefSha256: current.value.debriefSha256
    });
    return this.result(saved, auditLogged);
  }

  /**
   * P3: Binds a CONFIRMED (or LOCKED) V2 presentation profile matching the run's snapshotted content revision.
   * Refused once the run is locked (after the first invitation is issued) or while OPEN.
   */
  async confirmPresentationProfile(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunPresentationProfileSchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    if (run.locked) throw new StudyRunError('STUDY_RUN_LOCKED', 409);
    if (run.status === 'OPEN') throw new StudyRunError('STUDY_RUN_OPEN_PAUSE_FIRST', 409);

    const profile = await this.profiles.getById(new ObjectId(input.profileId));
    if (!profile?._id) throw new StudyRunError('PRESENTATION_PROFILE_NOT_FOUND', 404);
    const content = await this.research.getContentById(run.snapshot.contentRevisionId);
    if (
      !profile.contentRevisionId.equals(run.snapshot.contentRevisionId) ||
      (content?.contentHash && profile.contentHash !== content.contentHash)
    ) {
      throw new StudyRunError('PRESENTATION_PROFILE_CONTENT_MISMATCH', 409);
    }
    if (profile.status !== 'CONFIRMED' && profile.status !== 'LOCKED') {
      throw new StudyRunError('PRESENTATION_PROFILE_NOT_CONFIRMED', 409);
    }

    const saved = await this.commit(
      run,
      input.expectedVersion,
      { presentation: { V1: { version: 1 }, V2: { profileId: profile._id, version: profile.version } } },
      () => new StudyRunError('STUDY_RUN_LOCKED', 409),
      { locked: false }
    );
    const auditLogged = await this.record(actor, 'STUDY_RUN_PRESENTATION_PROFILE_CONFIRMED', saved, {
      profileId: profile._id.toHexString(),
      profileVersion: profile.version
    });
    return this.result(saved, auditLogged);
  }

  /** The only way status changes. Always an explicit Admin action; the system never opens, pauses or closes a run. */
  async transition(actor: StudyRunActor, id: string, payload: unknown): Promise<StudyRunWriteResult> {
    assertRole(actor, ['RESEARCHER']);
    const input = studyRunTransitionSchema.parse(payload);
    const run = await this.load(id);
    this.assertVersion(run, input.expectedVersion);
    if (!TRANSITIONS[run.status].includes(input.to)) {
      throw new StudyRunError('STUDY_RUN_TRANSITION_NOT_ALLOWED', 409, [`${run.status}->${input.to}`]);
    }
    const reason = input.reason?.trim() || null;
    if (run.status === 'CLOSED' && input.to === 'OPEN' && !reason) throw new StudyRunError('STUDY_RUN_REOPEN_REASON_REQUIRED', 400);
    if (input.to === 'OPEN') {
      // Resuming a paused run only needs the quota invariant; DRAFT -> OPEN and reopening re-check every condition.
      const missing = await this.openMissing(run, run.status === 'PAUSED' ? 'RESUME' : 'FULL');
      if (missing.length) throw new StudyRunError('STUDY_RUN_NOT_READY', 409, missing);
    }
    const at = this.now();
    const saved = await this.commit(run, input.expectedVersion, { status: input.to, statusChangedBy: actor.username, statusChangedAt: at });
    const auditLogged = await this.record(actor, 'STUDY_RUN_STATUS_CHANGED', saved, { from: run.status, to: input.to, reason });
    return this.result(saved, auditLogged);
  }

  // ---- internals -------------------------------------------------------------------------------------------

  private async load(id: string): Promise<StudyRunDoc> {
    if (!/^[a-fA-F0-9]{24}$/.test(id)) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    const run = await this.store.getById(new ObjectId(id));
    if (!run) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    return run;
  }

  private assertVersion(run: StudyRunDoc, expectedVersion: number): void {
    if (run.version !== expectedVersion) throw new StudyRunError('STUDY_RUN_VERSION_CONFLICT', 409);
  }

  /** Compare-and-set on `version`. A miss is explained by re-reading: gone (404), stale version (409), or a guard failure. */
  private async commit(
    run: StudyRunDoc,
    expectedVersion: number,
    update: StudyRunAdminUpdate,
    onGuardMiss?: () => StudyRunError,
    guard?: Parameters<StudyRunStore['updateIfVersion']>[3]
  ): Promise<StudyRunDoc> {
    const saved = await this.store.updateIfVersion(run._id!, expectedVersion, update, guard);
    if (saved) return saved;
    const current = await this.store.getById(run._id!);
    if (!current) throw new StudyRunError('STUDY_RUN_NOT_FOUND', 404);
    if (current.version !== expectedVersion || !onGuardMiss) throw new StudyRunError('STUDY_RUN_VERSION_CONFLICT', 409);
    throw onGuardMiss();
  }

  private result(run: StudyRunDoc, auditLogged: boolean): StudyRunWriteResult {
    return { run, proposedQuotaPerArm: proposeQuotaPerArm(run.targetSampleSize), auditLogged };
  }

  private async record(
    actor: StudyRunActor,
    action: string,
    run: StudyRunDoc,
    metadata: Record<string, string | number | boolean | null>
  ): Promise<boolean> {
    try {
      await this.audit.record({ username: actor.username, role: actor.role, action, targetType: 'study_run', targetId: run._id!.toHexString(), metadata });
      return true;
    } catch {
      // The write already committed; do not report a failure for it (same tolerance as updateResearchConfig).
      console.error('Study Run audit entry failed after a successful write.');
      return false;
    }
  }

  /** Package/content/question checks shared by creation (phase check) and opening (snapshot check). */
  private async packageProblems(pkg: ContentPackageDoc, options: { phase?: string; snapshot?: StudyRunDoc['snapshot']; questionSetId: ObjectId }): Promise<string[]> {
    const problems: string[] = [];
    if (pkg.status !== 'PUBLISHED' || !pkg.enabled) problems.push('PACKAGE_NOT_PUBLISHED');
    if (options.phase && pkg.phase !== options.phase) problems.push('PACKAGE_PHASE_MISMATCH');
    // The package's OWN question set is not what the run uses (the run snapshots `options.questionSetId`), so its verdict is dropped here.
    problems.push(...(await this.packages.verifyPackage(pkg)).filter((p) => p !== 'INVALID_QUESTIONS'));
    const [content, questions] = await Promise.all([
      this.research.getContentById(pkg.contentRevisionId), this.research.getQuestionSetById(options.questionSetId)
    ]);
    if (!content || content.status !== 'PUBLISHED' || !content.locked) problems.push('CONTENT_NOT_PUBLISHED');
    problems.push(...questionSetProblems(questions, options.phase ?? pkg.phase));
    const s = options.snapshot;
    if (s && !(pkg._id?.equals(s.packageId) && pkg.code === s.packageCode && pkg.revision === s.packageRevision &&
      pkg.contentRevisionId.equals(s.contentRevisionId))) problems.push('SNAPSHOT_MISMATCH');
    return problems;
  }

  /** Conditions for OPEN (architecture §3.2, §6.5). FULL = DRAFT -> OPEN and CLOSED -> OPEN; RESUME = PAUSED -> OPEN. */
  private async openMissing(run: StudyRunDoc, mode: 'FULL' | 'RESUME'): Promise<string[]> {
    const missing: string[] = [];
    if (run.quotaPerArm === null || !run.quotaConfirmedAt || run.quotaPerArm * 2 !== run.targetSampleSize) missing.push('QUOTA_NOT_CONFIRMED');
    if (mode === 'RESUME') return missing;
    if (!run.entryPolicy) missing.push('ENTRY_POLICY_NOT_CONFIRMED');
    const config = await this.research.getConfig();
    if (!config.informationText || !config.informationVersion || !config.consentText || !config.consentVersion ||
        !config.debriefText || !config.debriefVersion || !config.dataRightsText || !config.findingsText ||
        !config.minimumReadingSeconds) {
      missing.push('PROTOCOL_NOT_READY');
    }
    const state = infoConsentState(run.infoConsentReview, config);
    if (state === 'NOT_REVIEWED') missing.push('INFO_CONSENT_NOT_CONFIRMED');
    if (state === 'CHANGED') missing.push('INFO_CONSENT_CHANGED');
    const pkg = await this.research.getPackageById(run.snapshot.packageId);
    if (!pkg) missing.push('SNAPSHOT:PACKAGE_NOT_FOUND');
    else missing.push(...(await this.packageProblems(pkg, { phase: run.phase, snapshot: run.snapshot, questionSetId: run.snapshot.questionSetId })).map((p) => `SNAPSHOT:${p}`));
    const profileId = run.presentation.V2.profileId;
    if (!profileId) {
      missing.push('PRESENTATION_PROFILE_NOT_CONFIRMED');
    } else {
      const [profile, content] = await Promise.all([
        this.profiles.getById(profileId),
        this.research.getContentById(run.snapshot.contentRevisionId)
      ]);
      if (!profile || (profile.status !== 'CONFIRMED' && profile.status !== 'LOCKED')) {
        missing.push('PRESENTATION_PROFILE_NOT_CONFIRMED');
      } else if (
        !profile.contentRevisionId.equals(run.snapshot.contentRevisionId) ||
        profile.version !== run.presentation.V2.version ||
        (content?.contentHash && profile.contentHash !== content.contentHash)
      ) {
        missing.push('PRESENTATION_PROFILE_MISMATCH');
      }
    }
    missing.push(...missingCapabilities(this.capabilities).map((name) => `CAPABILITY:${name}`));
    return missing;
  }
}

/** A question set may enter a Study Run only when PUBLISHED, locked, not archived, of the run's phase, and valid under the 15-question contract. */
export function questionSetProblems(set: QuestionSetDoc | null | undefined, phase: string): string[] {
  if (!set) return ['QUESTIONS_NOT_FOUND'];
  const problems: string[] = [];
  if (set.status !== 'PUBLISHED' || !set.locked) problems.push('QUESTIONS_NOT_PUBLISHED');
  if (set.archivedAt) problems.push('QUESTIONS_ARCHIVED');
  if (set.phase !== phase) problems.push('QUESTIONS_PHASE_MISMATCH');
  if (!questionSetSchema.safeParse({ label: set.label, phase: set.phase, questions: set.questions }).success) problems.push('INVALID_QUESTIONS');
  return problems;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
}
