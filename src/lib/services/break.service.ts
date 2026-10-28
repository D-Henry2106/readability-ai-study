import { ResearchRepository } from '@/lib/repositories/research.repository';

export const BREAK_SECONDS = 120;

export class BreakService {
  constructor(private readonly repo = new ResearchRepository()) {}

  async start(sessionId: string) {
    return this.repo.createBreakIfMissing({ sessionId, startedAt: new Date(), finishedAt: null });
  }

  async status(sessionId: string) {
    const doc = await this.repo.getBreak(sessionId);
    if (!doc) throw new Error('BREAK_NOT_STARTED');
    const elapsed = Math.floor((Date.now() - doc.startedAt.getTime()) / 1000);
    return { remainingSeconds: Math.max(0, BREAK_SECONDS - elapsed), startedAt: doc.startedAt, finishedAt: doc.finishedAt };
  }

  async finish(sessionId: string) {
    const status = await this.status(sessionId);
    if (status.remainingSeconds > 0) return { finished: false, remainingSeconds: status.remainingSeconds };
    await this.repo.finishBreak(sessionId, new Date());
    return { finished: true, remainingSeconds: 0 };
  }
}
