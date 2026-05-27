import type { NextRequest } from "next/server";
import { voiceSessionRequestSchema } from "@/lib/schemas";
import { createRealtimeClientSecret } from "@/lib/server/openai-realtime";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const raw = await request.json().catch(() => null);
  const parsed = voiceSessionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstileOk) {
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  const limit = checkRateLimit(`voice:${hashIp(ip)}`, 3, 24 * 60 * 60 * 1000);
  if (!limit.ok) {
    return noStoreJson({ ok: false, error: "voice_limit_reached" }, { status: 429 });
  }

  try {
    const secret = await createRealtimeClientSecret(hashIp(ip, "openai-safety"), parsed.data.intent);
    return noStoreJson({ ok: true, ...secret });
  } catch (error) {
    const message = error instanceof Error ? error.message : "openai_unavailable";
    return noStoreJson({ ok: false, error: message }, { status: message === "openai_unconfigured" ? 503 : 502 });
  }
}
