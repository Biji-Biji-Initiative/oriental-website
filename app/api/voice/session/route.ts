import type { NextRequest } from "next/server";
import { readPositiveIntEnv } from "@/lib/env";
import { voiceSessionRequestSchema } from "@/lib/schemas";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { createRealtimeClientSecret, type RealtimeDeviceProfile } from "@/lib/server/openai-realtime";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { checkRateLimit, hashIp, noStoreJson, requestIp } from "@/lib/server/security";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const ip = requestIp(request);
  const ipHash = hashIp(ip, "voice-session");
  const raw = await request.json().catch(() => null);
  const parsed = voiceSessionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    logWarn("voice_session.invalid_payload", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  // Page-load prewarming mints a short-lived session before a real call starts,
  // so the budget covers browsing behaviour, not only connected calls.
  const dailyLimit = readPositiveIntEnv("VOICE_SESSION_DAILY_LIMIT", 80);
  const limit = await checkRateLimit(`voice:${ipHash}`, dailyLimit, 24 * 60 * 60 * 1000);
  if (!limit.ok) {
    logWarn("voice_session.rate_limited", {
      requestId,
      ipHash,
      rateLimitStore: limit.store,
      resetAt: new Date(limit.resetAt).toISOString(),
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "voice_limit_reached" }, { status: 429 });
  }

  try {
    const deviceProfile = detectDeviceProfile(request.headers.get("user-agent"));
    const secret = await createRealtimeClientSecret(
      hashIp(ip, "openai-safety"),
      parsed.data.intent,
      deviceProfile,
      parsed.data.variant,
    );
    const review = createVoiceReviewCredentials();
    logInfo("voice_session.created", {
      requestId,
      ipHash,
      intent: parsed.data.intent ?? "none",
      model: secret.model,
      voice: secret.voice,
      speed: secret.speed,
      variant: secret.variant ?? "default",
      runtimeProfile: secret.runtime_profile,
      inputPolicy: secret.input_policy,
      transcriptionModel: secret.transcription_model,
      noiseReduction: secret.noise_reduction,
      deviceProfile,
      reviewId: review.id,
      rateLimitStore: limit.store,
      remaining: limit.remaining,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: true, ...secret, review });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openai_unavailable";
    logError("voice_session.openai_failed", {
      requestId,
      ipHash,
      error: errorMeta(error),
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "voice_session.openai_failed",
      severity: message === "openai_unconfigured" ? "critical" : "error",
      summary: "Realtime client secret minting failed.",
      meta: { requestId, ipHash, message, durationMs: durationSince(startedAt) },
      fingerprint: message,
    });
    return noStoreJson({ ok: false, error: message }, { status: message === "openai_unconfigured" ? 503 : 502 });
  }
}

function detectDeviceProfile(userAgent: string | null): RealtimeDeviceProfile {
  return userAgent && /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop";
}
