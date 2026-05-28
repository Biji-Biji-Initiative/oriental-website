import type { NextRequest } from "next/server";
import { voiceSessionRequestSchema } from "@/lib/schemas";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { createRealtimeClientSecret } from "@/lib/server/openai-realtime";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";
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

  const turnstileOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstileOk) {
    logWarn("voice_session.turnstile_failed", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  const limit = await checkRateLimit(`voice:${ipHash}`, 3, 24 * 60 * 60 * 1000);
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
    const secret = await createRealtimeClientSecret(hashIp(ip, "openai-safety"), parsed.data.intent);
    const review = createVoiceReviewCredentials();
    logInfo("voice_session.created", {
      requestId,
      ipHash,
      intent: parsed.data.intent ?? "none",
      model: secret.model,
      voice: secret.voice,
      speed: secret.speed,
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
