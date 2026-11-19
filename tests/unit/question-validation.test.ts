import { describe, expect, it } from 'vitest';
import { packageInputSchema, questionSetDraftSchema, questionSetSchema } from '@/lib/validation/schemas';
import { makeQuestions } from '../helpers/question-fixtures';
import { questionSetBlockers } from '@/lib/questions/question-spec';

const valid = { label: 'fixture', phase: 'MAIN' as const, questions: makeQuestions() };

describe('question-set validation (P5: 15 questions, 3 per category)', () => {
  it('accepts exactly 15 x 4 with one correct each and 3 questions per category', () => expect(questionSetSchema.safeParse(valid).success).toBe(true));
  it('rejects the old 5-question shape and any other count', () => {
    for (const n of [5, 14, 16]) expect(questionSetSchema.safeParse({ ...valid, questions: makeQuestions(n) }).success).toBe(false);
  });
  it('rejects an uneven category split even when there are 15 questions', () => {
    const uneven = structuredClone(valid);
    uneven.questions[0].category = 'INFERENTIAL';
    expect(questionSetSchema.safeParse(uneven).success).toBe(false);
  });
  it('rejects two correct options', () => {
    const broken = structuredClone(valid);
    broken.questions[0].options[1].isCorrect = true;
    expect(questionSetSchema.safeParse(broken).success).toBe(false);
  });
  it('a DRAFT may be incomplete (0-15 questions) but never more than 15 or internally broken', () => {
    expect(questionSetDraftSchema.safeParse({ ...valid, questions: makeQuestions(4) }).success).toBe(true);
    expect(questionSetDraftSchema.safeParse({ ...valid, questions: [] }).success).toBe(true);
    expect(questionSetDraftSchema.safeParse({ ...valid, questions: makeQuestions(16) }).success).toBe(false);
    const dup = { ...valid, questions: [makeQuestions(1)[0], makeQuestions(1)[0]] };
    expect(questionSetDraftSchema.safeParse(dup).success).toBe(false);
  });
  it('a package needs the same 15-question contract', () => {
    const input = { code: 'PKG-1', title: 't', topic: 't', phase: 'MAIN' as const, rawContent: 'x', questions: makeQuestions() };
    expect(packageInputSchema.safeParse(input).success).toBe(true);
    expect(packageInputSchema.safeParse({ ...input, questions: makeQuestions(5) }).success).toBe(false);
  });
});

describe('draft vs publish (editor creates blank questions; only publish is strict)', () => {
  const blank = () => {
    const q = makeQuestions(1)[0];
    return { ...q, prompt: '', options: q.options.map((o) => ({ ...o, text: '' })) };
  };
  it('a draft may hold a blank, freshly created question', () => {
    expect(questionSetDraftSchema.safeParse({ ...valid, questions: [blank()] }).success).toBe(true);
  });
  it('publish rejects the same blank text and reports a path for the bad field', () => {
    const questions = makeQuestions();
    questions[2] = { ...questions[2], prompt: '' };
    const result = questionSetSchema.safeParse({ ...valid, questions });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'questions.2.prompt')).toBe(true);
  });
  it('questionSetBlockers is empty for a valid set and names the problem otherwise', () => {
    expect(questionSetBlockers(makeQuestions())).toEqual([]);
    expect(questionSetBlockers(makeQuestions(5)).length).toBeGreaterThan(0);
    expect(questionSetBlockers([blank()]).some((m) => m.includes('chưa có nội dung'))).toBe(true);
  });
});
