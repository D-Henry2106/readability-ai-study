import { randomUUID } from 'node:crypto';
import { ResearchRepository } from '@/lib/repositories/research.repository';
import { ReadinessService } from './readiness.service';
import { EventService } from './event.service';
import type { DeviceType, SessionDoc } from '@/types/research';
import { PackageService } from './package.service';
import { ensureIndexes } from '@/lib/db/indexes';

export class SessionService {
  constructor(
    private readonly repo = new ResearchRepository(),
    private readonly readiness = new ReadinessService(repo),
    private readonly events = new EventService(repo)
  ) {}

  async create(deviceType: DeviceType): Promise<SessionDoc> {
    await ensureIndexes();
    const result = await this.readiness.check();
    if (!result.ready) throw new Error(`EXPERIMENT_NOT_READY:${result.missing.join(',')}`);
    const config = await this.repo.getConfig();
    const { pkg, mode } = await new PackageService(this.repo).choose(config);
    if (!pkg._id || !config.informationVersion || !config.consentVersion || !config.debriefVersion) {
      throw new Error('EXPERIMENT_NOT_READY');
    }
    const now = new Date();
    const session: SessionDoc = {
      id: randomUUID(),
      participantId: randomUUID(),
      status: 'ACTIVE',
      currentStage: 'INFORMATION',
      groupCode: null,
      contentRevisionId: pkg.contentRevisionId,
      questionSetId: pkg.questionSetId,
      assignedPackageId: pkg._id,
      assignedPackageRevision: pkg.revision,
      assignedPackageCode: pkg.code,
      assignedPackageTopic: pkg.topic,
      packageAssignmentMethod: mode,
      packageAssignedAt: now,
      informationVersion: config.informationVersion,
      consentVersion: config.consentVersion,
      debriefVersion: config.debriefVersion,
      informationTextSnapshot: config.informationText!,
      consentTextSnapshot: config.consentText!,
      debriefTextSnapshot: config.debriefText!,
      dataRightsTextSnapshot: config.dataRightsText!,
      findingsTextSnapshot: config.findingsText!,
      minimumReadingSeconds: config.minimumReadingSeconds!,
      phase: config.phase,
      deviceType,
      validityFlag: 'REVIEW_REQUIRED',
      validityReason: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      withdrawnAt: null
    };
    await this.repo.createSession(session);
    await this.events.add(session.id, 'SESSION_STARTED');
    await this.events.add(session.id, 'PACKAGE_ASSIGNED');
    return session;
  }
}
