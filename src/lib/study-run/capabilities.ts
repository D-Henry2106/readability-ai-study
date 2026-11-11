/**
 * Capability gate (architecture §3.5). A real Study Run may only be OPENed once every capability that makes
 * its participant flow complete exists. Each later patch flips only the capability it delivers:
 * P2 invitationRedemption, P3 presentationProfile, P4 singleRoundFlow + quotaRecording.
 * P2 delivers invitationRedemption; the other three stay false until P3/P4, so DRAFT -> OPEN (and CLOSED -> OPEN)
 * is still refused in production. Tests inject `true`.
 */
export interface StudyRunCapabilities {
  readonly invitationRedemption: boolean;
  readonly presentationProfile: boolean;
  readonly singleRoundFlow: boolean;
  readonly quotaRecording: boolean;
}

export const STUDY_RUN_CAPABILITIES: StudyRunCapabilities = Object.freeze({
  invitationRedemption: true,
  presentationProfile: false,
  singleRoundFlow: false,
  quotaRecording: false
});

export function missingCapabilities(capabilities: StudyRunCapabilities): string[] {
  return (Object.keys(STUDY_RUN_CAPABILITIES) as Array<keyof StudyRunCapabilities>).filter((key) => !capabilities[key]);
}
