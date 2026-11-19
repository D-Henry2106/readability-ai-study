import type { QuestionItem } from '@/types/research';
import { QUESTION_CATEGORIES, QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';

/** A valid P5 question list: `count` questions (default 15), categories assigned 3 per category, 4 options each, the first option correct. */
export function makeQuestions(count = QUESTIONS_PER_TEST): QuestionItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q${i + 1}`,
    prompt: `Fixture question ${i + 1}?`,
    category: QUESTION_CATEGORIES[Math.floor(i / 3) % QUESTION_CATEGORIES.length],
    options: Array.from({ length: 4 }, (_, j) => ({ id: `q${i + 1}o${j + 1}`, text: `Option ${j + 1}`, isCorrect: j === 0 }))
  }));
}
