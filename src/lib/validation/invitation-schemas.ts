import { z } from 'zod';
import { deviceTypeSchema } from './schemas';

export const MAX_RECOVERY_HOURS = 72;
export const MAX_INVITATIONS_PER_BATCH = 200;

/** Administrative note: short, and must not carry personal data (no e-mail addresses, no phone-like digit runs). */
export const invitationLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !/@/.test(v) && !/\d{8,}/.test(v.replace(/[\s.\-()]/g, '')), { message: 'Ghi chú không được chứa thông tin cá nhân.' });

export const invitationCreateSchema = z.object({
  studyRunId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  variant: z.enum(['V1', 'V2']),
  count: z.number().int().min(1).max(MAX_INVITATIONS_PER_BATCH),
  label: invitationLabelSchema.nullable().optional()
});

export const invitationRevokeSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const invitationReplaceSchema = z.object({ label: invitationLabelSchema.nullable().optional() });

/** `confirm: true` is the explicit confirmation step of E1 (the P5 UI shows the run, variant and invitation id first). */
export const recoveryAuthorizeSchema = z.object({
  confirm: z.literal(true),
  reason: z.string().trim().min(1).max(500),
  validForHours: z.number().int().min(1).max(MAX_RECOVERY_HOURS)
});

/** Body of POST /api/invitations/redeem. The token is validated by shape only; it is never echoed back or logged. */
export const redeemBodySchema = z.object({ token: z.string().min(1).max(200), deviceType: deviceTypeSchema });
