import { describe, expect, it } from 'vitest';
import { isValidSampleSize, proposeQuotaPerArm } from '@/lib/study-run/quota';
import { sampleSizeSchema } from '@/lib/validation/study-run-schemas';

// AC-01 (pure part): only even integers >= 2; the system proposes N/2.
describe('Study Run sample size and quota proposal (AC-01)', () => {
  it('accepts even integers >= 2, including the initial 30', () => {
    for (const n of [2, 4, 30, 100, 100000]) expect(sampleSizeSchema.safeParse(n).success).toBe(true);
  });
  it('rejects odd, zero, negative, fractional, non-finite and non-number values', () => {
    for (const n of [1, 3, 29, 0, -2, -3, 2.5, 30.0000001, NaN, Infinity, 100002, '30', null, undefined]) {
      expect(sampleSizeSchema.safeParse(n).success).toBe(false);
    }
    for (const n of [1, 0, -2, 2.5, NaN]) expect(isValidSampleSize(n)).toBe(false);
  });
  it('proposes N/2 per arm and refuses an invalid sample size', () => {
    expect(proposeQuotaPerArm(30)).toBe(15);
    expect(proposeQuotaPerArm(2)).toBe(1);
    expect(() => proposeQuotaPerArm(31)).toThrow('INVALID_SAMPLE_SIZE');
  });
});
