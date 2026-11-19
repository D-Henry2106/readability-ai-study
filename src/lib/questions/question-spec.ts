/**
 * Question-set contract for NEW question sets: 15 questions, 3 per category, 1 point each (0-15).
 * Sets published earlier have 5 questions; they stay readable and are still scored against their own size
 * (see ScoringService), but they can no longer be selected for a new run.
 */
export const QUESTION_CATEGORIES = ['CONCEPTUAL', 'TERMINOLOGY', 'RELATIONSHIP', 'CONDITIONAL', 'INFERENTIAL'] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export const QUESTIONS_PER_CATEGORY = 3;
export const QUESTIONS_PER_TEST = QUESTION_CATEGORIES.length * QUESTIONS_PER_CATEGORY;
export const LEGACY_QUESTIONS_PER_TEST = 5;
export const OPTIONS_PER_QUESTION = 4;

/** Highest possible score of a stored attempt: its own answer count (5 for pre-P5 data, 15 afterwards). */
export function maxScoreOf(answerCount: number): number {
  return Math.max(answerCount, 0);
}

const CATEGORY_NAME_VI: Record<QuestionCategory, string> = {
  CONCEPTUAL: 'Conceptual', TERMINOLOGY: 'Terminology', RELATIONSHIP: 'Relationship', CONDITIONAL: 'Conditional', INFERENTIAL: 'Inferential'
};

/** Human-readable reasons a question list cannot be published yet (empty array = publishable). The server re-validates; this only explains. */
export function questionSetBlockers(
  questions: Array<{ prompt: string; category?: string; options: Array<{ text: string; isCorrect: boolean }> }>
): string[] {
  const out: string[] = [];
  if (questions.length !== QUESTIONS_PER_TEST) out.push(`Cần đúng ${QUESTIONS_PER_TEST} câu (hiện có ${questions.length}).`);
  for (const c of QUESTION_CATEGORIES) {
    const n = questions.filter((q) => q.category === c).length;
    if (n !== QUESTIONS_PER_CATEGORY) out.push(`Nhóm ${CATEGORY_NAME_VI[c]} cần ${QUESTIONS_PER_CATEGORY} câu (hiện có ${n}).`);
  }
  questions.forEach((q, i) => {
    if (!q.prompt.trim()) out.push(`Câu ${i + 1}: chưa có nội dung câu hỏi.`);
    if (q.options.length !== OPTIONS_PER_QUESTION || q.options.some((o) => !o.text.trim())) out.push(`Câu ${i + 1}: cần đủ ${OPTIONS_PER_QUESTION} lựa chọn có nội dung.`);
    if (q.options.filter((o) => o.isCorrect).length !== 1) out.push(`Câu ${i + 1}: cần đúng 1 đáp án đúng.`);
  });
  return out;
}
