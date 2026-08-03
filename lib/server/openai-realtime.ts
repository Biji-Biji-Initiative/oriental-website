import OpenAI, { APIError } from "openai";
import type { ClientSecretCreateParams, ClientSecretCreateResponse } from "openai/resources/realtime/client-secrets";
import type { RealtimeSessionCreateRequest } from "openai/resources/realtime/realtime";
import { readEnv } from "@/lib/env";
import type { SegmentId } from "@/lib/segments";
import { resolveVoiceEmailCaptureMode } from "@/lib/voice/email-capture-policy";
import { resolveVoiceExperimentConfig } from "@/lib/voice/experiments";
import { buildVoiceInstructions, VOICE_SESSION_DEFAULTS, voiceToolsForEmailCaptureMode } from "@/lib/voice/profile";
import { resolveVoiceRuntimeProfile } from "@/lib/voice/runtime-profile";
import { resolveVoiceDurationPolicy } from "@/lib/voice/session-policy";
import { getVoiceVariant } from "@/lib/voice/variants";

export type RealtimeDeviceProfile = "mobile" | "desktop";
export type RealtimeDeploymentEnvironment = "production" | "staging" | "local";

export async function createRealtimeClientSecret(
  safetyIdentifier: string,
  initialSegment?: SegmentId,
  deviceProfile: RealtimeDeviceProfile = "desktop",
  variantId?: string,
  deploymentEnvironment: RealtimeDeploymentEnvironment = "production",
) {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("openai_unconfigured");
  }

  const experiments = resolveVoiceExperimentConfig({
    // The public production hostname is authoritative. A stale candidate cell
    // in the managed environment must never select the preview model there.
    modelCell: deploymentEnvironment === "production" ? "control" : readEnv("VOICE_MODEL_CELL", "control"),
    controlModel: readEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2") ?? "gpt-realtime-2",
    candidateModel: readEnv("OPENAI_REALTIME_MODEL_CANDIDATE", "gpt-realtime-2.1") ?? "gpt-realtime-2.1",
    reasoningCell: readEnv("VOICE_REASONING_CELL", "low"),
  });
  const model = experiments.model;
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
  const runtimeProfile = resolveVoiceRuntimeProfile(readEnv("VOICE_RUNTIME_PROFILE", "baseline"));
  const emailCaptureMode = resolveVoiceEmailCaptureMode(readEnv("VOICE_EMAIL_CAPTURE_MODE", "strict"));
  const durationPolicy = resolveVoiceDurationPolicy({
    maxDurationMs: readEnv("VOICE_MAX_DURATION_MS"),
    idleTimeoutMs: readEnv("VOICE_IDLE_TIMEOUT_MS"),
    idleGoodbyeGraceMs: readEnv("VOICE_IDLE_GOODBYE_GRACE_MS"),
  });

  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: process.env.NODE_ENV === "test" });
  const clientSecretRequest = {
    expires_after: { anchor: "created_at", seconds: 300 },
    session: {
      type: "realtime",
      model,
      instructions: buildVoiceInstructions(undefined, initialSegment, variant?.personaNote, emailCaptureMode),
      output_modalities: ["audio"],
      reasoning: { effort: experiments.reasoningEffort },
      truncation: VOICE_SESSION_DEFAULTS.truncation,
      audio: {
        input: {
          turn_detection: runtimeProfile.turnDetection[runtimeProfile.defaultInputPolicy],
          transcription: { ...VOICE_SESSION_DEFAULTS.transcription, model: transcriptionModel },
          noise_reduction: { type: noiseReduction },
        },
        output: { voice, speed },
      },
      tools: voiceToolsForEmailCaptureMode(emailCaptureMode) as unknown as RealtimeSessionCreateRequest["tools"],
      tool_choice: "auto",
      parallel_tool_calls: false,
    },
  } satisfies ClientSecretCreateParams;

  let data: ClientSecretCreateResponse;
  try {
    data = await client.realtime.clientSecrets.create(clientSecretRequest, {
      headers: { "OpenAI-Safety-Identifier": safetyIdentifier },
      maxRetries: 0,
    });
  } catch (error) {
    if (error instanceof APIError && error.status) {
      throw new Error(`openai_${error.status}`);
    }
    throw error;
  }

  const legacyData = data as ClientSecretCreateResponse & {
    client_secret?: { value?: string; expires_at?: number };
  };
  const value = legacyData.client_secret?.value ?? data.value;
  if (!value) {
    throw new Error("openai_invalid_secret");
  }
  return {
    client_secret: {
      value,
      expires_at: legacyData.client_secret?.expires_at ?? data.expires_at ?? 0,
    },
    session_id: data.session?.id ?? crypto.randomUUID(),
    model,
    model_cell: experiments.modelCell,
    reasoning_cell: experiments.reasoningCell,
    voice,
    speed,
    variant: variant?.id ?? null,
    transcription_model: transcriptionModel,
    noise_reduction: noiseReduction,
    runtime_profile: runtimeProfile.id,
    input_policy: runtimeProfile.defaultInputPolicy,
    email_capture_mode: emailCaptureMode,
    // Session policy is server-tunable so the dominant UX constraints can be
    // adjusted from Infisical without a code deploy.
    limits: {
      max_duration_ms: durationPolicy.maxDurationMs,
      idle_timeout_ms: durationPolicy.idleTimeoutMs,
      idle_goodbye_grace_ms: durationPolicy.idleGoodbyeGraceMs,
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
