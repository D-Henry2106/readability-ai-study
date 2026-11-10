/** Sample size: an even integer >= 2 (architecture AC-01). */
export function isValidSampleSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value % 2 === 0;
}

/** The system only PROPOSES an equal split; nothing is stored until an Admin confirms it. */
export function proposeQuotaPerArm(targetSampleSize: number): number {
  if (!isValidSampleSize(targetSampleSize)) throw new Error('INVALID_SAMPLE_SIZE');
  return targetSampleSize / 2;
}
