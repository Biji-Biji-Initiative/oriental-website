import { readEnv } from "@/lib/env";
import { resolveVoiceEmailCaptureMode } from "@/lib/voice/email-capture-policy";
import { resolveVoiceExperimentConfig } from "@/lib/voice/experiments";
import { resolveVoiceRuntimeProfile } from "@/lib/voice/runtime-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  const experiments = resolveVoiceExperimentConfig({
    modelCell: readEnv("VOICE_MODEL_CELL", "control"),
    controlModel: readEnv("OPENAI_REALTIME_MODEL", "gpt-realtime-2") ?? "gpt-realtime-2",
    candidateModel: readEnv("OPENAI_REALTIME_MODEL_CANDIDATE", "gpt-realtime-2.1") ?? "gpt-realtime-2.1",
    reasoningCell: readEnv("VOICE_REASONING_CELL", "low"),
  });
  const runtimeProfile = resolveVoiceRuntimeProfile(readEnv("VOICE_RUNTIME_PROFILE", "baseline"));

  return Response.json(
    {
      ok: true,
      version: readEnv("GIT_SHA") ?? readEnv("SOURCE_COMMIT") ?? "local",
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      convex: Boolean(readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL")),
      voice: {
        runtime_profile: runtimeProfile.id,
        model_cell: experiments.modelCell,
        model: experiments.model,
        reasoning_cell: experiments.reasoningCell,
        email_capture_mode: resolveVoiceEmailCaptureMode(readEnv("VOICE_EMAIL_CAPTURE_MODE", "strict")),
        variant_picker: readEnv("VOICE_VARIANT_PICKER", "false") === "true",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
