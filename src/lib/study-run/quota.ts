import type { Presentation } from '@/types/research';
import type { StudyRunArmCounters, StudyRunDoc } from '@/types/study-run';

/** Sample size: an even integer >= 2 (architecture AC-01). */
export function isValidSampleSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value % 2 === 0;
}

/** The system only PROPOSES an equal split; nothing is stored until an Admin confirms it. */
export function proposeQuotaPerArm(targetSampleSize: number): number {
  if (!isValidSampleSize(targetSampleSize)) throw new Error('INVALID_SAMPLE_SIZE');
  return targetSampleSize / 2;
}

export type QuotaWarningCode =
  | 'ARM_V1_QUOTA_REACHED'
  | 'ARM_V2_QUOTA_REACHED'
  | 'BOTH_ARMS_QUOTA_REACHED'
  | 'ARM_V1_HAS_SUPPLEMENTAL'
  | 'ARM_V2_HAS_SUPPLEMENTAL'
  | 'ARM_V1_QUOTA_VACANCY'
  | 'ARM_V2_QUOTA_VACANCY'
  | 'QUOTA_COUNTER_MISMATCH';

export interface QuotaArmSnapshot {
  V1: StudyRunArmCounters;
  V2: StudyRunArmCounters;
}

/** Counter transitions that give a session's slot back; once one exists for a session, nobody else may release it again. */
export const SETTLING_RELEASE_TRANSITIONS = ['RELEASE_INCLUDED', 'RELEASE_SUPPLEMENTAL'] as const;

/**
 * True when some OTHER counter transition already released this session's slot after the compensated transition
 * was claimed (`claimedAt` is the per-session monotonic claim time, so server clock skew cannot reorder it).
 * Used by compensations (rollbacks) so a slow request never releases a slot a faster request already released.
 */
export function hasSettlingRelease(
  ledger: StudyRunDoc['quotaLedger'],
  sessionId: string,
  compensatedClaimedAt: Date
): boolean {
  return Object.values(ledger ?? {}).some(
    (entry) =>
      entry.sessionId === sessionId &&
      (SETTLING_RELEASE_TRANSITIONS as readonly string[]).includes(entry.transition) &&
      entry.claimedAt !== undefined &&
      entry.claimedAt.getTime() >= compensatedClaimedAt.getTime()
  );
}

export function armCountersEqual(a: QuotaArmSnapshot, b: QuotaArmSnapshot): boolean {
  return (
    a.V1.validIncluded === b.V1.validIncluded &&
    a.V1.supplementalValid === b.V1.supplementalValid &&
    a.V2.validIncluded === b.V2.validIncluded &&
    a.V2.supplementalValid === b.V2.supplementalValid
  );
}

/**
 * Pure warning evaluator for Study Run quota state (architecture §2.3, §6.4, AC-18, AC-31).
 * Warnings are strictly informational; the system never closes a run or auto-promotes supplemental sessions.
 */
export function evaluateQuotaWarnings(
  run: Pick<StudyRunDoc, 'targetSampleSize' | 'quotaPerArm' | 'arms'>,
  options: { vacancyOnArm?: Presentation | null; counterMismatch?: boolean } = {}
): QuotaWarningCode[] {
  const warnings: QuotaWarningCode[] = [];
  const targetPerArm = run.quotaPerArm ?? proposeQuotaPerArm(run.targetSampleSize);
  const v1Reached = run.quotaPerArm !== null && run.arms.V1.validIncluded >= run.quotaPerArm;
  const v2Reached = run.quotaPerArm !== null && run.arms.V2.validIncluded >= run.quotaPerArm;

  if (v1Reached) warnings.push('ARM_V1_QUOTA_REACHED');
  if (v2Reached) warnings.push('ARM_V2_QUOTA_REACHED');
  if (v1Reached && v2Reached) warnings.push('BOTH_ARMS_QUOTA_REACHED');

  if (run.arms.V1.supplementalValid > 0) warnings.push('ARM_V1_HAS_SUPPLEMENTAL');
  if (run.arms.V2.supplementalValid > 0) warnings.push('ARM_V2_HAS_SUPPLEMENTAL');

  const v1HasVacancy =
    options.vacancyOnArm === 'V1' ||
    (run.arms.V1.validIncluded < targetPerArm &&
      (run.arms.V1.supplementalValid > 0 || (run.quotaPerArm === null && run.arms.V1.validIncluded > 0)));
  const v2HasVacancy =
    options.vacancyOnArm === 'V2' ||
    (run.arms.V2.validIncluded < targetPerArm &&
      (run.arms.V2.supplementalValid > 0 || (run.quotaPerArm === null && run.arms.V2.validIncluded > 0)));

  if (v1HasVacancy) warnings.push('ARM_V1_QUOTA_VACANCY');
  if (v2HasVacancy) warnings.push('ARM_V2_QUOTA_VACANCY');
  if (options.counterMismatch) warnings.push('QUOTA_COUNTER_MISMATCH');

  return warnings;
}
