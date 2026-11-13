import { LEGACY_QUESTIONS_PER_TEST, QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';
import type { QuestionSetDoc, TestAnswer } from '@/types/research';

export class ScoringService {
  score(questionSet: QuestionSetDoc, answers: Array<{ questionId: string; selectedOptionId: string | null }>): { score: number; answers: TestAnswer[] } {
    // The size comes from the question set itself: 15 for P5 sets, 5 for sets published before P5 (kept scorable for old data).
    const size = questionSet.questions.length;
    if (size !== LEGACY_QUESTIONS_PER_TEST && size !== QUESTIONS_PER_TEST) throw new Error('INVALID_QUESTION_SET');
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedOptionId]));
    if (answerMap.size !== size || answers.length !== size || questionSet.questions.some((q) => !answerMap.has(q.id))) throw new Error('INVALID_ANSWER_PAYLOAD');
    let score = 0;
    const scored = questionSet.questions.map((question) => {
      const selectedOptionId = answerMap.get(question.id) ?? null;
      const selected = selectedOptionId ? question.options.find((option) => option.id === selectedOptionId) : undefined;
      if (selectedOptionId && !selected) throw new Error('INVALID_OPTION');
      const isCorrect = selectedOptionId === null ? null : Boolean(selected?.isCorrect);
      if (isCorrect) score += 1;
      return { questionId: question.id, selectedOptionId, isCorrect };
    });
    return { score, answers: scored };
  }
}
