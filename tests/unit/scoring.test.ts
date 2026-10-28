import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { ScoringService } from '@/lib/services/scoring.service';
import type { QuestionSetDoc } from '@/types/research';
const set: QuestionSetDoc = { _id: new ObjectId(), revision: 1, label: 'fixture', status: 'PUBLISHED', locked: true, phase: 'MAIN', createdAt: new Date(), publishedAt: new Date(), questions: Array.from({length:5},(_,i)=>({ id:`q${i+1}`, prompt:`fixture q${i+1}`, options:Array.from({length:4},(_,j)=>({ id:`q${i+1}o${j+1}`, text:`fixture option ${j+1}`, isCorrect:j===0 })) })) };
describe('server-side scoring', () => {
  it('scores 0-5 without treating unanswered as an answer', () => { const result = new ScoringService().score(set, set.questions.map((q,i)=>({ questionId:q.id, selectedOptionId:i===0?null:q.options[0].id }))); expect(result.score).toBe(4); expect(result.answers[0].isCorrect).toBeNull(); });
  it('rejects invalid option ids', () => expect(() => new ScoringService().score(set, set.questions.map(q=>({ questionId:q.id, selectedOptionId:'bad' })))).toThrow('INVALID_OPTION'));
});
