import type { NextRequest } from "next/server";
import { isProductionEnv } from "@/lib/env";
import { newsletterRequestSchema } from "@/lib/schemas";
import { persistLead, recordLeadNotificationStatus } from "@/lib/server/convex";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { settledNotificationResult } from "@/lib/server/notification-results";
import { notifyNewsletterSubscriber, routeLead } from "@/lib/server/notifications";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import {
  checkRateLimit,
  hashIp,
  noStoreJson,
  rateLimitResponseHeaders,
  requestIp,
  verifyTurnstile,
} from "@/lib/server/security";

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
    return noStoreJson(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rateLimitResponseHeaders(limit.resetAt) },
    );
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
      phone: "",
      website: "",
      message: "Requested Oriental Building updates from the hero email capture.",
    },
    transcript: [],
    turnstileToken: parsed.data.turnstileToken,
    utm: parsed.data.utm,
  });

  const persistence = await persistLead(lead).catch((error) => ({
    id: lead.id,
    persisted: false as const,
    reason: error instanceof Error ? error.message : "convex_failed",
  }));
  if (!persistence.persisted && isProductionEnv()) {
    const reason = persistence.reason;
    logError("newsletter.persistence_failed", {
      requestId,
      leadId: lead.id,
      reason,
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "newsletter.persistence_failed",
      severity: "critical",
      summary: "A production hero email signup failed to persist to Convex.",
      meta: { requestId, leadId: lead.id, reason },
      fingerprint: reason,
    });
    return noStoreJson({ ok: false, error: "persistence_failed" }, { status: 502 });
  }

  const [confirmation] = await Promise.allSettled([notifyNewsletterSubscriber(parsed.data.email)]);
  const notifications = {
    confirmation: settledNotificationResult(confirmation, "confirmation_failed", "newsletter.notification_rejected"),
  };
  if (persistence.persisted) {
    await recordLeadNotificationStatus(persistence.id, notifications, notifications.confirmation.ok === true).catch(
      (error) => {
        logWarn("newsletter.notification_status_persist_failed", {
          requestId,
          leadId: persistence.id,
          error: errorMeta(error),
          durationMs: durationSince(startedAt),
        });
      },
    );
  }

  logInfo("newsletter.accepted", {
    requestId,
    leadId: lead.id,
    persisted: persistence.persisted,
    notifications,
    rateLimitStore: limit.store,
    remaining: limit.remaining,
    durationMs: durationSince(startedAt),
  });
  return noStoreJson({ ok: true, id: persistence.id, persisted: persistence.persisted, notifications });
}
