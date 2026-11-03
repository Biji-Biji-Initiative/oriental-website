export const VOICE_EMAIL_CAPTURE_MODES = ["strict", "adaptive"] as const;

export type VoiceEmailCaptureMode = (typeof VOICE_EMAIL_CAPTURE_MODES)[number];
export type VoiceEmailCaptureConfidence = "high" | "medium";

/**
 * Strict is the fail-closed rollback value. Adaptive removes the spoken
 * confirmation interview after the same syntax and grounding checks pass.
 * The visible editor remains an optional fallback, never a voice-to-form gate.
 */
export function resolveVoiceEmailCaptureMode(value: unknown): VoiceEmailCaptureMode {
  return typeof value === "string" && value.trim().toLowerCase() === "adaptive" ? "adaptive" : "strict";
}

export function adaptiveEmailToolInstructions(mode: VoiceEmailCaptureMode) {
  return mode === "adaptive"
    ? [
        "A high-confidence exact speech email returned as confirmed is immediately usable. Briefly acknowledge that it is visible and editable, then continue without asking for a separate yes or spelling it back.",
        "A medium-confidence ASR substitution remains pending. Ask one natural spoken clarification for the full address, including its domain, while the conversation continues; do not read it back or require typing.",
        "If capture_fields rejects an email, keep listening and ask once for the full address naturally, including the domain. The visible handoff panel is optional fallback only; never direct the visitor to type.",
      ]
    : ["After a speech email is captured, read it back and use confirm_email only on the visitor's clear affirmation."];
}
