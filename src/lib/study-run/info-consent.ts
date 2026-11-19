import { createHash } from 'node:crypto';
import type { ExperimentConfigDoc } from '@/types/research';
import type { StudyRunInfoConsentReview } from '@/types/study-run';

/** SHA-256 of the exact stored text (no normalisation: any edit to a consent document must be detectable). */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type InfoConsentTexts = Pick<
  StudyRunInfoConsentReview,
  'informationVersion' | 'consentVersion' | 'debriefVersion' | 'informationSha256' | 'consentSha256' | 'debriefSha256'
>;

/** Versions + hashes of the CURRENT Information/Consent/Debrief, or the names of whatever is missing. */
export function currentInfoConsent(
  config: Pick<
    ExperimentConfigDoc,
    'informationText' | 'informationVersion' | 'consentText' | 'consentVersion' | 'debriefText' | 'debriefVersion'
  >
): { ok: true; value: InfoConsentTexts } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!config.informationText || !config.informationVersion) missing.push('PARTICIPANT_INFORMATION_SHEET');
  if (!config.consentText || !config.consentVersion) missing.push('CONSENT_WORDING');
  if (!config.debriefText || !config.debriefVersion) missing.push('DEBRIEF_WORDING');
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    value: {
      informationVersion: config.informationVersion!,
      consentVersion: config.consentVersion!,
      debriefVersion: config.debriefVersion!,
      informationSha256: sha256Hex(config.informationText!),
      consentSha256: sha256Hex(config.consentText!),
      debriefSha256: sha256Hex(config.debriefText!)
    }
  };
}

export type InfoConsentState = 'NOT_REVIEWED' | 'CURRENT' | 'CHANGED';

/** NOT_REVIEWED: no confirmation yet. CHANGED: configuration differs from the confirmed snapshot (warning only). */
export function infoConsentState(
  review: StudyRunInfoConsentReview | null,
  config: Parameters<typeof currentInfoConsent>[0]
): InfoConsentState {
  if (!review) return 'NOT_REVIEWED';
  const current = currentInfoConsent(config);
  if (!current.ok) return 'CHANGED';
  const v = current.value;
  const same =
    v.informationVersion === review.informationVersion && v.consentVersion === review.consentVersion &&
    v.debriefVersion === review.debriefVersion && v.informationSha256 === review.informationSha256 &&
    v.consentSha256 === review.consentSha256 && v.debriefSha256 === review.debriefSha256;
  return same ? 'CURRENT' : 'CHANGED';
}
