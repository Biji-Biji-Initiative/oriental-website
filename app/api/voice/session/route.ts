import type { NextRequest } from "next/server";
import { readEnv, readPositiveIntEnv } from "@/lib/env";
import { voiceSessionRequestSchema } from "@/lib/schemas";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { createRealtimeClientSecret, type RealtimeDeviceProfile } from "@/lib/server/openai-realtime";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { checkRateLimit, hashIp, noStoreJson, rateLimitResponseHeaders, requestIp } from "@/lib/server/security";
import { type ServerTimingMetrics, serializeServerTiming } from "@/lib/server/server-timing";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const timingStartedAt = performance.now();
  const timings: ServerTimingMetrics = {};
  const requestId = crypto.randomUUID();
  const ip = requestIp(request);
  const ipHash = hashIp(ip, "voice-session");
  const parseStartedAt = performance.now();
  const raw = await request.json().catch(() => null);
  const parsed = voiceSessionRequestSchema.safeParse(raw);
  timings.parse = performance.now() - parseStartedAt;
  if (!parsed.success) {
    logWarn("voice_session.invalid_payload", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return timedJson(
      { ok: false, error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
      timings,
      timingStartedAt,
    );
  }

  // Page-load prewarming mints a short-lived session before a real call starts,
  // so the budget covers browsing behaviour, not only connected calls.
  const dailyLimit = readPositiveIntEnv("VOICE_SESSION_DAILY_LIMIT", 80);
  const rateLimitStartedAt = performance.now();
  const limit = await checkRateLimit(`voice:${ipHash}`, dailyLimit, 24 * 60 * 60 * 1000);
  timings.rate_limit = performance.now() - rateLimitStartedAt;
  if (!limit.ok) {
    logWarn("voice_session.rate_limited", {
      requestId,
      ipHash,
      rateLimitStore: limit.store,
      resetAt: new Date(limit.resetAt).toISOString(),
      durationMs: durationSince(startedAt),
    });
    return timedJson(
      { ok: false, error: "voice_limit_reached" },
      { status: 429, headers: rateLimitResponseHeaders(limit.resetAt) },
      timings,
      timingStartedAt,
    );
  }

  let mintStartedAt: number | undefined;
  try {
    const deviceProfile = detectDeviceProfile(request.headers.get("user-agent"));
    const deploymentEnvironment = detectDeploymentEnvironment(request.url);
    mintStartedAt = performance.now();
    const secret = await createRealtimeClientSecret(
      hashIp(ip, "openai-safety"),
      parsed.data.intent,
      deviceProfile,
      parsed.data.variant,
    );
    timings.openai_mint = performance.now() - mintStartedAt;
    const review = createVoiceReviewCredentials();
    logInfo("voice_session.created", {
      requestId,
      ipHash,
      intent: parsed.data.intent ?? "none",
      model: secret.model,
      modelCell: secret.model_cell,
      reasoningCell: secret.reasoning_cell,
      voice: secret.voice,
      speed: secret.speed,
      variant: secret.variant ?? "default",
      runtimeProfile: secret.runtime_profile,
      inputPolicy: secret.input_policy,
      emailCaptureMode: secret.email_capture_mode,
      transcriptionModel: secret.transcription_model,
      noiseReduction: secret.noise_reduction,
      deviceProfile,
      deploymentEnvironment,
      reviewId: review.id,
      rateLimitStore: limit.store,
      remaining: limit.remaining,
      durationMs: durationSince(startedAt),
    });
    return timedJson(
      { ok: true, ...secret, review, device_profile: deviceProfile, deployment_environment: deploymentEnvironment },
      {},
      timings,
      timingStartedAt,
    );
  } catch (error) {
    if (mintStartedAt !== undefined) timings.openai_mint = performance.now() - mintStartedAt;
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
    return timedJson(
      { ok: false, error: message },
      { status: message === "openai_unconfigured" ? 503 : 502 },
      timings,
      timingStartedAt,
    );
  }
}

function detectDeviceProfile(userAgent: string | null): RealtimeDeviceProfile {
  return userAgent && /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop";
}

function detectDeploymentEnvironment(requestUrl: string) {
  const configured = readEnv("APP_ENV") ?? readEnv("SENTRY_ENVIRONMENT");
  if (configured === "staging") return "staging" as const;
  if (configured === "production") return "production" as const;
  const hostname = new URL(requestUrl).hostname.toLowerCase();
  if (hostname === "staging.oriental.mereka.io") return "staging" as const;
  if (hostname === "oriental.mereka.io") return "production" as const;
  return "local" as const;
}

function timedJson(data: unknown, init: ResponseInit, timings: ServerTimingMetrics, timingStartedAt: number) {
  const headers = new Headers(init.headers);
  headers.set("Server-Timing", serializeServerTiming({ ...timings, total: performance.now() - timingStartedAt }));
  return noStoreJson(data, { ...init, headers });
}
