import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import type { AdminLeadWorkflowRequest, VoiceReviewSnapshotRequest } from "@/lib/schemas";
import type { NotificationResult, StoredLead } from "@/lib/server/notifications";

export async function persistLead(lead: StoredLead) {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) {
    return { id: lead.id, persisted: false as const, reason: "convex_unconfigured" };
  }
  const client = new ConvexHttpClient(convexUrl);
  try {
    const result = await client.mutation(api.leads.createLead, { lead, ingestSecret });
    return { id: result.id, persisted: true as const };
  } catch (error) {
    if (lead.voiceRuntimeProfile || lead.voiceInputPolicy || lead.voiceModelCell || lead.voiceReasoningCell) {
      const { voiceRuntimeProfile: _runtimeProfile, voiceInputPolicy: _inputPolicy, ...legacyLead } = lead;
      const { voiceModelCell: _modelCell, voiceReasoningCell: _reasoningCell, ...compatibleLead } = legacyLead;
      const result = await client.mutation(api.leads.createLead, { lead: compatibleLead, ingestSecret });
      return { id: result.id, persisted: true as const };
    }
    throw error;
  }
}

export async function recordLeadNotificationStatus(
  leadId: string,
  notifications: {
    email?: NotificationResult;
    slack?: NotificationResult;
    clickup?: NotificationResult;
    confirmation?: NotificationResult;
  },
  notificationDelivered?: boolean,
) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const delivered =
    notificationDelivered ??
    (notifications.email?.ok === true ||
      notifications.slack?.ok === true ||
      notifications.clickup?.ok === true ||
      notifications.confirmation?.ok === true);
  const result = await client.client.mutation(api.leads.recordLeadNotification, {
    ingestSecret: client.ingestSecret,
    leadId,
    notificationDelivered: delivered,
    emailOk: notifications.email?.ok === true,
    slackOk: notifications.slack?.ok === true,
    clickupOk: notifications.clickup?.ok === true,
    confirmationOk: notifications.confirmation?.ok === true,
    summary: notificationSummary(notifications),
  });
  return { ok: result.ok };
}

export async function persistVoiceReviewSnapshot(input: VoiceReviewSnapshotRequest["snapshot"] & { reviewId: string }) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  try {
    const result = await client.client.mutation(api.leads.recordVoiceSession, {
      ingestSecret: client.ingestSecret,
      snapshot: input,
    });
    return { ok: result.ok, id: result.id };
  } catch (error) {
    // Forward-compatibility: a Convex deployment that predates evolvable
    // telemetry fields rejects them as unknown arguments. Retry once without
    // telemetry so review persistence never regresses on deploy ordering.
    if (
      input.transport ||
      input.latency ||
      input.runtimeProfile ||
      input.inputPolicy ||
      input.modelCell ||
      input.reasoningCell
    ) {
      const {
        transport: _transport,
        latency: _latency,
        runtimeProfile: _runtimeProfile,
        inputPolicy: _inputPolicy,
        modelCell: _modelCell,
        reasoningCell: _reasoningCell,
        ...rest
      } = input;
      const result = await client.client.mutation(api.leads.recordVoiceSession, {
        ingestSecret: client.ingestSecret,
        snapshot: rest,
      });
      return { ok: result.ok, id: result.id };
    }
    throw error;
  }
}

export async function getAdminReviewDashboard(limit = 50) {
  const fixturePath = readEnv("ADMIN_REVIEW_DASHBOARD_FIXTURE");
  if (fixturePath && process.env.NODE_ENV !== "production") {
    return { ok: true as const, data: await readAdminReviewDashboardFixture(fixturePath) };
  }

  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const data = await queryAdminReviewDashboard(client, limit);
  return { ok: true as const, data };
}

export async function getAdminVoiceSession(reviewId: string) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const session = await client.client.query(api.leads.voiceSessionByReviewId, {
    ingestSecret: client.ingestSecret,
    reviewId,
  });
  if (!session) return { ok: false as const, reason: "not_found" };
  return { ok: true as const, session };
}

export async function updateAdminLeadWorkflow(leadId: string, workflow: AdminLeadWorkflowRequest) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const result = await client.client.mutation(api.leads.updateLeadWorkflow, {
    ingestSecret: client.ingestSecret,
    leadId,
    ...workflow,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason };
  return { ok: true as const };
}

export async function setAdminVoiceFollowUp(reviewId: string, followedUp: boolean) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const result = await client.client.mutation(api.leads.setVoiceSessionFollowUp, {
    ingestSecret: client.ingestSecret,
    reviewId,
    followedUp,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason ?? "not_found" };
  return { ok: true as const };
}

function createConvexClient() {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) return null;
  return { client: new ConvexHttpClient(convexUrl), ingestSecret };
}

type ConvexClientConfig = NonNullable<ReturnType<typeof createConvexClient>>;
type AdminReviewDashboardData = Awaited<ReturnType<typeof queryAdminReviewDashboard>>;

async function queryAdminReviewDashboard(client: ConvexClientConfig, limit: number) {
  return client.client.query(api.leads.reviewDashboard, { ingestSecret: client.ingestSecret, limit });
}

async function readAdminReviewDashboardFixture(fixturePath: string): Promise<AdminReviewDashboardData> {
  const [{ readFile }, { resolve }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const raw = await readFile(resolve(process.cwd(), fixturePath), "utf8");
  return JSON.parse(raw) as AdminReviewDashboardData;
}

function notificationSummary(notifications: {
  email?: NotificationResult;
  slack?: NotificationResult;
  clickup?: NotificationResult;
  confirmation?: NotificationResult;
}) {
  return [
    notifications.email ? `email=${notificationStatus(notifications.email)}` : null,
    notifications.slack ? `slack=${notificationStatus(notifications.slack)}` : null,
    notifications.clickup ? `clickup=${notificationStatus(notifications.clickup)}` : null,
    notifications.confirmation ? `confirmation=${notificationStatus(notifications.confirmation)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function notificationStatus(result: NotificationResult) {
  if (result.ok) return result.transport ?? "ok";
  if (result.skipped) return result.reason ?? "skipped";
  return result.error ?? "failed";
}
