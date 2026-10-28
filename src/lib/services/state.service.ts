import { ResearchRepository } from '@/lib/repositories/research.repository';
import type { ExperimentStage, SessionDoc } from '@/types/research';

const routeForStage: Record<ExperimentStage, string> = {
  INFORMATION: '/information',
  CONSENT: '/consent',
  DEMOGRAPHICS: '/demographics',
  READING_1: '/experiment/reading',
  REVIEW_1: '/experiment/review',
  TEST_1: '/experiment/test',
  BREAK: '/experiment/break',
  READING_2: '/experiment/reading',
  REVIEW_2: '/experiment/review',
  TEST_2: '/experiment/test',
  COMPLETED: '/complete'
};

export class ExperimentStateService {
  constructor(private readonly repo = new ResearchRepository()) {}

  routeFor(session: SessionDoc): string {
    if (session.status === 'DECLINED') return '/exit';
    if (session.status === 'WITHDRAWN') return '/withdraw';
    if (session.status === 'INCOMPLETE') return '/exit';
    return routeForStage[session.currentStage];
  }

  async requireStage(sessionId: string, expected: ExperimentStage | ExperimentStage[]): Promise<SessionDoc> {
    const session = await this.repo.getSession(sessionId);
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (session.status !== (session.currentStage === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE')) throw new Error('SESSION_NOT_ACTIVE');
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(session.currentStage)) throw new Error(`INVALID_STAGE:${this.routeFor(session)}`);
    return session;
  }

  async transition(sessionId: string, expected: ExperimentStage, next: ExperimentStage): Promise<SessionDoc> {
    const updated = await this.repo.compareAndSetStage(sessionId, expected, next);
    if (updated) return updated;
    const existing = await this.repo.getSession(sessionId);
    if (existing?.currentStage === next) return existing;
    throw new Error('INVALID_STAGE_TRANSITION');
  }
}
