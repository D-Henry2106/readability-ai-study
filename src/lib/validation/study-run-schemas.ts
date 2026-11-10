import { z } from 'zod';
import { isValidSampleSize } from '@/lib/study-run/quota';

/** Fixed wording the Admin confirms (architecture §3.4). Stored review = proof this exact statement was confirmed. */
export const INFO_CONSENT_REVIEW_STATEMENT =
  'Tôi đã rà soát Information, Consent và Debrief hiện hành và xác nhận chúng phù hợp với luồng nghiên cứu một lượt (between-subjects).';

export const sampleSizeSchema = z
  .number()
  .refine(isValidSampleSize, { message: 'Sample size phải là số nguyên chẵn, tối thiểu 2.' })
  .refine((n) => n <= 100000, { message: 'Sample size quá lớn.' });

const expectedVersionSchema = z.number().int().min(1);

export const studyRunCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/),
  name: z.string().trim().min(1).max(150),
  phase: z.enum(['PILOT', 'MAIN']),
  packageId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  targetSampleSize: sampleSizeSchema
});

export const studyRunSampleSizeSchema = z.object({ expectedVersion: expectedVersionSchema, targetSampleSize: sampleSizeSchema });

/** The Admin states the quota being confirmed; it must equal the proposed N/2 split. */
export const studyRunQuotaConfirmSchema = z.object({ expectedVersion: expectedVersionSchema, quotaPerArm: z.number().int().min(1) });

/** No default: the Admin must choose explicitly. */
export const studyRunEntryPolicySchema = z.object({
  expectedVersion: expectedVersionSchema,
  legacyEntry: z.enum(['UNCHANGED', 'BLOCKED_WHILE_OPEN'])
});

export const studyRunInfoConsentSchema = z.object({
  expectedVersion: expectedVersionSchema,
  statement: z.literal(INFO_CONSENT_REVIEW_STATEMENT)
});

export const studyRunTransitionSchema = z.object({
  expectedVersion: expectedVersionSchema,
  to: z.enum(['OPEN', 'PAUSED', 'CLOSED']),
  reason: z.string().trim().max(500).nullable().optional()
});
