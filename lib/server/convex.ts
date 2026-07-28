import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { summarizeAdminLeads } from "@/lib/admin-lead-counts";
import type { PrivacyDeletionReason } from "@/lib/data-retention";
import { readEnv } from "@/lib/env";
import type {
  AdminLeadArchiveRequest,
  AdminLeadBulkAssignmentRequest,
  AdminLeadWorkflowRequest,
  VoiceReviewSnapshotRequest,
} from "@/lib/schemas";
import type { NotificationResult, StoredLead } from "@/lib/server/notifications";
import { isVoiceAvailabilityFailure } from "@/lib/voice/realtime-call-failure";

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
    if (
      isConvexForwardFieldValidationError(error) &&
      (lead.voiceRuntimeProfile ||
        lead.voiceInputPolicy ||
        lead.voiceModelCell ||
        lead.voiceReasoningCell ||
        lead.entryPoint ||
        lead.entryMethod ||
        lead.submissionMethod ||
        lead.fieldProvenance)
    ) {
      const {
        voiceRuntimeProfile: _runtimeProfile,
        voiceInputPolicy: _inputPolicy,
        voiceModelCell: _modelCell,
        voiceReasoningCell: _reasoningCell,
        entryPoint: _entryPoint,
        entryMethod: _entryMethod,
        submissionMethod: _submissionMethod,
        fieldProvenance: _fieldProvenance,
        ...compatibleLead
      } = lead;
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
    slackMessageId:
      notifications.slack?.ok === true && notifications.slack.transport === "slack"
        ? notifications.slack.externalId
        : undefined,
    clickupOk: notifications.clickup?.ok === true,
    clickupTaskId:
      notifications.clickup?.ok === true && notifications.clickup.transport === "clickup"
        ? notifications.clickup.externalId
        : undefined,
    clickupTaskUrl:
      notifications.clickup?.ok === true && notifications.clickup.transport === "clickup"
        ? notifications.clickup.externalUrl
        : undefined,
    confirmationOk: notifications.confirmation?.ok === true,
    summary: notificationSummary(notifications),
  });
  return { ok: result.ok };
}

export async function persistVoiceReviewSnapshot(input: VoiceReviewSnapshotRequest["snapshot"] & { reviewId: string }) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const convexInput = input;
  try {
    const result = await client.client.mutation(api.leads.recordVoiceSession, {
      ingestSecret: client.ingestSecret,
      snapshot: convexInput,
    });
    return {
      ok: result.ok,
      id: result.id,
      applied: result.applied ?? true,
      autoEvalQueued: result.autoEvalQueued ?? false,
    };
  } catch (error) {
    // Forward-compatibility: a Convex deployment that predates evolvable
    // telemetry fields rejects them as unknown arguments. Retry once without
    // telemetry so review persistence never regresses on deploy ordering.
    if (
      isConvexForwardFieldValidationError(error) &&
      (convexInput.transport ||
        convexInput.latency ||
        convexInput.runtimeProfile ||
        convexInput.inputPolicy ||
        convexInput.modelCell ||
        convexInput.reasoningCell ||
        convexInput.deviceProfile ||
        convexInput.deploymentEnvironment ||
        convexInput.emailVerification ||
        convexInput.emailCaptureMode ||
        convexInput.entryPoint ||
        convexInput.entryMethod ||
        convexInput.submissionMethod ||
        convexInput.fieldProvenance ||
        typeof convexInput.snapshotSequence === "number" ||
        typeof convexInput.activationAttempted === "boolean")
    ) {
      const {
        transport: _transport,
        latency: _latency,
        runtimeProfile: _runtimeProfile,
        inputPolicy: _inputPolicy,
        modelCell: _modelCell,
        reasoningCell: _reasoningCell,
        deviceProfile: _deviceProfile,
        deploymentEnvironment: _deploymentEnvironment,
        emailVerification: _emailVerification,
        emailCaptureMode: _emailCaptureMode,
        entryPoint: _entryPoint,
        entryMethod: _entryMethod,
        submissionMethod: _submissionMethod,
        fieldProvenance: _fieldProvenance,
        snapshotSequence: _snapshotSequence,
        activationAttempted: _activationAttempted,
        ...rest
      } = convexInput;
      const result = await client.client.mutation(api.leads.recordVoiceSession, {
        ingestSecret: client.ingestSecret,
        snapshot: rest,
      });
      return {
        ok: result.ok,
        id: result.id,
        applied: result.applied ?? true,
        autoEvalQueued: result.autoEvalQueued ?? false,
      };
    }
    throw error;
  }
}

function isConvexForwardFieldValidationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /ArgumentValidationError|validator/i.test(message) &&
    /unexpected field|extra field|unknown (?:argument|field)|not in (?:the )?validator/i.test(message)
  );
}

export async function getAdminReviewDashboard(limit = 50) {
  const fixturePath = readEnv("ADMIN_REVIEW_DASHBOARD_FIXTURE");
  if (fixturePath && process.env.NODE_ENV !== "production") {
    return { ok: true as const, data: await readAdminReviewDashboardFixture(fixturePath) };
  }

  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const data = withAvailabilityFailures(await queryAdminReviewDashboard(client, limit));
  return { ok: true as const, data };
}

export async function getAdminAggregateMetrics(limit = 100) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const take = Math.min(Math.max(Math.floor(limit), 1), 100);
  const data = await client.client.query(api.leads.adminAggregateMetrics, {
    ingestSecret: client.ingestSecret,
    limit: take,
  });
  const parsed = adminAggregateMetricsSchema.safeParse(data);
  if (!parsed.success) throw new Error("Convex returned an invalid admin aggregate metrics DTO");
  return { ok: true as const, data: parsed.data };
}

const aggregateCount = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const aggregatePercentage = z.number().finite().min(0).max(100);
const adminAggregateMetricsSchema = z.strictObject({
  generatedAt: aggregateCount,
  metrics: z.strictObject({
    activeLeads: aggregateCount,
    connectedSessions: aggregateCount,
    engagedSessions: aggregateCount,
    notificationDeliveryRate: aggregatePercentage,
    notificationFailures: aggregateCount,
    prewarmedSessions: aggregateCount,
    qualifiedLeads: aggregateCount,
    recentLeads: aggregateCount,
    reviewedSessions: aggregateCount,
    sessionsWithErrors: aggregateCount,
    submittedSessions: aggregateCount,
    urgentLeads: aggregateCount,
    voiceLeads: aggregateCount,
    voiceSubmitRate: aggregatePercentage,
  }),
});

export type AdminAggregateMetricsData = z.infer<typeof adminAggregateMetricsSchema>;

export async function getAdminLeadTable(limit = 500) {
  const take = Math.min(Math.max(Math.floor(limit), 1), 500);
  const fixturePath = readEnv("ADMIN_REVIEW_DASHBOARD_FIXTURE");
  if (fixturePath && process.env.NODE_ENV !== "production") {
    const fixture = await readAdminReviewDashboardFixture(fixturePath);
    return {
      ok: true as const,
      leads: fixture.leads.slice(0, take),
      counts: summarizeAdminLeads(fixture.leads, fixture.generatedAt),
    };
  }

  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const [leads, counts] = await Promise.all([
    client.client.query(api.leads.adminLeadTable, {
      ingestSecret: client.ingestSecret,
      limit: take,
    }),
    client.client.query(api.leads.adminLeadCounts, {
      ingestSecret: client.ingestSecret,
    }),
  ]);
  return { ok: true as const, leads, counts };
}

export async function getAdminLeadSlaSnapshot(maxUnownedMs: number) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const data = await client.client.query(api.leads.adminLeadSlaSnapshot, {
    ingestSecret: client.ingestSecret,
    maxUnownedMs,
  });
  return { ok: true as const, data };
}

export async function applyDataRetention(now: number) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" as const };
  const result = await client.client.mutation(api.leads.applyDataRetention, {
    ingestSecret: client.ingestSecret,
    now,
  });
  return { ok: true as const, ...result };
}

export async function getPrivacyDeletionPlan(email: string) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" as const };
  await client.client.mutation(api.leads.normalizeLegacyPrivacyEmails, {
    ingestSecret: client.ingestSecret,
  });
  const plan = await client.client.query(api.leads.privacyDeletionPlanByEmail, {
    ingestSecret: client.ingestSecret,
    email,
  });
  return { ok: true as const, ...plan };
}

export async function deletePersonalData(input: {
  email: string;
  reason: PrivacyDeletionReason;
  requestId: string;
  actor: string;
  downstreamCleanupComplete?: boolean;
}) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" as const };
  const result = await client.client.mutation(api.leads.deletePersonalData, {
    ingestSecret: client.ingestSecret,
    ...input,
    downstreamCleanupComplete: input.downstreamCleanupComplete === true,
  });
  return { ok: true as const, ...result };
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

export async function updateAdminLeadWorkflow(
  leadId: string,
  workflow: AdminLeadWorkflowRequest,
  audit: { actor: string; requestId: string },
) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const result = await client.client.mutation(api.leads.updateLeadWorkflow, {
    ingestSecret: client.ingestSecret,
    leadId,
    ...workflow,
    ...audit,
  });
  if (!result.ok) {
    return result.reason === "conflict"
      ? { ok: false as const, reason: result.reason, currentRevision: result.currentRevision }
      : { ok: false as const, reason: result.reason };
  }
  return { ok: true as const, changed: result.changed, revision: result.revision };
}

export async function bulkAssignAdminLeads(
  assignment: AdminLeadBulkAssignmentRequest,
  audit: { actor: string; requestId: string },
) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  const result = await client.client.mutation(api.leads.bulkAssignLeads, {
    ingestSecret: client.ingestSecret,
    ...assignment,
    ...audit,
  });
  return result;
}

export async function archiveAdminLeads(input: AdminLeadArchiveRequest, audit: { actor: string; requestId: string }) {
  const client = createConvexClient();
  if (!client) return { ok: false as const, reason: "convex_unconfigured" };
  return client.client.mutation(api.leads.archiveLeads, {
    ingestSecret: client.ingestSecret,
    ...input,
    ...audit,
  });
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

function withAvailabilityFailures(data: AdminReviewDashboardData): AdminReviewDashboardData {
  const sessionsWithErrors = data.voiceSessions.filter(
    (session) => session.errors.length > 0 || isVoiceAvailabilityFailure(session.closeReason),
  ).length;
  return {
    ...data,
    metrics: { ...data.metrics, sessionsWithErrors },
    analytics: {
      ...data.analytics,
      voice: { ...data.analytics.voice, withErrors: sessionsWithErrors },
    },
  };
}

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
