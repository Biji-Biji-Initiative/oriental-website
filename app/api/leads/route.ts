import type { NextRequest } from "next/server";
import { isProductionEnv } from "@/lib/env";
import { type LeadRequest, leadRequestSchema } from "@/lib/schemas";
import { persistLead, recordLeadNotificationStatus } from "@/lib/server/convex";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { settledNotificationResult } from "@/lib/server/notification-results";
import { notifyOwner, notifySlack, notifySubmitter, routeLead } from "@/lib/server/notifications";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { checkRateLimit, hashIp, noStoreJson, requestIp, verifyTurnstile } from "@/lib/server/security";
import { verifyVoiceReviewCredentials } from "@/lib/server/voice-review-token";

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

  const turnstileOk = voiceLeadHasSignedReview(parsed.data) || (await verifyTurnstile(parsed.data.turnstileToken, ip));
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

  const lead = routeLead(stripLeadVerification(parsed.data));
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
  // Notifications double as an independent durability path: the owner email and
  // Slack message carry the full lead, so they are attempted even when Convex is down.
  const [email, slack, confirmation] = await Promise.allSettled([
    notifyOwner(lead),
    notifySlack(lead),
    notifySubmitter(lead),
  ]);
  const notifications = {
    email: settledNotificationResult(email, "email_failed", "lead.notification_rejected"),
    slack: settledNotificationResult(slack, "slack_failed", "lead.notification_rejected"),
    confirmation: settledNotificationResult(confirmation, "confirmation_failed", "lead.notification_rejected"),
  };
  const delivered = notifications.email.ok === true || notifications.slack.ok === true;
  if (!persistence.persisted && isProductionEnv()) {
    logError("lead.persistence_failed", {
      requestId,
      leadId: lead.id,
      source: lead.source,
      segment: lead.segment,
      reason: persistence.reason,
      notificationDelivered: delivered,
      durationMs: durationSince(startedAt),
    });
    await sendOpsAlert({
      event: "lead.persistence_failed",
      severity: "critical",
      summary: delivered
        ? "A production lead failed to persist to Convex; it reached the team through notifications only."
        : "A production lead failed to persist to Convex and no notification channel delivered it.",
      meta: { requestId, leadId: lead.id, source: lead.source, segment: lead.segment, reason: persistence.reason },
      fingerprint: persistence.reason,
    });
    if (!delivered) {
      return noStoreJson({ ok: false, error: "persistence_failed", reason: persistence.reason }, { status: 502 });
    }
  }
  if (persistence.persisted) {
    await recordLeadNotificationStatus(
      persistence.id,
      {
        email: notifications.email,
        slack: notifications.slack,
        confirmation: notifications.confirmation,
      },
      delivered,
    ).catch((error) => {
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

function voiceLeadHasSignedReview(data: LeadRequest) {
  return (
    data.source === "voice" &&
    Boolean(data.voiceReviewId) &&
    Boolean(data.voiceReviewToken) &&
    verifyVoiceReviewCredentials(data.voiceReviewId ?? "", data.voiceReviewToken ?? "")
  );
}

function stripLeadVerification(data: LeadRequest) {
  const { voiceReviewToken: _verificationOnly, ...lead } = data;
  return lead;
}
