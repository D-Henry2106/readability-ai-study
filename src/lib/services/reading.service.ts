import { ResearchRepository } from '@/lib/repositories/research.repository';
import { presentationForRound } from '@/lib/experiment/presentation';
import type { SessionDoc } from '@/types/research';

export class ReadingService {
  constructor(private readonly repo = new ResearchRepository()) {}

  private roundFromStage(stage: SessionDoc['currentStage']): 1 | 2 {
    if (stage === 'READING_1') return 1;
    if (stage === 'READING_2') return 2;
    throw new Error('INVALID_READING_STAGE');
  }

  async start(session: SessionDoc, renderedAt?: Date) {
    if (!session.groupCode) throw new Error('GROUP_NOT_ASSIGNED');
    const roundNo = this.roundFromStage(session.currentStage);
    return this.repo.createReadingIfMissing({
      sessionId: session.id,
      roundNo,
      presentation: presentationForRound(session.groupCode, roundNo),
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
    const roundNo = this.roundFromStage(session.currentStage);
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
