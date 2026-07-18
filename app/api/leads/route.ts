import type { NextRequest } from "next/server";
import { isProductionEnv } from "@/lib/env";
import { type LeadRequest, leadRequestSchema } from "@/lib/schemas";
import { persistLead, recordLeadNotificationStatus } from "@/lib/server/convex";
import { durationSince, errorMeta, logError, logInfo, logWarn } from "@/lib/server/logger";
import { publicNotificationResult, settledNotificationResult } from "@/lib/server/notification-results";
import { notifyClickUp, notifyOwner, notifySlack, notifySubmitter, routeLead } from "@/lib/server/notifications";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import {
  checkRateLimit,
  hashIp,
  noStoreJson,
  rateLimitResponseHeaders,
  requestIp,
  verifyTurnstile,
} from "@/lib/server/security";
import { readVoiceReviewCredentialClaims, type VoiceReviewCredentialClaims } from "@/lib/server/voice-review-token";
import { createVoiceSubmissionEvidence } from "@/lib/server/voice-submission-evidence";
import { publicLeadUtm, VOICE_SUBMISSION_EVIDENCE_UTM_KEY } from "@/lib/voice/submission-evidence";

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
    return noStoreJson(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rateLimitResponseHeaders(limit.resetAt) },
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = leadRequestSchema.safeParse(raw);
  if (!parsed.success) {
    logWarn("lead.invalid_payload", { requestId, ipHash, durationMs: durationSince(startedAt) });
    return noStoreJson({ ok: false, error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const voiceReviewClaims = voiceLeadReviewClaims(parsed.data);
  const signedVoiceReview = voiceReviewClaims !== null;
  if (parsed.data.source === "voice" && !signedVoiceReview) {
    logWarn("lead.voice_review_invalid", {
      requestId,
      ipHash,
      reviewId: parsed.data.voiceReviewId ?? null,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "voice_review_invalid" }, { status: 403 });
  }
  // A smoke capability can persist review telemetry but can never cross the
  // lead boundary. This keeps shared staging data and notifications safe even
  // if a synthetic Realtime turn unexpectedly invokes route_to_team.
  if (voiceReviewClaims?.synthetic) {
    logWarn("lead.synthetic_review_forbidden", {
      requestId,
      ipHash,
      reviewId: parsed.data.voiceReviewId ?? null,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "synthetic_review_forbidden" }, { status: 403 });
  }

  const turnstileOk = signedVoiceReview || (await verifyTurnstile(parsed.data.turnstileToken, ip));
  if (!turnstileOk) {
    logWarn("lead.turnstile_failed", {
      requestId,
      ipHash,
      source: parsed.data.source,
      entryPoint: parsed.data.entryPoint ?? "unknown",
      entryMethod: parsed.data.entryMethod ?? "unknown",
      submissionMethod: parsed.data.submissionMethod ?? "unknown",
      segment: parsed.data.segment,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "turnstile_failed" }, { status: 403 });
  }

  if (parsed.data.source === "voice" && parsed.data.voiceEmailVerified !== true) {
    logWarn("lead.voice_email_unconfirmed", {
      requestId,
      ipHash,
      segment: parsed.data.segment,
      reviewId: parsed.data.voiceReviewId ?? null,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "voice_email_unconfirmed" }, { status: 409 });
  }

  if (
    parsed.data.source === "voice" &&
    signedVoiceReview &&
    (!parsed.data.voiceSessionId ||
      !parsed.data.voiceEmailVerificationSource ||
      typeof parsed.data.voiceEmailVerificationUserTurnSequence !== "number")
  ) {
    logWarn("lead.voice_submission_attribution_incomplete", {
      requestId,
      ipHash,
      segment: parsed.data.segment,
      reviewId: parsed.data.voiceReviewId ?? null,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "voice_submission_attribution_incomplete" }, { status: 409 });
  }

  const acceptedAt = Date.now();
  const routedLead = routeLead(stripLeadVerification(parsed.data));
  const evidence =
    signedVoiceReview &&
    parsed.data.voiceReviewId &&
    parsed.data.voiceSessionId &&
    parsed.data.voiceEmailVerificationSource &&
    typeof parsed.data.voiceEmailVerificationUserTurnSequence === "number"
      ? createVoiceSubmissionEvidence({
          acceptedAt,
          authorityTurnSequence: parsed.data.voiceEmailVerificationUserTurnSequence,
          email: routedLead.form.email,
          leadId: routedLead.id,
          reviewId: parsed.data.voiceReviewId,
          sessionId: parsed.data.voiceSessionId,
          source: parsed.data.voiceEmailVerificationSource,
          transcript: routedLead.transcript,
        })
      : null;
  if (signedVoiceReview && !evidence) {
    logWarn("lead.voice_submission_evidence_invalid", {
      requestId,
      ipHash,
      segment: parsed.data.segment,
      reviewId: parsed.data.voiceReviewId ?? null,
      durationMs: durationSince(startedAt),
    });
    return noStoreJson({ ok: false, error: "voice_submission_attribution_incomplete" }, { status: 409 });
  }
  const lead = {
    ...routedLead,
    // This key is server-owned. A client-supplied value is always removed,
    // then a signed envelope is inserted only for a complete signed voice row.
    utm: {
      ...publicLeadUtm(routedLead.utm),
      ...(evidence ? { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: evidence } : {}),
    },
  };
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

  // Notifications double as an independent durability path: the owner email and
  // Slack message carry the full lead, so they are attempted even when Convex is
  // down. Start persistence and fan-out together: neither depends on the other,
  // and serializing them unnecessarily delayed the route_to_team voice tool.
  const operationTimings: Record<string, number> = {};
  const timed = async <T>(name: string, operation: () => Promise<T>) => {
    const operationStartedAt = performance.now();
    try {
      return await operation();
    } finally {
      operationTimings[name] = Math.max(0, Math.round(performance.now() - operationStartedAt));
    }
  };
  const persistencePromise = timed("persistenceMs", () => persistLead(lead)).catch((error) => ({
    id: lead.id,
    persisted: false as const,
    reason: error instanceof Error ? error.message : "convex_failed",
  }));
  const notificationsPromise = Promise.allSettled([
    timed("ownerNotificationMs", () => notifyOwner(lead)),
    timed("slackNotificationMs", () => notifySlack(lead)),
    timed("clickupNotificationMs", () => notifyClickUp(lead)),
    timed("submitterNotificationMs", () => notifySubmitter(lead)),
  ]);
  const [persistence, [email, slack, clickup, confirmation]] = await Promise.all([
    persistencePromise,
    notificationsPromise,
  ]);
  const notifications = {
    email: settledNotificationResult(email, "email_failed", "lead.notification_rejected"),
    slack: settledNotificationResult(slack, "slack_failed", "lead.notification_rejected"),
    clickup: settledNotificationResult(clickup, "clickup_failed", "lead.notification_rejected"),
    confirmation: settledNotificationResult(confirmation, "confirmation_failed", "lead.notification_rejected"),
  };
  const publicNotifications = {
    email: publicNotificationResult(notifications.email),
    slack: publicNotificationResult(notifications.slack),
    clickup: publicNotificationResult(notifications.clickup),
    confirmation: publicNotificationResult(notifications.confirmation),
  };
  const delivered =
    notifications.email.ok === true || notifications.slack.ok === true || notifications.clickup.ok === true;
  if (!persistence.persisted && isProductionEnv()) {
    logError("lead.persistence_failed", {
      requestId,
      leadId: lead.id,
      source: lead.source,
      entryPoint: lead.entryPoint ?? "unknown",
      entryMethod: lead.entryMethod ?? "unknown",
      submissionMethod: lead.submissionMethod ?? "unknown",
      segment: lead.segment,
      reason: persistence.reason,
      notificationDelivered: delivered,
      operationTimings,
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
    await timed("notificationStatusPersistenceMs", () =>
      recordLeadNotificationStatus(
        persistence.id,
        {
          email: notifications.email,
          slack: notifications.slack,
          clickup: notifications.clickup,
          confirmation: notifications.confirmation,
        },
        delivered,
      ),
    ).catch((error) => {
      logWarn("lead.notification_status_persist_failed", {
        requestId,
        leadId: persistence.id,
        error: errorMeta(error),
        operationTimings,
        durationMs: durationSince(startedAt),
      });
    });
  }
  if (!delivered && isProductionEnv()) {
    logError("lead.notification_failed", {
      requestId,
      leadId: lead.id,
      source: lead.source,
      entryPoint: lead.entryPoint ?? "unknown",
      entryMethod: lead.entryMethod ?? "unknown",
      submissionMethod: lead.submissionMethod ?? "unknown",
      segment: lead.segment,
      persisted: true,
      notifications,
      operationTimings,
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
      {
        ok: false,
        error: "notification_failed",
        id: persistence.id,
        persisted: true,
        notifications: publicNotifications,
      },
      { status: 502 },
    );
  }

  logInfo("lead.accepted", {
    requestId,
    leadId: lead.id,
    source: lead.source,
    entryPoint: lead.entryPoint ?? "unknown",
    entryMethod: lead.entryMethod ?? "unknown",
    submissionMethod: lead.submissionMethod ?? "unknown",
    segment: lead.segment,
    routedTo: lead.routedTo,
    persisted: persistence.persisted,
    notificationDelivered: delivered,
    voiceEmailVerificationSource:
      parsed.data.source === "voice" ? (parsed.data.voiceEmailVerificationSource ?? "unknown") : null,
    notifications: publicNotifications,
    rateLimitStore: limit.store,
    remaining: limit.remaining,
    operationTimings,
    durationMs: durationSince(startedAt),
  });
  return noStoreJson({
    ok: true,
    id: persistence.id,
    acceptedAt,
    persisted: persistence.persisted,
    notifications: publicNotifications,
  });
}

function voiceLeadReviewClaims(data: LeadRequest): VoiceReviewCredentialClaims | null {
  if (data.source !== "voice" || !data.voiceReviewId || !data.voiceReviewToken) return null;
  return readVoiceReviewCredentialClaims(data.voiceReviewId, data.voiceReviewToken);
}

function stripLeadVerification(data: LeadRequest) {
  const {
    voiceReviewToken: _verificationOnly,
    voiceEmailVerified: _emailVerificationOnly,
    voiceEmailVerificationSource: _emailVerificationSourceOnly,
    voiceEmailVerificationUserTurnSequence: _emailVerificationSequenceOnly,
    ...lead
  } = data;
  return lead;
}
