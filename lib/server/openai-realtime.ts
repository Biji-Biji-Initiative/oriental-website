import { readEnv, readPositiveIntEnv } from "@/lib/env";
import type { SegmentId } from "@/lib/segments";
import { buildVoiceInstructions, VOICE_SESSION_DEFAULTS, VOICE_TOOLS } from "@/lib/voice/profile";
import { getVoiceVariant } from "@/lib/voice/variants";

export type RealtimeDeviceProfile = "mobile" | "desktop";

export async function createRealtimeClientSecret(
  safetyIdentifier: string,
  initialSegment?: SegmentId,
  deviceProfile: RealtimeDeviceProfile = "desktop",
  variantId?: string,
) {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("openai_unconfigured");
  }

  const model = readEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2") ?? "gpt-realtime-2";
  // A selected variant overrides voice/speed/persona; otherwise fall back to the
  // env-configured production defaults. Voice and persona are never taken from
  // the client directly — only a server-resolved variant from the catalog.
  const variant = getVoiceVariant(variantId);
  const voice = variant?.voice ?? readEnv("OPENAI_REALTIME_VOICE", "marin") ?? "marin";
  const speed = variant ? clampRealtimeSpeed(variant.speed) : readRealtimeSpeed();
  const transcriptionModel =
    readEnv("OPENAI_REALTIME_TRANSCRIPTION_MODEL", VOICE_SESSION_DEFAULTS.transcription.model) ??
    VOICE_SESSION_DEFAULTS.transcription.model;
  // Phones are close-talking mics; laptops and desktops are far-field.
  const noiseReduction = deviceProfile === "mobile" ? "near_field" : "far_field";

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 300 },
      session: {
        type: "realtime",
        model,
        instructions: buildVoiceInstructions(undefined, initialSegment, variant?.personaNote),
        output_modalities: ["audio"],
        reasoning: { effort: VOICE_SESSION_DEFAULTS.reasoningEffort },
        truncation: VOICE_SESSION_DEFAULTS.truncation,
        audio: {
          input: {
            turn_detection: VOICE_SESSION_DEFAULTS.turnDetection,
            transcription: { ...VOICE_SESSION_DEFAULTS.transcription, model: transcriptionModel },
            noise_reduction: { type: noiseReduction },
          },
          output: { voice, speed },
        },
        tools: VOICE_TOOLS,
        tool_choice: "auto",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`openai_${response.status}`);
  }

  const data = (await response.json()) as {
    value?: string;
    expires_at?: number;
    session?: { id?: string };
    client_secret?: { value?: string; expires_at?: number };
    id?: string;
  };
  const value = data.client_secret?.value ?? data.value;
  if (!value) {
    throw new Error("openai_invalid_secret");
  }
  return {
    client_secret: {
      value,
      expires_at: data.client_secret?.expires_at ?? data.expires_at ?? 0,
    },
    session_id: data.session?.id ?? data.id ?? crypto.randomUUID(),
    model,
    voice,
    speed,
    variant: variant?.id ?? null,
    transcription_model: transcriptionModel,
    noise_reduction: noiseReduction,
    // Session policy is server-tunable so the dominant UX constraints can be
    // adjusted from Infisical without a code deploy.
    limits: {
      max_duration_ms: readPositiveIntEnv("VOICE_MAX_DURATION_MS", VOICE_SESSION_DEFAULTS.maxDurationMs),
      idle_timeout_ms: readPositiveIntEnv("VOICE_IDLE_TIMEOUT_MS", VOICE_SESSION_DEFAULTS.idleTimeoutMs),
    },
  };
}

function clampRealtimeSpeed(speed: number) {
  if (!Number.isFinite(speed)) return 1.18;
  return Math.min(1.5, Math.max(0.25, speed));
}

function readRealtimeSpeed() {
  const raw = readEnv("OPENAI_REALTIME_SPEED", "1.18") ?? "1.18";
  return clampRealtimeSpeed(Number(raw));
}
