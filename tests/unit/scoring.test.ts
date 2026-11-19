import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { ScoringService } from '@/lib/services/scoring.service';
import { testSubmitSchema } from '@/lib/validation/schemas';
import type { QuestionSetDoc } from '@/types/research';
import { makeQuestions } from '../helpers/question-fixtures';

const setOf = (n: number): QuestionSetDoc => ({ _id: new ObjectId(), revision: 1, label: 'fixture', status: 'PUBLISHED', locked: true, phase: 'MAIN', createdAt: new Date(), publishedAt: new Date(), questions: makeQuestions(n) });
const answerAll = (set: QuestionSetDoc, wrong: number) => set.questions.map((q, i) => ({ questionId: q.id, selectedOptionId: i < wrong ? q.options[1].id : q.options[0].id }));

describe('server-side scoring (0-15)', () => {
  it('scores a 15-question set out of 15, one point per correct answer', () => {
    const set = setOf(15);
    expect(new ScoringService().score(set, answerAll(set, 0)).score).toBe(15);
    expect(new ScoringService().score(set, answerAll(set, 4)).score).toBe(11);
    expect(new ScoringService().score(set, answerAll(set, 15)).score).toBe(0);
  });
  it('does not treat an unanswered question as an answer', () => {
    const set = setOf(15);
    const answers = set.questions.map((q, i) => ({ questionId: q.id, selectedOptionId: i === 0 ? null : q.options[0].id }));
    const result = new ScoringService().score(set, answers);
    expect(result.score).toBe(14);
    expect(result.answers[0].isCorrect).toBeNull();
  });
  it('requires an answer for every question of the set (14 of 15 is rejected)', () => {
    const set = setOf(15);
    expect(() => new ScoringService().score(set, answerAll(set, 0).slice(1))).toThrow('INVALID_ANSWER_PAYLOAD');
  });
  it('still scores a pre-P5 5-question set out of 5 (old data stays readable)', () => {
    const legacy = setOf(5);
    expect(new ScoringService().score(legacy, answerAll(legacy, 1)).score).toBe(4);
  });
  it('rejects any other set size and invalid option ids', () => {
    expect(() => new ScoringService().score(setOf(7), [])).toThrow('INVALID_QUESTION_SET');
    const set = setOf(15);
    expect(() => new ScoringService().score(set, set.questions.map((q) => ({ questionId: q.id, selectedOptionId: 'bad' })))).toThrow('INVALID_OPTION');
  });
  it('the submit payload allows up to 15 answers and no more', () => {
    const payload = (n: number) => ({ answers: makeQuestions(n).map((q) => ({ questionId: q.id, selectedOptionId: null })) });
    expect(testSubmitSchema.safeParse(payload(15)).success).toBe(true);
    expect(testSubmitSchema.safeParse(payload(16)).success).toBe(false);
  });
});
