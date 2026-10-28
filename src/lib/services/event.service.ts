import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { ExperimentEventDoc } from '@/types/research';

export class EventService {
  constructor(private readonly repo = new ResearchRepository()) {}
  async add(sessionId: string, type: ExperimentEventDoc['type'], roundNo?: 1 | 2): Promise<void> {
    const session = await this.repo.getSession(sessionId);
    await this.repo.addEvent({ sessionId, type, roundNo, stage: session?.currentStage, createdAt: new Date() });
  }
}
