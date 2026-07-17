export const VOICE_EMAIL_CAPTURE_MODES = ["strict", "adaptive"] as const;

export type VoiceEmailCaptureMode = (typeof VOICE_EMAIL_CAPTURE_MODES)[number];
export type VoiceEmailCaptureConfidence = "high" | "medium";

/**
 * Strict is the fail-closed rollback value. Adaptive removes the spoken
 * confirmation interview after the same syntax and grounding checks pass;
 * the visible email editor remains the correction surface.
 */
export function resolveVoiceEmailCaptureMode(value: unknown): VoiceEmailCaptureMode {
  return typeof value === "string" && value.trim().toLowerCase() === "adaptive" ? "adaptive" : "strict";
}

export function adaptiveEmailToolInstructions(mode: VoiceEmailCaptureMode) {
  return mode === "adaptive"
    ? [
        "A high-confidence exact speech email returned as confirmed is immediately usable. Briefly acknowledge that it is visible and editable, then continue without asking for a separate yes or spelling it back.",
        "A medium-confidence ASR substitution remains pending. Highlight the visible email editor and let the visitor check or edit it once while the conversation continues; do not read it back or start a spelling loop.",
        "The visible handoff panel is the correction surface. If capture_fields rejects an email once, highlight that field and ask the visitor to type it there; do not start a spoken spelling loop.",
      ]
    : ["After a speech email is captured, read it back and use confirm_email only on the visitor's clear affirmation."];
}
