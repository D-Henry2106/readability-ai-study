import { randomUUID } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { EventService } from './event.service';
import { currentInfoConsent } from '@/lib/study-run/info-consent';
import type { DeviceType, SessionDoc } from '@/types/research';
import type { InvitationDoc } from '@/types/invitation';
import type { StudyRunDoc } from '@/types/study-run';

export interface RunSessionDeps {
  research?: Pick<ResearchRepository, 'getConfig' | 'getPackageById' | 'createSession'>;
  events?: Pick<EventService, 'add'>;
  now?: () => Date;
}

/**
 * Creates the session of a Study Run participant (architecture §4, D6, D9). Called ONLY from the redeem flow; it never changes a
 * variant or any administrative data. Differences from the legacy SessionService.create: content, question set and package come from
 * the run's immutable snapshot, `groupCode` is null (A/B never stands for V1/V2), and the run/invitation/variant are pinned.
 * It deliberately does not depend on the legacy `studyPublished` switch, so legacy entry can stay closed while a run is open.
 */
export class RunSessionService {
  private readonly research: NonNullable<RunSessionDeps['research']>;
  private readonly events: NonNullable<RunSessionDeps['events']>;
  private readonly now: () => Date;

  constructor(deps: RunSessionDeps = {}) {
    const research = deps.research ?? new ResearchRepository();
    this.research = research;
    this.events = deps.events ?? new EventService(research as ResearchRepository);
    this.now = deps.now ?? (() => new Date());
  }

  /** Validates everything and builds the document WITHOUT writing, so a deterministic failure never consumes an invitation. */
  async build(input: { sessionId: string; run: StudyRunDoc; invitation: InvitationDoc; deviceType: DeviceType }): Promise<SessionDoc> {
    const { run, invitation } = input;
    const config = await this.research.getConfig();
    const texts = currentInfoConsent(config);
    const missing = texts.ok ? [] : [...texts.missing];
    if (!config.dataRightsText) missing.push('DATA_RIGHTS_WORDING');
    if (!config.findingsText) missing.push('FINDINGS_INFORMATION');
    if (!config.minimumReadingSeconds) missing.push('MINIMUM_READING_TIME');
    const pkg = await this.research.getPackageById(run.snapshot.packageId);
    if (!pkg || pkg.code !== run.snapshot.packageCode || pkg.revision !== run.snapshot.packageRevision
      || !pkg.contentRevisionId.equals(run.snapshot.contentRevisionId)) missing.push('RUN_PACKAGE_SNAPSHOT');
    if (missing.length || !texts.ok || !pkg) throw new Error(`EXPERIMENT_NOT_READY:${missing.join(',')}`);
    const variant = invitation.variant;
    const questionSetRevision = invitation.questionSetRevision ?? run.snapshot.questionSetRevision;
    const profileId = variant === 'V2' ? run.presentation.V2.profileId : null;
    const now = this.now();
    return {
      id: input.sessionId,
      participantId: randomUUID(),
      status: 'ACTIVE',
      currentStage: 'INFORMATION',
      groupCode: null,
      contentRevisionId: run.snapshot.contentRevisionId,
      // P5: the question set pinned by the invitation (falls back to the run snapshot for invitations issued before P5).
      questionSetId: invitation.questionSetId ?? run.snapshot.questionSetId,
      ...(questionSetRevision !== undefined ? { questionSetRevision } : {}),
      assignedPackageId: run.snapshot.packageId,
      assignedPackageRevision: run.snapshot.packageRevision,
      assignedPackageCode: run.snapshot.packageCode,
      assignedPackageTopic: pkg.topic,
      packageAssignmentMethod: 'FIXED',
      packageAssignedAt: now,
      informationVersion: texts.value.informationVersion,
      consentVersion: texts.value.consentVersion,
      debriefVersion: texts.value.debriefVersion,
      informationTextSnapshot: config.informationText!,
      consentTextSnapshot: config.consentText!,
      debriefTextSnapshot: config.debriefText!,
      dataRightsTextSnapshot: config.dataRightsText!,
      findingsTextSnapshot: config.findingsText!,
      minimumReadingSeconds: config.minimumReadingSeconds!,
      phase: run.phase,
      deviceType: input.deviceType,
      validityFlag: 'REVIEW_REQUIRED',
      validityReason: null,
      studyRunId: run._id,
      invitationId: invitation._id,
      presentationVariant: variant,
      presentationVersion: run.presentation[variant].version ?? null,
      ...(profileId ? { presentationProfileId: profileId } : {}),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      withdrawnAt: null
    };
  }

  /**
   * Idempotent insert: the session id is fixed (allocated by the invitation CAS) and unique, so repeating this after a failure
   * or a crash yields exactly one session. Events are canonical per (session, type), so repeating them is harmless too.
   */
  async persist(session: SessionDoc): Promise<'CREATED' | 'EXISTS'> {
    let outcome: 'CREATED' | 'EXISTS' = 'CREATED';
    try {
      await this.research.createSession(session);
    } catch (error) {
      const duplicate = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000;
      if (!duplicate) throw error;
      outcome = 'EXISTS';
    }
    await this.events.add(session.id, 'SESSION_STARTED');
    await this.events.add(session.id, 'PACKAGE_ASSIGNED');
    return outcome;
  }
}
