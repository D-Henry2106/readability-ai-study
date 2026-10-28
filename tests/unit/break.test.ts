import { describe, expect, it } from 'vitest';
import { BreakService, BREAK_SECONDS } from '@/lib/services/break.service';
import type { ResearchRepository } from '@/lib/repositories/research.repository';
describe('break validation', () => {
  it('requires 120 seconds', () => expect(BREAK_SECONDS).toBe(120));
  it('does not finish an active break early', async () => { const repo={ getBreak:async()=>({sessionId:'s',startedAt:new Date(Date.now()-10000),finishedAt:null}) } as unknown as ResearchRepository; const result=await new BreakService(repo).finish('s'); expect(result.finished).toBe(false); expect(result.remainingSeconds).toBeGreaterThan(0); });
});
