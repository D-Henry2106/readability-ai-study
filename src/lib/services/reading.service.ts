import { ResearchRepository } from '@/lib/repositories/research.repository';
import { presentationForRound } from '@/lib/experiment/presentation';
import type { SessionDoc } from '@/types/research';

export class ReadingService {
  constructor(private readonly repo = new ResearchRepository()) {}

  private roundFromStage(stage: SessionDoc['currentStage'], isStudyRun = false): 1 | 2 {
    if (stage === 'READING_1') return 1;
    if (!isStudyRun && stage === 'READING_2') return 2;
    throw new Error('INVALID_READING_STAGE');
  }

  async start(session: SessionDoc, renderedAt?: Date) {
    const isStudyRun = Boolean(session.studyRunId);
    const roundNo = this.roundFromStage(session.currentStage, isStudyRun);
    let presentation: 'V1' | 'V2';
    if (isStudyRun) {
      if (!session.presentationVariant) throw new Error('VARIANT_NOT_ASSIGNED');
      if (typeof session.presentationVersion !== 'number' || !Number.isInteger(session.presentationVersion) || session.presentationVersion < 1) {
        throw new Error('PRESENTATION_VERSION_NOT_ASSIGNED');
      }
      presentation = session.presentationVariant;
    } else {
      if (!session.groupCode) throw new Error('GROUP_NOT_ASSIGNED');
      presentation = presentationForRound(session.groupCode, roundNo);
    }
    return this.repo.createReadingIfMissing({
      sessionId: session.id,
      roundNo,
      presentation,
      ...(isStudyRun ? { presentationVersion: session.presentationVersion } : {}),
      renderedAt: renderedAt ?? null,
      nextClickedAt: null,
      startedAt: new Date(),
      finishedAt: null,
      readingSeconds: null,
      scrollCount: 0,
      maxScrollDepthPercent: 0
    });
  }

  async finish(session: SessionDoc, input: { nextClickedAt?: Date; scrollCount: number; maxScrollDepthPercent: number }) {
    const roundNo = this.roundFromStage(session.currentStage, Boolean(session.studyRunId));
    const reading = await this.repo.getReading(session.id, roundNo);
    if (!reading) throw new Error('READING_NOT_STARTED');
    if (reading.finishedAt) return { reading, remainingSeconds: 0 };
    const pinnedMinimum = session.minimumReadingSeconds ?? (await this.repo.getConfig()).minimumReadingSeconds;
    if (!pinnedMinimum) throw new Error('NEEDS_PROTOCOL_VALUE:MINIMUM_READING_TIME');
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - reading.startedAt.getTime()) / 1000);
    if (elapsed < pinnedMinimum) {
      return { reading, remainingSeconds: pinnedMinimum - elapsed };
    }
    const updated = await this.repo.finishReading(session.id, roundNo, {
      finishedAt: now,
      nextClickedAt: input.nextClickedAt ?? null,
      readingSeconds: elapsed,
      scrollCount: input.scrollCount,
      maxScrollDepthPercent: input.maxScrollDepthPercent
    });
    return { reading: updated ?? reading, remainingSeconds: 0 };
  }
}
