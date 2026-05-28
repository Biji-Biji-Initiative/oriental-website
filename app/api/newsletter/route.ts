import type { NextRequest } from "next/server";
import { newsletterRequestSchema } from "@/lib/schemas";
import { persistLead } from "@/lib/server/convex";
import { durationSince, logInfo, logWarn } from "@/lib/server/logger";
import { routeLead } from "@/lib/server/notifications";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const ip = requestIp(request);
  const ipHash = hashIp(ip, "newsletter");
  const limit = await checkRateLimit(`newsletter:${ipHash}`, 20, 60 * 60 * 1000);
  if (!limit.ok) {
    logWarn("newsletter.rate_limited", {
      requestId,
      ipHash,
      rateLimitStore: limit.store,
      resetAt: new Date(limit.resetAt).toISOString(),
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = newsletterRequestSchema.safeParse(raw);
  if (!parsed.success) {
    logWarn("newsletter.invalid_payload", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstileOk) {
    logWarn("newsletter.turnstile_failed", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  const lead = routeLead({
    source: "hero-email",
    segment: "other",
    form: {
      name: "Newsletter subscriber",
      email: parsed.data.email,
      org: "Unknown",
      message: "Requested Oriental Building updates from the hero email capture.",
    },
    transcript: [],
    turnstileToken: parsed.data.turnstileToken,
    utm: parsed.data.utm,
  });

  const persistence = await persistLead(lead);
  logInfo("newsletter.accepted", {
    requestId,
    leadId: lead.id,
    persisted: persistence.persisted,
    rateLimitStore: limit.store,
    remaining: limit.remaining,
    durationMs: durationSince(startedAt),
  });
  return noStoreJson({ ok: true, id: persistence.id, persisted: persistence.persisted });
}
