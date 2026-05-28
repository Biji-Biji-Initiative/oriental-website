import type { NextRequest } from "next/server";
import { isProductionEnv } from "@/lib/env";
import { leadRequestSchema } from "@/lib/schemas";
import { persistLead, recordLeadNotificationStatus } from "@/lib/server/convex";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { type NotificationResult, notifyOwner, notifySlack, routeLead } from "@/lib/server/notifications";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const ip = requestIp(request);
  const ipHash = hashIp(ip, "lead-submit");
  const limit = await checkRateLimit(`lead:${ipHash}`, 12, 60 * 60 * 1000);
  if (!limit.ok) {
    logWarn("lead.rate_limited", {
      requestId,
      ipHash,
      rateLimitStore: limit.store,
      resetAt: new Date(limit.resetAt).toISOString(),
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = leadRequestSchema.safeParse(raw);
  if (!parsed.success) {
    logWarn("lead.invalid_payload", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const turnstileOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstileOk) {
    logWarn("lead.turnstile_failed", {
      requestId,
      ipHash,
      source: parsed.data.source,
      segment: parsed.data.segment,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  const lead = routeLead(parsed.data);
  if (!lead.routedToEmail && isProductionEnv()) {
    logError("lead.routing_unconfigured", {
      requestId,
      leadId: lead.id,
      segment: lead.segment,
      routedTo: lead.routedTo,
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "lead.routing_unconfigured",
      severity: "critical",
      summary: "A production lead could not be routed because owner email is missing.",
      meta: { requestId, leadId: lead.id, segment: lead.segment, routedTo: lead.routedTo },
      fingerprint: lead.segment,
    });
    return noStoreJson({ ok: false, error: "routing_unconfigured" }, { status: 500 });
  }

  const persistence = await persistLead(lead).catch((error) => ({
    id: lead.id,
    persisted: false as const,
    reason: error instanceof Error ? error.message : "convex_failed",
  }));
  if (!persistence.persisted && isProductionEnv()) {
    logError("lead.persistence_failed", {
      requestId,
      leadId: lead.id,
      source: lead.source,
      segment: lead.segment,
      reason: persistence.reason,
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "lead.persistence_failed",
      severity: "critical",
      summary: "A production lead failed to persist to Convex.",
      meta: { requestId, leadId: lead.id, source: lead.source, segment: lead.segment, reason: persistence.reason },
      fingerprint: persistence.reason,
    });
    return noStoreJson({ ok: false, error: "persistence_failed", reason: persistence.reason }, { status: 502 });
  }
  const [email, slack] = await Promise.allSettled([notifyOwner(lead), notifySlack(lead)]);
  const notifications = {
    email: notificationResult(email, "email_failed"),
    slack: notificationResult(slack, "slack_failed"),
  };
  const delivered = notifications.email.ok === true || notifications.slack.ok === true;
  if (persistence.persisted) {
    await recordLeadNotificationStatus(persistence.id, notifications).catch((error) => {
      logWarn("lead.notification_status_persist_failed", {
        requestId,
        leadId: persistence.id,
        error: errorMeta(error),
        durationMs: durationSince(startedAt),
      });
    });
  }
  if (!delivered && isProductionEnv()) {
    logError("lead.notification_failed", {
      requestId,
      leadId: lead.id,
      source: lead.source,
      segment: lead.segment,
      persisted: true,
      notifications,
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "lead.notification_failed",
      severity: "error",
      summary: "A lead was saved, but every notification channel failed.",
      meta: { requestId, leadId: lead.id, source: lead.source, segment: lead.segment, notifications },
      fingerprint: lead.segment,
    });
    return noStoreJson(
      { ok: false, error: "notification_failed", id: persistence.id, persisted: true, notifications },
      { status: 502 },
    );
  }

  logInfo("lead.accepted", {
    requestId,
    leadId: lead.id,
    source: lead.source,
    segment: lead.segment,
    routedTo: lead.routedTo,
    persisted: persistence.persisted,
    notificationDelivered: delivered,
    notifications,
    rateLimitStore: limit.store,
    remaining: limit.remaining,
    durationMs: durationSince(startedAt),
  });
  return noStoreJson({
    ok: true,
    id: persistence.id,
    persisted: persistence.persisted,
    notifications,
  });
}

function notificationResult(
  result: PromiseSettledResult<NotificationResult>,
  fallbackError: string,
): NotificationResult {
  if (result.status === "fulfilled") return result.value;
  logWarn("lead.notification_rejected", { fallbackError, error: errorMeta(result.reason) });
  return { ok: false, error: fallbackError };
}
