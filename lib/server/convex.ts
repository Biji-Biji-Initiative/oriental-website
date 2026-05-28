import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import type { VoiceReviewSnapshotRequest } from "@/lib/schemas";
import type { NotificationResult, StoredLead } from "@/lib/server/notifications";

export async function persistLead(lead: StoredLead) {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) {
    return { id: lead.id, persisted: false as const, reason: "convex_unconfigured" };
  }
  const client = new ConvexHttpClient(convexUrl);
  const result = await client.mutation(api.leads.createLead, { lead, ingestSecret });
  return { id: result.id, persisted: true as const };
}

export async function recordLeadNotificationStatus(
  leadId: string,
  notifications: { email: NotificationResult; slack: NotificationResult },
) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const notificationDelivered = notifications.email.ok === true || notifications.slack.ok === true;
  const result = await client.client.mutation(api.leads.recordLeadNotification, {
    ingestSecret: client.ingestSecret,
    leadId,
    notificationDelivered,
    emailOk: notifications.email.ok === true,
    slackOk: notifications.slack.ok === true,
    summary: notificationSummary(notifications),
  });
  return { ok: result.ok };
}

export async function persistVoiceReviewSnapshot(input: VoiceReviewSnapshotRequest["snapshot"] & { reviewId: string }) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const result = await client.client.mutation(api.leads.recordVoiceSession, {
    ingestSecret: client.ingestSecret,
    snapshot: input,
  });
  return { ok: result.ok, id: result.id };
}

export async function getAdminReviewDashboard(limit = 50) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const data = await client.client.query(api.leads.reviewDashboard, { ingestSecret: client.ingestSecret, limit });
  return { ok: true as const, data };
}

function createConvexClient() {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) return null;
  return { client: new ConvexHttpClient(convexUrl), ingestSecret };
}

function notificationSummary(notifications: { email: NotificationResult; slack: NotificationResult }) {
  return [`email=${notificationStatus(notifications.email)}`, `slack=${notificationStatus(notifications.slack)}`].join(
    " ",
  );
}

function notificationStatus(result: NotificationResult) {
  if (result.ok) return result.transport ?? "ok";
  if (result.skipped) return result.reason ?? "skipped";
  return result.error ?? "failed";
}
