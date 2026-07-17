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
        "A grounded speech email returned as confirmed is immediately usable. Briefly acknowledge it and continue without asking for a separate yes.",
        "The visible handoff panel is the correction surface. Ask a targeted spelling question only when capture_fields rejects the email as invalid or ungrounded.",
      ]
    : ["After a speech email is captured, read it back and use confirm_email only on the visitor's clear affirmation."];
}
