import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { descriptive, summarizePairs } from '@/lib/services/analysis.service';
import type { ReadingSessionDoc, SessionDoc, TestAttemptDoc } from '@/types/research';

const start = new Date('2026-01-01T00:00:00Z');
const later = new Date('2026-01-01T00:01:00Z');
const questions = new ObjectId();
const content = new ObjectId();
function session(id: string, status: SessionDoc['status'], validityFlag: SessionDoc['validityFlag']): SessionDoc {
  return { id, status, validityFlag, validityChecklistVersion: validityFlag === 'VALID' ? 1 : null, validityReason: null, currentStage: status === 'COMPLETED' ? 'COMPLETED' : 'TEST_2', groupCode: 'A',
    contentRevisionId: content, questionSetId: questions, informationVersion: 'i1', consentVersion: 'c1', debriefVersion: 'd1',
    phase: 'MAIN', deviceType: 'desktop', createdAt: start, updatedAt: later, completedAt: status === 'COMPLETED' ? later : null, withdrawnAt: null };
}
function attempt(id: string, roundNo: 1 | 2, score: number): TestAttemptDoc {
  return { sessionId: id, roundNo, questionSetId: questions, presentation: roundNo === 1 ? 'V1' : 'V2', score,
    answers: Array.from({ length: 5 }, (_, i) => ({ questionId: `q${i+1}`, selectedOptionId: 'a', isCorrect: true })), startedAt: start, submittedAt: later };
}
function reading(id: string, roundNo: 1 | 2): ReadingSessionDoc {
  return { sessionId: id, roundNo, presentation: roundNo === 1 ? 'V1' : 'V2', startedAt: start, finishedAt: later,
    renderedAt: start, nextClickedAt: later, readingSeconds: 60, scrollCount: 1, maxScrollDepthPercent: 100 };
}
describe('paired descriptive statistics', () => {
  it('returns null instead of made-up numbers for empty datasets', () => {
    expect(descriptive([])).toEqual({ count: 0, mean: null, median: null, standardDeviation: null });
  });
  it('uses population of valid completed paired sessions only', () => {
    const dataset = { sessions: [session('valid', 'COMPLETED', 'VALID'), session('review', 'COMPLETED', 'REVIEW_REQUIRED'), session('open', 'ACTIVE', 'VALID')],
      tests: [attempt('valid',1,2), attempt('valid',2,4), attempt('review',1,5), attempt('review',2,5), attempt('open',1,0), attempt('open',2,5)],
      readings: ['valid','review','open'].flatMap(id => [reading(id,1), reading(id,2)]) };
    const summary = summarizePairs(dataset);
    expect(summary.completedPairs).toBe(2);
    expect(summary.validPairs).toBe(1);
    expect(summary.v1.mean).toBe(2);
    expect(summary.v2.mean).toBe(4);
    expect(summary.differences.mean).toBe(2);
    expect(summary.excludedCompleted).toBe(0);
    expect(summary.pendingReview).toBe(1);
  });
  it('excludes missing reading rounds and misplaced presentation', () => {
    const result = summarizePairs({ sessions: [session('incomplete', 'COMPLETED', 'VALID')],
      tests: [attempt('incomplete',1,4),attempt('incomplete',2,5)], readings: [reading('incomplete',1)] });
    expect(result.validPairs).toBe(0);
    expect(result.completedPairs).toBe(0);
  });
});
