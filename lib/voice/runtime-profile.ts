import type { VoiceInputPolicy } from "@/lib/voice/latency";
import type { VoiceTurnDetection } from "@/lib/voice/profile";

export const VOICE_RUNTIME_PROFILE_IDS = ["baseline", "instant-v1"] as const;

export type VoiceRuntimeProfileId = (typeof VOICE_RUNTIME_PROFILE_IDS)[number];

export type VoiceRuntimeProfile = {
  id: VoiceRuntimeProfileId;
  defaultInputPolicy: VoiceInputPolicy;
  turnDetection: Record<VoiceInputPolicy, VoiceTurnDetection>;
};

const automaticTurnDetection = {
  type: "semantic_vad",
  eagerness: "auto",
  create_response: true,
  interrupt_response: true,
} as const satisfies VoiceTurnDetection;

export const VOICE_RUNTIME_PROFILES: Record<VoiceRuntimeProfileId, VoiceRuntimeProfile> = {
  baseline: {
    id: "baseline",
    defaultInputPolicy: "baseline",
    turnDetection: {
      baseline: automaticTurnDetection,
      fast: automaticTurnDetection,
      patient: automaticTurnDetection,
    },
  },
  "instant-v1": {
    id: "instant-v1",
    defaultInputPolicy: "fast",
    turnDetection: {
      baseline: automaticTurnDetection,
      fast: {
        type: "semantic_vad",
        eagerness: "high",
        create_response: true,
        interrupt_response: true,
      },
      patient: {
        type: "semantic_vad",
        eagerness: "low",
        create_response: true,
        interrupt_response: true,
      },
    },
  },
};

export function resolveVoiceRuntimeProfile(value: string | null | undefined): VoiceRuntimeProfile {
  const normalized = value?.trim().replace(/^['"\\]+|['"\\]+$/g, "");
  return normalized === "instant-v1" ? VOICE_RUNTIME_PROFILES[normalized] : VOICE_RUNTIME_PROFILES.baseline;
}

export function inputPolicyForAssistantText(text: string, profile: VoiceRuntimeProfile): VoiceInputPolicy {
  if (profile.id === "baseline") return profile.defaultInputPolicy;
  return asksVisitorForEmail(text) ? "patient" : profile.defaultInputPolicy;
}

export function asksVisitorForEmail(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/\b(?:e-?mail|email address)\b/i.test(normalized)) return false;
  return [
    /\b(?:what(?:'s| is)|which|share|give|say|tell|type|enter|provide|confirm|repeat|spell|read)\b.{0,80}\b(?:e-?mail|email address)\b/i,
    /\b(?:e-?mail|email address)\b.{0,80}\b(?:please|can you|could you|would you|right\?|correct\?|again\?|address\?)/i,
  ].some((pattern) => pattern.test(normalized));
}
