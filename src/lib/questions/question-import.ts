import {
  OPTIONS_PER_QUESTION,
  QUESTION_CATEGORIES,
  QUESTIONS_PER_CATEGORY,
  QUESTIONS_PER_TEST,
  type QuestionCategory
} from './question-spec';
import type { QuestionItem, QuestionOption } from '@/types/research';

export type QuestionImportResult =
  | { ok: true; questions: QuestionItem[] }
  | { ok: false; errors: string[] };

/**
 * Validates the structure and content of a question set imported from JSON.
 * Requirements:
 * - Exactly 15 questions
 * - Each question has: id, prompt, valid category, exactly 4 options
 * - Exactly 3 questions per category
 * - Each option has: id, text, isCorrect
 * - Exactly 1 correct answer per question
 * - No duplicate question IDs
 * - No duplicate option IDs within a question
 */
export function validateQuestionImport(raw: unknown): QuestionImportResult {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      errors: ['Dữ liệu phải là danh sách (mảng) gồm đúng 15 câu hỏi.']
    };
  }

  if (raw.length !== QUESTIONS_PER_TEST) {
    errors.push(
      `Bộ câu hỏi phải gồm đúng ${QUESTIONS_PER_TEST} câu hỏi (hiện có ${raw.length} câu).`
    );
  }

  const seenQuestionIds = new Set<string>();
  const categoryCounts = new Map<QuestionCategory, number>();
  for (const c of QUESTION_CATEGORIES) {
    categoryCounts.set(c, 0);
  }

  const parsedQuestions: QuestionItem[] = [];

  raw.forEach((item, index) => {
    const questionNum = index + 1;
    if (!item || typeof item !== 'object') {
      errors.push(`Câu ${questionNum}: dữ liệu không đúng định dạng đối tượng.`);
      return;
    }

    const q = item as Partial<QuestionItem>;

    // 1. Validate Question ID
    if (!q.id || typeof q.id !== 'string' || !q.id.trim()) {
      errors.push(`Câu ${questionNum}: thiếu mã nhận diện câu hỏi (id).`);
    } else {
      const qid = q.id.trim();
      if (seenQuestionIds.has(qid)) {
        errors.push(`Câu ${questionNum}: mã câu hỏi id="${qid}" bị trùng lặp.`);
      } else {
        seenQuestionIds.add(qid);
      }
    }

    // 2. Validate Category
    const category = q.category as QuestionCategory;
    if (!category || !QUESTION_CATEGORIES.includes(category)) {
      errors.push(
        `Câu ${questionNum}: danh mục "${q.category ?? ''}" không hợp lệ. Cho phép: ${QUESTION_CATEGORIES.join(', ')}.`
      );
    } else {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }

    // 3. Validate Prompt
    if (typeof q.prompt !== 'string') {
      errors.push(`Câu ${questionNum}: nội dung câu hỏi (prompt) phải là chuỗi ký tự.`);
    }

    // 4. Validate Options
    if (!Array.isArray(q.options) || q.options.length !== OPTIONS_PER_QUESTION) {
      errors.push(
        `Câu ${questionNum}: phải có đúng ${OPTIONS_PER_QUESTION} lựa chọn (hiện có ${q.options ? q.options.length : 0}).`
      );
    } else {
      const seenOptionIds = new Set<string>();
      let correctCount = 0;
      const validOptions: QuestionOption[] = [];

      q.options.forEach((opt, optIndex) => {
        const optNum = optIndex + 1;
        if (!opt || typeof opt !== 'object') {
          errors.push(`Câu ${questionNum}, Lựa chọn ${optNum}: dữ liệu không đúng định dạng.`);
          return;
        }

        const o = opt as Partial<QuestionOption>;

        if (!o.id || typeof o.id !== 'string' || !o.id.trim()) {
          errors.push(`Câu ${questionNum}, Lựa chọn ${optNum}: thiếu mã lựa chọn (id).`);
        } else {
          const oid = o.id.trim();
          if (seenOptionIds.has(oid)) {
            errors.push(
              `Câu ${questionNum}: mã lựa chọn "${oid}" bị trùng lặp trong cùng câu hỏi.`
            );
          } else {
            seenOptionIds.add(oid);
          }
        }

        if (typeof o.text !== 'string') {
          errors.push(`Câu ${questionNum}, Lựa chọn ${optNum}: nội dung (text) phải là chuỗi ký tự.`);
        }

        if (typeof o.isCorrect !== 'boolean') {
          errors.push(
            `Câu ${questionNum}, Lựa chọn ${optNum}: trường isCorrect phải có giá trị true hoặc false.`
          );
        } else if (o.isCorrect) {
          correctCount += 1;
        }

        validOptions.push({
          id: typeof o.id === 'string' ? o.id.trim() : `opt_${optIndex}`,
          text: typeof o.text === 'string' ? o.text : '',
          isCorrect: Boolean(o.isCorrect)
        });
      });

      if (correctCount !== 1) {
        errors.push(
          `Câu ${questionNum}: phải có đúng 1 đáp án đúng (isCorrect = true), hiện có ${correctCount}.`
        );
      }

      parsedQuestions.push({
        id: typeof q.id === 'string' ? q.id.trim() : `q_${index}`,
        category: category ?? 'CONCEPTUAL',
        prompt: typeof q.prompt === 'string' ? q.prompt : '',
        options: validOptions
      });
    }
  });

  // 5. Validate exactly 3 questions per category (if total questions is 15)
  if (raw.length === QUESTIONS_PER_TEST) {
    for (const c of QUESTION_CATEGORIES) {
      const count = categoryCounts.get(c) ?? 0;
      if (count !== QUESTIONS_PER_CATEGORY) {
        errors.push(
          `Nhóm danh mục ${c} cần đúng ${QUESTIONS_PER_CATEGORY} câu hỏi (hiện có ${count} câu).`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, questions: parsedQuestions };
}

/**
 * Generates a ready-to-use JSON template containing 15 questions (3 per category).
 */
export function getQuestionImportTemplate(): QuestionItem[] {
  const template: QuestionItem[] = [];
  let count = 1;

  for (const category of QUESTION_CATEGORIES) {
    for (let i = 1; i <= QUESTIONS_PER_CATEGORY; i += 1) {
      const qid = `q${count}`;
      template.push({
        id: qid,
        category,
        prompt: `Nội dung câu hỏi ${count} (${category})`,
        options: [
          { id: `${qid}o1`, text: 'Lựa chọn A (Đáp án đúng)', isCorrect: true },
          { id: `${qid}o2`, text: 'Lựa chọn B', isCorrect: false },
          { id: `${qid}o3`, text: 'Lựa chọn C', isCorrect: false },
          { id: `${qid}o4`, text: 'Lựa chọn D', isCorrect: false }
        ]
      });
      count += 1;
    }
  }

  return template;
}
