import { z } from 'zod';
import { OPTIONS_PER_QUESTION, QUESTION_CATEGORIES, QUESTIONS_PER_CATEGORY, QUESTIONS_PER_TEST } from '@/lib/questions/question-spec';

export const deviceTypeSchema = z.enum(['desktop', 'tablet', 'mobile']);
export const consentSchema = z.object({ decision: z.enum(['ACCEPTED', 'DECLINED']) });
export const demographicsSchema = z.object({
  ageRange: z.string().trim().min(1).max(80).nullable(),
  gender: z.string().trim().min(1).max(80).nullable(),
  fieldOfStudy: z.string().trim().min(1).max(120).nullable(),
  yearOfStudy: z.string().trim().min(1).max(80).nullable(),
  aiUsageFrequency: z.string().trim().min(1).max(80).nullable(),
  onlineReadingFrequency: z.string().trim().min(1).max(80).nullable()
});
export const readingStartSchema = z.object({ renderedAt: z.string().datetime().optional() });
export const readingFinishSchema = z.object({
  nextClickedAt: z.string().datetime().optional(),
  scrollCount: z.number().int().min(0).max(100000),
  maxScrollDepthPercent: z.number().min(0).max(100)
});
export const testSubmitSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().min(1), selectedOptionId: z.string().min(1).nullable() })).min(1).max(QUESTIONS_PER_TEST)
});
export const validitySchema = z.object({
  validityFlag: z.enum(['VALID', 'INVALID', 'REVIEW_REQUIRED']),
  reason: z.string().trim().max(500).nullable()
}).refine(v => v.validityFlag === 'VALID' || !!v.reason, { path: ['reason'], message: 'Cần ghi lý do khi chưa xác nhận hợp lệ.' });
export const configSchema = z.object({
  studyPublished: z.boolean().default(false),
  assignmentMode: z.enum(['FIXED', 'RANDOM']).default('FIXED'),
  fixedPackageId: z.string().regex(/^[a-fA-F0-9]{24}$/).nullable().default(null),
  mainRandomApproved: z.boolean().default(false),
  allowPilotRetakes: z.boolean().default(false),
  phase: z.enum(['PILOT', 'MAIN']),
  informationText: z.string().trim().min(1).nullable(),
  informationVersion: z.string().trim().min(1).max(40).nullable(),
  consentText: z.string().trim().min(1).nullable(),
  consentVersion: z.string().trim().min(1).max(40).nullable(),
  debriefText: z.string().trim().min(1).nullable(),
  debriefVersion: z.string().trim().min(1).max(40).nullable(),
  dataRightsText: z.string().trim().min(1).nullable(),
  findingsText: z.string().trim().min(1).nullable(),
  minimumReadingSeconds: z.number().int().positive().max(7200).nullable(),
  minimumValidTarget: z.number().int().positive().max(100000),
  recruitmentTarget: z.number().int().positive().max(100000)
});

const optionSchema = z.object({ id: z.string().min(1).max(80), text: z.string().trim().min(1).max(1000), isCorrect: z.boolean() });
export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  prompt: z.string().trim().min(1).max(3000),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  options: z.array(optionSchema).length(OPTIONS_PER_QUESTION)
});
/** 15 questions, exactly 3 per category (Conceptual, Terminology, Relationship, Conditional, Inferential), 4 options, 1 correct. */
function checkQuestions(questions: Array<z.infer<typeof questionSchema>>, ctx: z.RefinementCtx, base: Array<string | number> = []) {
  for (const [index, question] of questions.entries()) {
    if (question.options.filter((o) => o.isCorrect).length !== 1) {
      ctx.addIssue({ code: 'custom', path: [...base, 'questions', index, 'options'], message: 'Each question must have exactly one correct option.' });
    }
    if (new Set(question.options.map((o) => o.id)).size !== OPTIONS_PER_QUESTION) {
      ctx.addIssue({ code: 'custom', path: [...base, 'questions', index, 'options'], message: 'Option IDs must be unique within a question.' });
    }
  }
  if (new Set(questions.map((q) => q.id)).size !== QUESTIONS_PER_TEST) {
    ctx.addIssue({ code: 'custom', path: [...base, 'questions'], message: 'Question IDs must be unique.' });
  }
  for (const category of QUESTION_CATEGORIES) {
    if (questions.filter((q) => q.category === category).length !== QUESTIONS_PER_CATEGORY) {
      ctx.addIssue({ code: 'custom', path: [...base, 'questions'], message: `Category ${category} must have exactly ${QUESTIONS_PER_CATEGORY} questions.` });
    }
  }
}
/** Draft: any number of questions up to 15 may be saved while the set is DRAFT; the full 15 x 3-per-category contract is enforced at publish. */
const draftOptionSchema = z.object({ id: z.string().min(1).max(80), text: z.string().max(1000), isCorrect: z.boolean() });
/** A draft question may still have blank text (the editor creates blank questions); blank text is rejected at publish by `questionSchema`. */
const draftQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  prompt: z.string().max(3000),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  options: z.array(draftOptionSchema).length(OPTIONS_PER_QUESTION)
});
export const questionSetDraftSchema = z.object({
  label: z.string().trim().min(1).max(120),
  phase: z.enum(['PILOT', 'MAIN']),
  questions: z.array(draftQuestionSchema).max(QUESTIONS_PER_TEST)
}).superRefine((value, ctx) => {
  for (const [index, question] of value.questions.entries()) {
    if (question.options.filter((o) => o.isCorrect).length !== 1) ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: 'Each question must have exactly one correct option.' });
    if (new Set(question.options.map((o) => o.id)).size !== OPTIONS_PER_QUESTION) ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: 'Option IDs must be unique within a question.' });
  }
  if (new Set(value.questions.map((q) => q.id)).size !== value.questions.length) ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Question IDs must be unique.' });
});
export const questionSetSchema = z.object({
  label: z.string().trim().min(1).max(120),
  phase: z.enum(['PILOT', 'MAIN']),
  questions: z.array(questionSchema).length(QUESTIONS_PER_TEST)
}).superRefine((value, ctx) => checkQuestions(value.questions, ctx));

export const contentDraftSchema = z.object({
  topicLabel: z.string().trim().min(1).max(160),
  rawContent: z.string().min(1),
  phase: z.enum(['PILOT', 'MAIN'])
});

export const packageInputSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/),
  title: z.string().trim().min(1).max(150),
  topic: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  phase: z.enum(['PILOT', 'MAIN']),
  rawContent: z.string().min(1).max(100000),
  v2Content: z.string().max(100000).nullable().optional(),
  questionSetId: z.string().regex(/^[a-fA-F0-9]{24}$/).nullable().optional(),
  questions: z.array(questionSchema).length(QUESTIONS_PER_TEST).optional(),
  aiSource: z.string().trim().max(120).nullable().optional()
}).superRefine((value, ctx) => {
  if (value.questions) {
    checkQuestions(value.questions, ctx);
  }
});
