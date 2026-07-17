export const VOICE_EMAIL_CAPTURE_MODES = ["strict", "adaptive"] as const;

export type VoiceEmailCaptureMode = (typeof VOICE_EMAIL_CAPTURE_MODES)[number];
export type VoiceEmailCaptureConfidence = "high" | "medium";

/**
 * Strict is the fail-closed rollback value. Adaptive removes the blanket
 * confirmation turn only after the same syntax and grounding checks pass.
 */
export function resolveVoiceEmailCaptureMode(value: unknown): VoiceEmailCaptureMode {
  return typeof value === "string" && value.trim().toLowerCase() === "adaptive" ? "adaptive" : "strict";
}

export function adaptiveEmailToolInstructions(mode: VoiceEmailCaptureMode) {
  return mode === "adaptive"
    ? [
        "A high-confidence exact speech email returned as confirmed is immediately usable. Briefly acknowledge it and continue without asking for a separate yes.",
        "A medium-confidence ASR substitution remains pending. Read the returned emailReadback exactly once and use confirm_email only after the visitor clearly affirms it.",
        "The visible handoff panel is the correction surface. If capture_fields rejects an email once, highlight that field and ask the visitor to type it there; do not start a spoken spelling loop.",
      ]
    : ["After a speech email is captured, read it back and use confirm_email only on the visitor's clear affirmation."];
}
