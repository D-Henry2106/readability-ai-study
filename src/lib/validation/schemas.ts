import { z } from 'zod';

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
  answers: z.array(z.object({ questionId: z.string().min(1), selectedOptionId: z.string().min(1).nullable() })).length(5)
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
  category: z.enum(['CONCEPTUAL', 'TERMINOLOGY', 'RELATIONSHIP', 'CONDITIONAL', 'INFERENTIAL']).optional(),
  options: z.array(optionSchema).length(4)
});
export const questionSetSchema = z.object({
  label: z.string().trim().min(1).max(120),
  phase: z.enum(['PILOT', 'MAIN']),
  questions: z.array(questionSchema).length(5)
}).superRefine((value, ctx) => {
  for (const [index, question] of value.questions.entries()) {
    if (question.options.filter((o) => o.isCorrect).length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: 'Each question must have exactly one correct option.' });
    }
    const optionIds = new Set(question.options.map((o) => o.id));
    if (optionIds.size !== 4) {
      ctx.addIssue({ code: 'custom', path: ['questions', index, 'options'], message: 'Option IDs must be unique within a question.' });
    }
  }
  if (new Set(value.questions.map((q) => q.id)).size !== 5) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Question IDs must be unique.' });
  }
});

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
  questions: z.array(questionSchema).length(5),
  aiSource: z.string().trim().max(120).nullable().optional()
});
