import { z } from 'zod';

export const MAX_EMPHASIS_SPANS = 500;

export const emphasisSpanSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    text: z.string().min(1)
  })
  .refine((span) => span.end > span.start, { message: 'Offset kết thúc phải lớn hơn offset bắt đầu.' });

export const sentencesPerBlockSchema = z.number().int().min(1).max(10);

export const presentationProfileCreateSchema = z.object({
  contentRevisionId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  emphasis: z.array(emphasisSpanSchema).max(MAX_EMPHASIS_SPANS).optional(),
  sentencesPerBlock: sentencesPerBlockSchema.optional()
});

export const presentationProfileUpdateSchema = z.object({
  emphasis: z.array(emphasisSpanSchema).max(MAX_EMPHASIS_SPANS),
  sentencesPerBlock: sentencesPerBlockSchema.optional()
});

export const presentationProfileConfirmSchema = z
  .object({
    confirm: z.literal(true).optional(),
    /** The `editRevision` the Admin saw in Preview; when present, confirmation is refused if the profile has changed since. */
    expectedRevision: z.number().int().min(1).optional()
  })
  .optional();
