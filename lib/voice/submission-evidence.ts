export const VOICE_SUBMISSION_EVIDENCE_UTM_KEY = "_mereka_voice_submission_v1";

export type VoiceSubmissionEvidenceOutcome = "none" | "matched" | "mismatched" | "ambiguous";
export type VoiceSubmissionEvidenceSource = "prefill" | "speech" | "typed";
export type VoiceSubmissionEvidenceProvenance = "v1" | "legacy-lead-snapshot";

export type VerifiedVoiceSubmissionEvidence = {
  acceptedAt: number;
  authorityTurnSequence: number;
  outcome: VoiceSubmissionEvidenceOutcome;
  provenance: VoiceSubmissionEvidenceProvenance;
  source?: VoiceSubmissionEvidenceSource;
};

export function isInternalLeadUtmKey(key: string) {
  return key === VOICE_SUBMISSION_EVIDENCE_UTM_KEY;
}

export function publicLeadUtm(utm: Record<string, string> | null | undefined) {
  return Object.fromEntries(Object.entries(utm ?? {}).filter(([key]) => !isInternalLeadUtmKey(key)));
}
