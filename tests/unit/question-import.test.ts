import { describe, expect, it } from 'vitest';
import {
  getQuestionImportTemplate,
  validateQuestionImport
} from '@/lib/questions/question-import';
import type { QuestionItem } from '@/types/research';

describe('Question set import and validation (Issue D)', () => {
  it('validates a correct 15-question template successfully', () => {
    const template = getQuestionImportTemplate();
    expect(template).toHaveLength(15);

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questions).toHaveLength(15);
      expect(result.questions[0].options).toHaveLength(4);
      expect(result.questions[0].options.filter((o) => o.isCorrect)).toHaveLength(1);
    }
  });

  it('rejects input with wrong question count', () => {
    const template = getQuestionImportTemplate();
    const shortList = template.slice(0, 10);

    const result = validateQuestionImport(shortList);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('phải gồm đúng 15 câu hỏi'))).toBe(true);
    }

    const nonArrayResult = validateQuestionImport({ questions: template });
    expect(nonArrayResult.ok).toBe(false);
    if (!nonArrayResult.ok) {
      expect(nonArrayResult.errors[0]).toContain('Dữ liệu phải là danh sách');
    }
  });

  it('rejects questions with invalid categories', () => {
    const template = getQuestionImportTemplate();
    // Tamper with category of question 0
    (template[0] as unknown as { category: string }).category = 'UNKNOWN_CATEGORY';

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('danh mục "UNKNOWN_CATEGORY" không hợp lệ'))).toBe(true);
    }
  });

  it('rejects duplicate question IDs', () => {
    const template = getQuestionImportTemplate();
    // Set question 2 id to question 1 id
    template[1].id = template[0].id;

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('bị trùng lặp'))).toBe(true);
    }
  });

  it('rejects duplicate option IDs within the same question', () => {
    const template = getQuestionImportTemplate();
    // Duplicate option id in question 0
    template[0].options[1].id = template[0].options[0].id;

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('mã lựa chọn') && e.includes('bị trùng lặp'))).toBe(true);
    }
  });

  it('rejects wrong option count (must be exactly 4)', () => {
    const template = getQuestionImportTemplate();
    // Remove one option from question 0
    template[0].options = template[0].options.slice(0, 3);

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('phải có đúng 4 lựa chọn'))).toBe(true);
    }
  });

  it('rejects questions missing a correct answer or having multiple correct answers', () => {
    // 1. Missing correct answer (all false)
    const template1 = getQuestionImportTemplate();
    template1[0].options = template1[0].options.map((o) => ({ ...o, isCorrect: false }));

    const result1 = validateQuestionImport(template1);
    expect(result1.ok).toBe(false);
    if (!result1.ok) {
      expect(result1.errors.some((e) => e.includes('phải có đúng 1 đáp án đúng'))).toBe(true);
    }

    // 2. Multiple correct answers (2 true)
    const template2 = getQuestionImportTemplate();
    template2[0].options[0].isCorrect = true;
    template2[0].options[1].isCorrect = true;

    const result2 = validateQuestionImport(template2);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.errors.some((e) => e.includes('phải có đúng 1 đáp án đúng'))).toBe(true);
    }
  });

  it('rejects sets with category distribution not equal to 3 questions per category', () => {
    const template = getQuestionImportTemplate();
    // Change category of question from TERMINOLOGY to CONCEPTUAL (making 4 CONCEPTUAL, 2 TERMINOLOGY)
    template[3].category = 'CONCEPTUAL';

    const result = validateQuestionImport(template);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Nhóm danh mục CONCEPTUAL cần đúng 3 câu hỏi'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Nhóm danh mục TERMINOLOGY cần đúng 3 câu hỏi'))).toBe(true);
    }
  });
});
