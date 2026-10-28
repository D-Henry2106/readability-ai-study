import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { checkValidity, type ValidityBundle } from '@/lib/services/validity.service';
import type { QuestionSetDoc, TestAttemptDoc, ReadingSessionDoc, ExperimentEventDoc, SessionDoc } from '@/types/research';
const now = new Date('2026-01-03T12:00:00Z');
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const contentId = new ObjectId(), questionId = new ObjectId(), packageId = new ObjectId();
const questions: QuestionSetDoc = { _id: questionId, revision: 1, label: 'PILOT test', phase: 'PILOT',
  questions: Array.from({ length: 5 }, (_, index) => ({ id: `q${index}`, prompt: `Question ${index}`, options: Array.from({ length: 4 }, (_, i) => ({ id: `q${index}o${i}`, text: `Option ${i}`, isCorrect: i === 0 })) })),
  status: 'PUBLISHED', locked: true, createdAt: now, publishedAt: now };
const session: SessionDoc = { id: 'pilot-session', status: 'COMPLETED', currentStage: 'COMPLETED', groupCode: 'A',
  assignedPackageId: packageId, assignedPackageCode: 'AI_PILOT_01', assignedPackageRevision: 1,
  contentRevisionId: contentId, questionSetId: questionId, phase: 'PILOT', deviceType: 'desktop', minimumReadingSeconds: 60,
  informationVersion: 'I1', consentVersion: 'C1', debriefVersion: 'D1', validityFlag: 'REVIEW_REQUIRED', validityReason: null,
  createdAt: now, updatedAt: at(700), completedAt: at(700), withdrawnAt: null };
const reading = (roundNo: 1 | 2, started: number): ReadingSessionDoc => ({ sessionId: session.id, roundNo, presentation: roundNo === 1 ? 'V1' : 'V2',
  startedAt: at(started), finishedAt: at(started + 90), renderedAt: at(started), nextClickedAt: at(started + 90), readingSeconds: 90, scrollCount: 1, maxScrollDepthPercent: 90 });
const attempt = (roundNo: 1 | 2, started: number, misses: number): TestAttemptDoc => ({ sessionId: session.id, roundNo, questionSetId: questionId, presentation: roundNo === 1 ? 'V1' : 'V2',
  startedAt: at(started), submittedAt: at(started + 30), score: 5 - misses,
  answers: questions.questions.map((q, i) => ({ questionId: q.id, selectedOptionId: `${q.id}o${i < misses ? 1 : 0}`, isCorrect: i >= misses })) });
const event = (type: ExperimentEventDoc['type'], roundNo?: 1 | 2): ExperimentEventDoc => ({ sessionId: session.id, type, roundNo, createdAt: now });
const evidence: ValidityBundle = { session, questions,
  consent: { sessionId: session.id, informationVersion: 'I1', consentVersion: 'C1', decision: 'ACCEPTED', decidedAt: now },
  readings: [reading(1, 30), reading(2, 500)], tests: [attempt(1, 140, 1), attempt(2, 600, 0)],
  breakDoc: { sessionId: session.id, startedAt: at(170), finishedAt: at(300) },
  events: [event('SESSION_STARTED'), event('SESSION_COMPLETED'), ...([1,2] as const).flatMap(r => [event('READING_STARTED', r), event('READING_FINISHED', r), event('TEST_STARTED', r), event('TEST_SUBMITTED', r)])] };
describe('Validity — historical PILOT fixture (not production data)', () => {
  it('retains 4/5 and 5/5 and passes complete server evidence without auto-validating', () => {
    const report = checkValidity(evidence);
    expect(report.eligible).toBe(true);
    expect(session.validityFlag).toBe('REVIEW_REQUIRED');
    expect(evidence.tests.map(t => t.score)).toEqual([4,5]);
  });
  it('flags insufficient reading time', () => {
    const readings = evidence.readings.map((r,i) => i === 0 ? { ...r, readingSeconds: 4, finishedAt: at(34) } : r);
    expect(checkValidity({ ...evidence, readings }).eligible).toBe(false);
  });
  it('does not accept false scores or changed question revisions', () => {
    const wrongScore = evidence.tests.map((t,i) => i===1?{...t,score:3}:t);
    expect(checkValidity({...evidence,tests:wrongScore}).checks.find(c=>c.code==='SERVER_SCORING')?.status).toBe('FAIL');
    const wrongRevision = evidence.tests.map((t,i) => i===0?{...t,questionSetId:new ObjectId()}:t);
    expect(checkValidity({...evidence,tests:wrongRevision}).eligible).toBe(false);
  });
  it('requires review when a break record is missing', () => {
    expect(checkValidity({ ...evidence, breakDoc: null }).checks.find(c=>c.code==='BREAK')?.status).toBe('REVIEW_REQUIRED');
  });
});
