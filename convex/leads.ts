import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { ADMIN_LEAD_OWNERS, validateAdminLeadWorkflow } from "../lib/admin-workflow";

function requireIngestSecret(ingestSecret: string) {
  const expected = process.env.CONVEX_INGEST_SECRET;
  if (!expected || ingestSecret !== expected) {
    throw new Error("unauthorized");
  }
}

const transcriptValidator = v.array(
  v.object({
    role: v.string(),
    text: v.string(),
  }),
);

const leadValidator = v.object({
  id: v.string(),
  source: v.union(v.literal("voice"), v.literal("form"), v.literal("hero-email")),
  segment: v.string(),
  routedTo: v.string(),
  routedToEmail: v.optional(v.union(v.string(), v.null())),
  form: v.object({
    name: v.string(),
    email: v.string(),
    org: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    message: v.string(),
  }),
  transcript: transcriptValidator,
  voiceReviewId: v.optional(v.string()),
  voiceSessionId: v.optional(v.string()),
  voiceVariant: v.optional(v.string()),
  voiceModel: v.optional(v.string()),
  voiceModelCell: v.optional(v.string()),
  voiceReasoningCell: v.optional(v.string()),
  voiceName: v.optional(v.string()),
  voiceSpeed: v.optional(v.number()),
  voiceRuntimeProfile: v.optional(v.string()),
  voiceInputPolicy: v.optional(v.string()),
  turnstileToken: v.optional(v.string()),
  utm: v.record(v.string(), v.string()),
});

const capturedValidator = v.object({
  name: v.string(),
  email: v.string(),
  org: v.string(),
  phone: v.optional(v.string()),
  website: v.optional(v.string()),
  message: v.string(),
});

const emailVerificationValidator = v.object({
  source: v.union(v.literal("prefill"), v.literal("speech"), v.literal("typed")),
  status: v.union(v.literal("confirmed"), v.literal("pending")),
  matchesCaptured: v.boolean(),
});

const usageValidator = v.object({
  responseCount: v.number(),
  responseTokens: v.number(),
  responseInputTokens: v.number(),
  responseOutputTokens: v.number(),
  responseCachedTokens: v.number(),
  transcriptionCount: v.number(),
  transcriptionTokens: v.number(),
  transcriptionInputTokens: v.number(),
  transcriptionOutputTokens: v.number(),
});

const transportValidator = v.object({
  realtimeBusyRetryCount: v.optional(v.number()),
  disconnectCount: v.number(),
  recoveryCount: v.number(),
  iceRestartCount: v.number(),
  wasSpeakingAtClose: v.optional(v.boolean()),
  remoteTrackReceivedAt: v.optional(v.number()),
  transitions: v.array(v.object({ state: v.string(), at: v.number() })),
  lastStats: v.optional(
    v.object({
      at: v.number(),
      packetsLost: v.optional(v.number()),
      packetsReceived: v.optional(v.number()),
      jitterMs: v.optional(v.number()),
      roundTripMs: v.optional(v.number()),
    }),
  ),
  worstStats: v.optional(
    v.object({
      packetsLostPct: v.optional(v.number()),
      maxJitterMs: v.optional(v.number()),
      maxRttMs: v.optional(v.number()),
    }),
  ),
});

const latencyValidator = v.object({
  version: v.literal(1),
  activation: v.optional(
    v.object({
      tapToArmCueScheduledMs: v.optional(v.number()),
      tapToLiveMs: v.optional(v.number()),
      tapToAudibleMs: v.optional(v.number()),
    }),
  ),
  turns: v.array(
    v.object({
      sequence: v.number(),
      inputPolicy: v.union(v.literal("baseline"), v.literal("fast"), v.literal("patient")),
      speechDurationMs: v.optional(v.number()),
      stopToResponseCreatedMs: v.optional(v.number()),
      stopToFirstOutputEventMs: v.optional(v.number()),
      localSpeechEndToSpeechStoppedMs: v.optional(v.number()),
      stopToRemoteAudioMs: v.optional(v.number()),
      firstOutputEventToRemoteAudioMs: v.optional(v.number()),
      toolDurationMs: v.optional(v.number()),
      bargeInToResponseDoneMs: v.optional(v.number()),
      responseDurationMs: v.optional(v.number()),
      interrupted: v.boolean(),
      rapidResume: v.boolean(),
    }),
  ),
  toolCalls: v.optional(
    v.array(
      v.object({
        sequence: v.optional(v.number()),
        name: v.union(
          v.literal("set_partner_type"),
          v.literal("capture_field"),
          v.literal("capture_fields"),
          v.literal("confirm_email"),
          v.literal("lookup_oriental"),
          v.literal("clear_field"),
          v.literal("summarise_lead"),
          v.literal("route_to_team"),
          v.literal("wait_for_user"),
          v.literal("end_call"),
          v.literal("unknown"),
        ),
        outcome: v.union(
          v.literal("success"),
          v.literal("rejected"),
          v.literal("failed"),
          v.literal("dispatch_failed"),
        ),
        executionMs: v.number(),
        responseCreatedToCallMs: v.optional(v.number()),
        responseCreatedToResultMs: v.optional(v.number()),
      }),
    ),
  ),
});

const voiceSessionValidator = v.object({
  reviewId: v.string(),
  sessionId: v.string(),
  conversationId: v.optional(v.string()),
  leadId: v.optional(v.union(v.string(), v.null())),
  segment: v.string(),
  status: v.string(),
  connectionStatus: v.string(),
  closeReason: v.optional(v.string()),
  deviceProfile: v.optional(v.union(v.literal("mobile"), v.literal("desktop"))),
  deploymentEnvironment: v.optional(v.union(v.literal("local"), v.literal("staging"), v.literal("production"))),
  activationAttempted: v.optional(v.boolean()),
  prewarmedAt: v.optional(v.number()),
  connectStartedAt: v.optional(v.number()),
  connectedAt: v.optional(v.number()),
  firstEventAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),
  model: v.optional(v.string()),
  modelCell: v.optional(v.union(v.literal("control"), v.literal("candidate"))),
  reasoningCell: v.optional(v.union(v.literal("low"), v.literal("minimal"))),
  voice: v.optional(v.string()),
  speed: v.optional(v.number()),
  variant: v.optional(v.union(v.string(), v.null())),
  runtimeProfile: v.optional(v.union(v.literal("baseline"), v.literal("instant-v1"))),
  inputPolicy: v.optional(v.union(v.literal("baseline"), v.literal("fast"), v.literal("patient"))),
  captured: capturedValidator,
  emailVerification: v.optional(emailVerificationValidator),
  emailCaptureMode: v.optional(v.union(v.literal("strict"), v.literal("adaptive"))),
  transcript: transcriptValidator,
  usage: v.optional(usageValidator),
  errors: v.array(
    v.object({
      eventId: v.optional(v.string()),
      message: v.string(),
      code: v.optional(v.string()),
    }),
  ),
  rateLimits: v.array(v.any()),
  routeRequested: v.boolean(),
  submittedAt: v.optional(v.number()),
  latency: v.optional(latencyValidator),
  transport: v.optional(transportValidator),
});

const workflowStatusValidator = v.union(
  v.literal("new"),
  v.literal("reviewing"),
  v.literal("contacted"),
  v.literal("qualified"),
  v.literal("archived"),
);

const leadPriorityValidator = v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent"));

export const createLead = mutationGeneric({
  args: { lead: leadValidator, ingestSecret: v.string() },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, { lead, ingestSecret }) => {
    requireIngestSecret(ingestSecret);

    await ctx.db.insert("leads", {
      leadId: lead.id,
      source: lead.source,
      segment: lead.segment,
      routedTo: lead.routedTo,
      routedToEmail: lead.routedToEmail ?? null,
      name: lead.form.name,
      email: lead.form.email,
      org: lead.form.org,
      phone: lead.form.phone,
      website: lead.form.website,
      message: lead.form.message,
      transcript: lead.transcript,
      ...(lead.voiceReviewId ? { voiceReviewId: lead.voiceReviewId } : {}),
      ...(lead.voiceSessionId ? { voiceSessionId: lead.voiceSessionId } : {}),
      ...(lead.voiceVariant ? { voiceVariant: lead.voiceVariant } : {}),
      ...(lead.voiceModel ? { voiceModel: lead.voiceModel } : {}),
      ...(lead.voiceModelCell ? { voiceModelCell: lead.voiceModelCell } : {}),
      ...(lead.voiceReasoningCell ? { voiceReasoningCell: lead.voiceReasoningCell } : {}),
      ...(lead.voiceName ? { voiceName: lead.voiceName } : {}),
      ...(typeof lead.voiceSpeed === "number" ? { voiceSpeed: lead.voiceSpeed } : {}),
      ...(lead.voiceRuntimeProfile ? { voiceRuntimeProfile: lead.voiceRuntimeProfile } : {}),
      ...(lead.voiceInputPolicy ? { voiceInputPolicy: lead.voiceInputPolicy } : {}),
      utm: lead.utm,
      status: "new",
      priority: "normal",
      owner: "",
      createdAt: Date.now(),
    });
    await ctx.db.insert("leadEvents", {
      leadId: lead.id,
      kind: "created",
      actor: "system",
      note: `Created from ${lead.source}`,
      createdAt: Date.now(),
    });
    return { id: lead.id };
  },
});

export const recordLeadNotification = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    leadId: v.string(),
    notificationDelivered: v.boolean(),
    emailOk: v.boolean(),
    slackOk: v.boolean(),
    clickupOk: v.optional(v.boolean()),
    clickupTaskId: v.optional(v.string()),
    clickupTaskUrl: v.optional(v.string()),
    confirmationOk: v.optional(v.boolean()),
    summary: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (
    ctx,
    {
      ingestSecret,
      leadId,
      notificationDelivered,
      emailOk,
      slackOk,
      clickupOk,
      clickupTaskId,
      clickupTaskUrl,
      confirmationOk,
      summary,
    },
  ) => {
    requireIngestSecret(ingestSecret);
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_lead_id", (query) => query.eq("leadId", leadId))
      .unique();
    if (!lead) return { ok: false };
    await ctx.db.patch(lead._id, {
      notificationDelivered,
      notificationEmailOk: emailOk,
      notificationSlackOk: slackOk,
      ...(typeof clickupOk === "boolean" ? { notificationClickUpOk: clickupOk } : {}),
      ...(clickupTaskId?.trim() ? { notificationClickUpTaskId: clickupTaskId.trim() } : {}),
      ...(clickupTaskUrl?.trim() ? { notificationClickUpTaskUrl: clickupTaskUrl.trim() } : {}),
      ...(typeof confirmationOk === "boolean" ? { notificationConfirmationOk: confirmationOk } : {}),
      notificationSummary: summary,
      lastNotificationAt: Date.now(),
    });
    await ctx.db.insert("leadEvents", {
      leadId,
      kind: notificationDelivered ? "notification_delivered" : "notification_failed",
      actor: "system",
      note: summary,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const confirmLeadClickUpMirror = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    leadId: v.string(),
    clickupTaskId: v.optional(v.string()),
    clickupTaskUrl: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), changed: v.boolean() }),
    v.object({ ok: v.literal(false), reason: v.literal("not_found") }),
  ),
  handler: async (ctx, { ingestSecret, leadId, clickupTaskId, clickupTaskUrl }) => {
    requireIngestSecret(ingestSecret);
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_lead_id", (query) => query.eq("leadId", leadId))
      .unique();
    if (!lead) return { ok: false as const, reason: "not_found" as const };

    const cleanTaskId = clickupTaskId?.trim();
    const cleanTaskUrl = clickupTaskUrl?.trim();
    const changed =
      lead.notificationClickUpOk !== true ||
      (Boolean(cleanTaskId) && lead.notificationClickUpTaskId !== cleanTaskId) ||
      (Boolean(cleanTaskUrl) && lead.notificationClickUpTaskUrl !== cleanTaskUrl);
    if (!changed) return { ok: true as const, changed: false };

    await ctx.db.patch(lead._id, {
      notificationClickUpOk: true,
      ...(cleanTaskId ? { notificationClickUpTaskId: cleanTaskId } : {}),
      ...(cleanTaskUrl ? { notificationClickUpTaskUrl: cleanTaskUrl } : {}),
    });
    await ctx.db.insert("leadEvents", {
      leadId,
      kind: "clickup_reconciled",
      actor: "system",
      note: cleanTaskId
        ? "Confirmed the existing ClickUp mirror and stored its direct task reference without changing the lead payload."
        : "Confirmed an existing ClickUp mirror task without changing the lead payload.",
      createdAt: Date.now(),
    });
    return { ok: true as const, changed: true };
  },
});

export const updateLeadWorkflow = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    leadId: v.string(),
    status: workflowStatusValidator,
    priority: leadPriorityValidator,
    owner: v.string(),
    note: v.optional(v.string()),
    nextActionAt: v.union(v.number(), v.null()),
    nextActionNote: v.optional(v.string()),
    outcomeReason: v.optional(v.string()),
    expectedRevision: v.number(),
    reason: v.string(),
    actor: v.string(),
    requestId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), changed: v.boolean(), revision: v.number() }),
    v.object({ ok: v.literal(false), reason: v.literal("not_found") }),
    v.object({ ok: v.literal(false), reason: v.literal("conflict"), currentRevision: v.number() }),
    v.object({ ok: v.literal(false), reason: v.literal("invalid_workflow") }),
  ),
  handler: async (
    ctx,
    {
      ingestSecret,
      leadId,
      status,
      priority,
      owner,
      note,
      nextActionAt,
      nextActionNote,
      outcomeReason,
      expectedRevision,
      reason,
      actor,
      requestId,
    },
  ) => {
    requireIngestSecret(ingestSecret);
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_lead_id", (query) => query.eq("leadId", leadId))
      .unique();
    if (!lead) return { ok: false as const, reason: "not_found" as const };

    const now = Date.now();
    const cleanOwner = owner.trim();
    const cleanNote = note?.trim() ?? "";
    const cleanNextActionNote = nextActionNote?.trim() ?? "";
    const cleanOutcomeReason = outcomeReason?.trim() ?? "";
    const cleanReason = reason.trim();
    const cleanActor = actor.trim() || "Oriental admin";
    const currentRevision = lead.workflowRevision ?? 0;

    if (expectedRevision !== currentRevision) {
      return { ok: false as const, reason: "conflict" as const, currentRevision };
    }
    if (
      validateAdminLeadWorkflow(
        {
          status,
          owner: cleanOwner,
          nextActionAt,
          nextActionNote: cleanNextActionNote,
          outcomeReason: cleanOutcomeReason,
        },
        now,
      ).length > 0
    ) {
      return { ok: false as const, reason: "invalid_workflow" as const };
    }

    const changes = [
      auditChange("status", lead.status, status),
      auditChange("priority", lead.priority ?? "normal", priority),
      auditChange("owner", lead.owner ?? "", cleanOwner),
      ...(cleanNote ? [auditChange("workflowNote", lead.workflowNote ?? "", cleanNote)] : []),
      ...(typeof nextActionAt === "number" ? [auditChange("nextActionAt", lead.nextActionAt, nextActionAt)] : []),
      ...(cleanNextActionNote ? [auditChange("nextActionNote", lead.nextActionNote ?? "", cleanNextActionNote)] : []),
      ...(cleanOutcomeReason ? [auditChange("outcomeReason", lead.outcomeReason ?? "", cleanOutcomeReason)] : []),
    ].filter((change): change is NonNullable<typeof change> => Boolean(change));

    if (changes.length === 0) return { ok: true as const, changed: false, revision: currentRevision };

    const revision = currentRevision + 1;
    await ctx.db.patch(lead._id, {
      status,
      priority,
      owner: cleanOwner,
      ...(cleanNote ? { workflowNote: cleanNote } : {}),
      ...(typeof nextActionAt === "number" ? { nextActionAt } : {}),
      ...(cleanNextActionNote ? { nextActionNote: cleanNextActionNote } : {}),
      ...(cleanOutcomeReason ? { outcomeReason: cleanOutcomeReason } : {}),
      ...(!lead.firstAssignedAt && cleanOwner ? { firstAssignedAt: now } : {}),
      ...(!lead.firstContactedAt && (status === "contacted" || status === "qualified")
        ? { firstContactedAt: now }
        : {}),
      lastReviewedAt: now,
      workflowRevision: revision,
    });
    await ctx.db.insert("leadEvents", {
      leadId,
      kind: "workflow_update",
      actor: cleanActor,
      fromStatus: lead.status,
      toStatus: status,
      note: cleanNote || cleanNextActionNote || cleanReason,
      requestId,
      reason: cleanReason,
      changes,
      createdAt: now,
    });
    return { ok: true as const, changed: true, revision };
  },
});

function auditChange(field: string, before: string | number | undefined, after: string | number | undefined) {
  if (before === after) return null;
  return {
    field,
    ...(typeof before !== "undefined" ? { before: String(before) } : {}),
    ...(typeof after !== "undefined" ? { after: String(after) } : {}),
  };
}

export const bulkAssignLeads = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    leads: v.array(v.object({ leadId: v.string(), expectedRevision: v.number() })),
    owner: v.string(),
    nextActionAt: v.number(),
    nextActionNote: v.string(),
    reason: v.string(),
    actor: v.string(),
    requestId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), count: v.number() }),
    v.object({ ok: v.literal(false), reason: v.literal("not_found"), leadIds: v.array(v.string()) }),
    v.object({ ok: v.literal(false), reason: v.literal("conflict"), leadIds: v.array(v.string()) }),
    v.object({ ok: v.literal(false), reason: v.literal("invalid_workflow"), leadIds: v.array(v.string()) }),
  ),
  handler: async (ctx, { ingestSecret, leads, owner, nextActionAt, nextActionNote, reason, actor, requestId }) => {
    requireIngestSecret(ingestSecret);
    const cleanOwner = owner.trim();
    const cleanNextActionNote = nextActionNote.trim();
    const cleanReason = reason.trim();
    const cleanActor = actor.trim() || "Oriental admin";
    const now = Date.now();

    if (
      leads.length < 1 ||
      leads.length > 50 ||
      !ADMIN_LEAD_OWNERS.includes(cleanOwner as (typeof ADMIN_LEAD_OWNERS)[number]) ||
      !cleanNextActionNote ||
      !cleanReason ||
      nextActionAt < now - 60_000
    ) {
      return { ok: false as const, reason: "invalid_workflow" as const, leadIds: leads.map((lead) => lead.leadId) };
    }

    const records = await Promise.all(
      leads.map(async (target) => ({
        target,
        lead: await ctx.db
          .query("leads")
          .withIndex("by_lead_id", (query) => query.eq("leadId", target.leadId))
          .unique(),
      })),
    );
    const missing = records.filter((record) => !record.lead).map((record) => record.target.leadId);
    if (missing.length > 0) return { ok: false as const, reason: "not_found" as const, leadIds: missing };

    const conflicts = records
      .filter((record) => (record.lead?.workflowRevision ?? 0) !== record.target.expectedRevision)
      .map((record) => record.target.leadId);
    if (conflicts.length > 0) return { ok: false as const, reason: "conflict" as const, leadIds: conflicts };

    const terminal = records
      .filter((record) => record.lead && ["qualified", "archived"].includes(record.lead.status))
      .map((record) => record.target.leadId);
    if (terminal.length > 0) {
      return { ok: false as const, reason: "invalid_workflow" as const, leadIds: terminal };
    }

    for (const record of records) {
      const lead = record.lead;
      if (!lead) continue;
      const revision = (lead.workflowRevision ?? 0) + 1;
      const changes = [
        auditChange("owner", lead.owner ?? "", cleanOwner),
        auditChange("nextActionAt", lead.nextActionAt, nextActionAt),
        auditChange("nextActionNote", lead.nextActionNote ?? "", cleanNextActionNote),
      ].filter((change): change is NonNullable<typeof change> => Boolean(change));
      await ctx.db.patch(lead._id, {
        owner: cleanOwner,
        nextActionAt,
        nextActionNote: cleanNextActionNote,
        ...(!lead.firstAssignedAt ? { firstAssignedAt: now } : {}),
        lastReviewedAt: now,
        workflowRevision: revision,
      });
      await ctx.db.insert("leadEvents", {
        leadId: lead.leadId,
        kind: "workflow_bulk_assignment",
        actor: cleanActor,
        fromStatus: lead.status,
        toStatus: lead.status,
        note: cleanNextActionNote,
        requestId,
        reason: cleanReason,
        changes,
        createdAt: now,
      });
    }

    return { ok: true as const, count: records.length };
  },
});

export const archiveLeads = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    action: v.union(v.literal("archive"), v.literal("restore")),
    leads: v.array(v.object({ leadId: v.string(), expectedRevision: v.number() })),
    reason: v.string(),
    actor: v.string(),
    requestId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), count: v.number() }),
    v.object({ ok: v.literal(false), reason: v.literal("not_found"), leadIds: v.array(v.string()) }),
    v.object({ ok: v.literal(false), reason: v.literal("conflict"), leadIds: v.array(v.string()) }),
    v.object({ ok: v.literal(false), reason: v.literal("invalid_state"), leadIds: v.array(v.string()) }),
  ),
  handler: async (ctx, { ingestSecret, action, leads, reason, actor, requestId }) => {
    requireIngestSecret(ingestSecret);
    const cleanReason = reason.trim();
    const cleanActor = actor.trim() || "Oriental admin";
    if (
      leads.length < 1 ||
      leads.length > 50 ||
      !cleanReason ||
      new Set(leads.map((lead) => lead.leadId)).size !== leads.length
    ) {
      return {
        ok: false as const,
        reason: "invalid_state" as const,
        leadIds: leads.map((lead) => lead.leadId),
      };
    }

    const records = await Promise.all(
      leads.map(async (target) => ({
        target,
        lead: await ctx.db
          .query("leads")
          .withIndex("by_lead_id", (query) => query.eq("leadId", target.leadId))
          .unique(),
      })),
    );
    const missing = records.filter((record) => !record.lead).map((record) => record.target.leadId);
    if (missing.length > 0) return { ok: false as const, reason: "not_found" as const, leadIds: missing };

    const conflicts = records
      .filter((record) => (record.lead?.workflowRevision ?? 0) !== record.target.expectedRevision)
      .map((record) => record.target.leadId);
    if (conflicts.length > 0) return { ok: false as const, reason: "conflict" as const, leadIds: conflicts };

    const invalidState = records
      .filter((record) =>
        action === "archive" ? record.lead?.status === "archived" : record.lead?.status !== "archived",
      )
      .map((record) => record.target.leadId);
    if (invalidState.length > 0) {
      return { ok: false as const, reason: "invalid_state" as const, leadIds: invalidState };
    }

    const now = Date.now();
    for (const record of records) {
      const lead = record.lead;
      if (!lead) continue;
      const revision = (lead.workflowRevision ?? 0) + 1;
      const restoredStatus = restorableStatus(lead.preArchiveStatus);
      const nextStatus = action === "archive" ? "archived" : restoredStatus;
      const changes = [
        auditChange("status", lead.status, nextStatus),
        action === "archive"
          ? auditChange("archivedAt", lead.archivedAt, now)
          : auditChange("restoredAt", lead.restoredAt, now),
      ].filter((change): change is NonNullable<typeof change> => Boolean(change));

      await ctx.db.patch(
        lead._id,
        action === "archive"
          ? {
              status: "archived",
              archivedAt: now,
              archivedBy: cleanActor,
              archiveReason: cleanReason,
              preArchiveStatus: lead.status,
              lastReviewedAt: now,
              workflowRevision: revision,
            }
          : {
              status: restoredStatus,
              restoredAt: now,
              restoredBy: cleanActor,
              lastReviewedAt: now,
              workflowRevision: revision,
            },
      );
      await ctx.db.insert("leadEvents", {
        leadId: lead.leadId,
        kind: action === "archive" ? "workflow_archive" : "workflow_restore",
        actor: cleanActor,
        fromStatus: lead.status,
        toStatus: nextStatus,
        note: cleanReason,
        requestId,
        reason: cleanReason,
        changes,
        createdAt: now,
      });
    }

    return { ok: true as const, count: records.length };
  },
});

function restorableStatus(value: string | undefined): "new" | "reviewing" | "contacted" | "qualified" {
  if (value === "reviewing" || value === "contacted" || value === "qualified") return value;
  return "new";
}

export const recordVoiceSession = mutationGeneric({
  args: { ingestSecret: v.string(), snapshot: voiceSessionValidator },
  returns: v.object({ ok: v.boolean(), id: v.string() }),
  handler: async (ctx, { ingestSecret, snapshot }) => {
    requireIngestSecret(ingestSecret);
    const now = Date.now();
    const existing = await ctx.db
      .query("voiceSessions")
      .withIndex("by_review_id", (query) => query.eq("reviewId", snapshot.reviewId))
      .unique();
    const patch = {
      sessionId: snapshot.sessionId,
      ...(snapshot.conversationId ? { conversationId: snapshot.conversationId } : {}),
      // Heartbeats do not know about a lead until submission. Once linked, an
      // omitted leadId must not erase that durable relationship.
      ...(typeof snapshot.leadId !== "undefined" ? { leadId: snapshot.leadId } : {}),
      segment: snapshot.segment,
      status: snapshot.status,
      connectionStatus: snapshot.connectionStatus,
      ...(snapshot.closeReason ? { closeReason: snapshot.closeReason } : {}),
      ...(snapshot.deviceProfile ? { deviceProfile: snapshot.deviceProfile } : {}),
      ...(snapshot.deploymentEnvironment ? { deploymentEnvironment: snapshot.deploymentEnvironment } : {}),
      ...(typeof snapshot.activationAttempted === "boolean"
        ? { activationAttempted: snapshot.activationAttempted }
        : {}),
      ...(typeof snapshot.prewarmedAt === "number" ? { prewarmedAt: snapshot.prewarmedAt } : {}),
      ...(typeof snapshot.connectStartedAt === "number" ? { connectStartedAt: snapshot.connectStartedAt } : {}),
      ...(typeof snapshot.connectedAt === "number" ? { connectedAt: snapshot.connectedAt } : {}),
      ...(typeof snapshot.firstEventAt === "number" ? { firstEventAt: snapshot.firstEventAt } : {}),
      ...(typeof snapshot.closedAt === "number" ? { closedAt: snapshot.closedAt } : {}),
      captured: snapshot.captured,
      ...(snapshot.emailVerification ? { emailVerification: snapshot.emailVerification } : {}),
      ...(snapshot.emailCaptureMode ? { emailCaptureMode: snapshot.emailCaptureMode } : {}),
      transcript: snapshot.transcript,
      errors: snapshot.errors,
      rateLimits: snapshot.rateLimits,
      routeRequested: snapshot.routeRequested,
      updatedAt: now,
      ...(snapshot.model ? { model: snapshot.model } : {}),
      ...(snapshot.modelCell ? { modelCell: snapshot.modelCell } : {}),
      ...(snapshot.reasoningCell ? { reasoningCell: snapshot.reasoningCell } : {}),
      ...(snapshot.voice ? { voice: snapshot.voice } : {}),
      ...(typeof snapshot.speed === "number" ? { speed: snapshot.speed } : {}),
      ...(typeof snapshot.variant !== "undefined" ? { variant: snapshot.variant } : {}),
      ...(snapshot.runtimeProfile ? { runtimeProfile: snapshot.runtimeProfile } : {}),
      ...(snapshot.inputPolicy ? { inputPolicy: snapshot.inputPolicy } : {}),
      ...(snapshot.usage ? { usage: snapshot.usage } : {}),
      ...(typeof snapshot.submittedAt === "number" ? { submittedAt: snapshot.submittedAt } : {}),
      ...(snapshot.latency ? { latency: snapshot.latency } : {}),
      ...(snapshot.transport ? { transport: snapshot.transport } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true, id: existing.reviewId };
    }
    await ctx.db.insert("voiceSessions", {
      reviewId: snapshot.reviewId,
      ...patch,
      createdAt: now,
    });
    return { ok: true, id: snapshot.reviewId };
  },
});

export const setVoiceSessionFollowUp = mutationGeneric({
  args: { ingestSecret: v.string(), reviewId: v.string(), followedUp: v.boolean() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, { ingestSecret, reviewId, followedUp }) => {
    requireIngestSecret(ingestSecret);
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_review_id", (query) => query.eq("reviewId", reviewId))
      .unique();
    if (!session) return { ok: false, reason: "not_found" };
    await ctx.db.patch(session._id, { followedUpAt: followedUp ? Date.now() : undefined });
    return { ok: true };
  },
});

export const voiceSessionByReviewId = queryGeneric({
  args: { ingestSecret: v.string(), reviewId: v.string() },
  handler: async (ctx, { ingestSecret, reviewId }) => {
    requireIngestSecret(ingestSecret);
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_review_id", (query) => query.eq("reviewId", reviewId))
      .unique();
    return session ?? null;
  },
});

const voiceEvalValidator = v.object({
  reviewId: v.string(),
  routingCorrect: v.number(),
  captureCompleteness: v.number(),
  conversationQuality: v.number(),
  frustration: v.number(),
  summary: v.string(),
  droppedMidTurn: v.boolean(),
  model: v.string(),
});

export const recordVoiceEvals = mutationGeneric({
  args: { ingestSecret: v.string(), evals: v.array(voiceEvalValidator) },
  returns: v.object({ ok: v.boolean(), updated: v.number() }),
  handler: async (ctx, { ingestSecret, evals }) => {
    requireIngestSecret(ingestSecret);
    const evaluatedAt = Date.now();
    let updated = 0;
    for (const entry of evals) {
      const session = await ctx.db
        .query("voiceSessions")
        .withIndex("by_review_id", (query) => query.eq("reviewId", entry.reviewId))
        .unique();
      if (!session) continue;
      const { reviewId: _reviewId, ...score } = entry;
      await ctx.db.patch(session._id, { eval: { ...score, evaluatedAt } });
      updated += 1;
    }
    return { ok: true, updated };
  },
});

export const voiceSessionsForEval = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(limit ?? 50, 1), 200);
    const sessions = await ctx.db.query("voiceSessions").withIndex("by_updated_at").order("desc").take(take);
    return sessions.map((session) => ({
      reviewId: session.reviewId,
      sessionId: session.sessionId,
      conversationId: session.conversationId ?? null,
      segment: session.segment,
      status: session.status,
      connectionStatus: session.connectionStatus,
      closeReason: session.closeReason ?? null,
      deviceProfile: session.deviceProfile ?? null,
      deploymentEnvironment: session.deploymentEnvironment ?? null,
      activationAttempted: session.activationAttempted ?? null,
      leadId: session.leadId ?? null,
      connectStartedAt: session.connectStartedAt ?? null,
      connectedAt: session.connectedAt ?? null,
      firstEventAt: session.firstEventAt ?? null,
      closedAt: session.closedAt ?? null,
      transcript: session.transcript,
      captured: session.captured,
      usage: session.usage ?? null,
      errors: session.errors,
      latency: session.latency ?? null,
      transport: session.transport ?? null,
      runtimeProfile: session.runtimeProfile ?? null,
      inputPolicy: session.inputPolicy ?? null,
      modelCell: session.modelCell ?? null,
      reasoningCell: session.reasoningCell ?? null,
      routeRequested: session.routeRequested,
      submittedAt: session.submittedAt ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  },
});

export const recent = queryGeneric({
  args: { ingestSecret: v.string() },
  handler: async (ctx, { ingestSecret }) => {
    requireIngestSecret(ingestSecret);

    return await ctx.db.query("leads").order("desc").take(20);
  },
});

export const leadsForClickUpBackfill = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 500), 1), 1000);
    return await ctx.db.query("leads").order("desc").take(take);
  },
});

export const adminLeadTable = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 500), 1), 1000);
    return await ctx.db.query("leads").order("desc").take(take);
  },
});

export const reviewDashboard = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 50), 1), 100);
    const now = Date.now();
    const [leads, voiceSessions, leadEvents] = await Promise.all([
      ctx.db.query("leads").order("desc").take(take),
      ctx.db.query("voiceSessions").withIndex("by_updated_at").order("desc").take(take),
      ctx.db
        .query("leadEvents")
        .order("desc")
        .take(take * 2),
    ]);
    const notificationDelivered = leads.filter((lead) => lead.notificationDelivered === true).length;
    const notificationFailures = leads.filter((lead) => lead.notificationDelivered === false).length;
    const voiceLeads = leads.filter((lead) => lead.source === "voice").length;
    const activeLeads = leads.filter((lead) => !["qualified", "archived"].includes(lead.status)).length;
    const urgentLeads = leads.filter((lead) => lead.priority === "urgent" || lead.priority === "high").length;
    const sessionsWithErrors = voiceSessions.filter((session) => session.errors.length > 0).length;
    const prewarmedSessions = voiceSessions.filter((session) => typeof session.prewarmedAt === "number").length;
    const connectedSessions = voiceSessions.filter((session) => typeof session.connectedAt === "number").length;
    const engagedSessions = voiceSessions.filter(isEngagedVoiceSession);
    const submittedSessions = voiceSessions.filter((session) => Boolean(session.leadId)).length;
    const totalResponseTokens = voiceSessions.reduce((sum, session) => sum + (session.usage?.responseTokens ?? 0), 0);
    const voiceLatency = summarizeVoiceLatency(voiceSessions);
    const evaluatedSessions = voiceSessions.filter((session) => session.eval);
    const evalAverages = averageEvalScores(evaluatedSessions);
    const droppedMidTurnEvals = evaluatedSessions.filter((session) => session.eval?.droppedMidTurn).length;
    return {
      generatedAt: now,
      leads,
      voiceSessions: voiceSessions.map(toVoiceSessionSummary),
      leadEvents,
      metrics: {
        recentLeads: leads.length,
        activeLeads,
        voiceLeads,
        notificationFailures,
        urgentLeads,
        qualifiedLeads: leads.filter((lead) => lead.status === "qualified").length,
        reviewedSessions: voiceSessions.length,
        prewarmedSessions,
        engagedSessions: engagedSessions.length,
        connectedSessions,
        sessionsWithErrors,
        submittedSessions,
        notificationDeliveryRate: percent(notificationDelivered, leads.length),
        voiceSubmitRate: percent(submittedSessions, engagedSessions.length || voiceSessions.length),
      },
      analytics: {
        sourceCounts: countBy(leads, (lead) => lead.source),
        statusCounts: countBy(leads, (lead) => lead.status || "new"),
        priorityCounts: countBy(leads, (lead) => lead.priority || "normal"),
        segmentCounts: countBy(leads, (lead) => lead.segment || "other"),
        dailyLeads: dailyLeadCounts(leads, now),
        notification: {
          delivered: notificationDelivered,
          failed: notificationFailures,
          pending: Math.max(leads.length - notificationDelivered - notificationFailures, 0),
        },
        voice: {
          sessions: voiceSessions.length,
          prewarmed: prewarmedSessions,
          engaged: engagedSessions.length,
          connected: connectedSessions,
          submitted: submittedSessions,
          withErrors: sessionsWithErrors,
          routeRequested: voiceSessions.filter((session) => session.routeRequested).length,
          totalResponseTokens,
          latency: voiceLatency,
        },
        evals: {
          evaluated: evaluatedSessions.length,
          droppedMidTurn: droppedMidTurnEvals,
          averages: evalAverages,
          trend: evalTrend(evaluatedSessions),
          attention: evaluatedSessions
            .filter(
              (session) =>
                session.eval &&
                (session.eval.frustration >= 4 || session.eval.conversationQuality <= 2 || session.eval.droppedMidTurn),
            )
            .slice(0, 20)
            .map((session) => ({ reviewId: session.reviewId, segment: session.segment, ...session.eval })),
        },
      },
      queues: {
        triage: leads.filter((lead) => ["new", "reviewing"].includes(lead.status)).slice(0, 20),
        failedNotifications: leads.filter((lead) => lead.notificationDelivered === false).slice(0, 20),
        highPriority: leads.filter((lead) => lead.priority === "urgent" || lead.priority === "high").slice(0, 20),
      },
    };
  },
});

function toVoiceSessionSummary<T extends { transcript: Array<{ role: string; text: string }> }>(session: T) {
  return {
    ...session,
    transcript: [],
    transcriptTurnCount: session.transcript.length,
    transcriptRoles: countTranscriptRoles(session.transcript),
  };
}

function countTranscriptRoles(transcript: Array<{ role: string }>) {
  return transcript.reduce(
    (counts, turn) => {
      if (turn.role === "assistant") counts.assistant += 1;
      else if (turn.role === "system") counts.system += 1;
      else counts.user += 1;
      return counts;
    },
    { user: 0, assistant: 0, system: 0 },
  );
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function dailyLeadCounts(leads: Array<{ createdAt: number }>, now: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = now - (6 - index) * 24 * 60 * 60 * 1000;
    return formatter.format(date);
  });
  const counts = countBy(leads, (lead) => formatter.format(lead.createdAt));
  return days.map((date) => ({ date, count: counts[date] ?? 0 }));
}

function isEngagedVoiceSession(session: {
  leadId?: string | null;
  connectStartedAt?: number;
  connectedAt?: number;
  closedAt?: number;
  transcript: Array<unknown>;
  captured: { email: string; message: string };
}) {
  return Boolean(
    session.leadId ||
      typeof session.connectStartedAt === "number" ||
      typeof session.connectedAt === "number" ||
      typeof session.closedAt === "number" ||
      session.transcript.length > 0 ||
      session.captured.email.trim() ||
      session.captured.message.trim(),
  );
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

type LatencySession = {
  latency?: {
    activation?: { tapToArmCueScheduledMs?: number; tapToLiveMs?: number };
    turns: Array<{
      stopToResponseCreatedMs?: number;
      stopToFirstOutputEventMs?: number;
      stopToRemoteAudioMs?: number;
      localSpeechEndToSpeechStoppedMs?: number;
      firstOutputEventToRemoteAudioMs?: number;
      toolDurationMs?: number;
      bargeInToResponseDoneMs?: number;
      interrupted: boolean;
      rapidResume: boolean;
    }>;
  };
};

function summarizeVoiceLatency(sessions: LatencySession[]) {
  const turns = sessions.flatMap((session) => session.latency?.turns ?? []);
  const firstOutput = turns.flatMap((turn) =>
    typeof turn.stopToFirstOutputEventMs === "number" ? [turn.stopToFirstOutputEventMs] : [],
  );
  const responseCreated = turns.flatMap((turn) =>
    typeof turn.stopToResponseCreatedMs === "number" ? [turn.stopToResponseCreatedMs] : [],
  );
  const remoteAudio = turns.flatMap((turn) =>
    typeof turn.stopToRemoteAudioMs === "number" ? [turn.stopToRemoteAudioMs] : [],
  );
  const endpoint = turns.flatMap((turn) =>
    typeof turn.localSpeechEndToSpeechStoppedMs === "number" ? [turn.localSpeechEndToSpeechStoppedMs] : [],
  );
  const playout = turns.flatMap((turn) =>
    typeof turn.firstOutputEventToRemoteAudioMs === "number" ? [turn.firstOutputEventToRemoteAudioMs] : [],
  );
  const bargeIn = turns.flatMap((turn) =>
    typeof turn.bargeInToResponseDoneMs === "number" ? [turn.bargeInToResponseDoneMs] : [],
  );
  const tool = turns.flatMap((turn) => (typeof turn.toolDurationMs === "number" ? [turn.toolDurationMs] : []));
  const activation = sessions.flatMap((session) =>
    typeof session.latency?.activation?.tapToArmCueScheduledMs === "number"
      ? [session.latency.activation.tapToArmCueScheduledMs]
      : [],
  );
  const tapToLive = sessions.flatMap((session) =>
    typeof session.latency?.activation?.tapToLiveMs === "number" ? [session.latency.activation.tapToLiveMs] : [],
  );
  return {
    sampledTurns: turns.length,
    firstOutput: percentileSummary(firstOutput),
    responseCreated: percentileSummary(responseCreated),
    remoteAudio: percentileSummary(remoteAudio),
    endpoint: percentileSummary(endpoint),
    playout: percentileSummary(playout),
    tool: percentileSummary(tool),
    bargeIn: percentileSummary(bargeIn),
    activation: percentileSummary(activation),
    tapToLive: percentileSummary(tapToLive),
    interruptedTurns: turns.filter((turn) => turn.interrupted).length,
    rapidResumeTurns: turns.filter((turn) => turn.rapidResume).length,
  };
}

function percentileSummary(values: number[]) {
  if (values.length === 0) return { samples: 0, p50Ms: null, p95Ms: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function percentile(sorted: number[], quantile: number) {
  const index = Math.min(Math.max(Math.ceil(sorted.length * quantile) - 1, 0), sorted.length - 1);
  return Math.round(sorted[index] ?? 0);
}

type EvaluatedSession = {
  createdAt: number;
  eval?: {
    routingCorrect: number;
    captureCompleteness: number;
    conversationQuality: number;
    frustration: number;
    droppedMidTurn: boolean;
  };
};

const roundScore = (value: number) => Math.round(value * 100) / 100;

function averageEvalScores(sessions: EvaluatedSession[]) {
  const scored = sessions.filter((session) => session.eval);
  if (scored.length === 0) return null;
  const sum = (pick: (evaluation: NonNullable<EvaluatedSession["eval"]>) => number) =>
    roundScore(
      scored.reduce((total, session) => total + pick(session.eval as NonNullable<EvaluatedSession["eval"]>), 0) /
        scored.length,
    );
  return {
    routingCorrect: sum((evaluation) => evaluation.routingCorrect),
    captureCompleteness: sum((evaluation) => evaluation.captureCompleteness),
    conversationQuality: sum((evaluation) => evaluation.conversationQuality),
    frustration: sum((evaluation) => evaluation.frustration),
  };
}

// Bucket evaluated sessions by their session date so quality can be tracked
// chronologically as Reka is iterated on.
function bucketEvalAverages(sessions: EvaluatedSession[], keyOf: (createdAt: number) => string) {
  const groups = new Map<string, EvaluatedSession[]>();
  for (const session of sessions) {
    if (!session.eval) continue;
    const key = keyOf(session.createdAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(session);
    else groups.set(key, [session]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      count: items.length,
      droppedMidTurn: items.filter((session) => session.eval?.droppedMidTurn).length,
      averages: averageEvalScores(items),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function evalTrend(sessions: EvaluatedSession[]) {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  return {
    daily: bucketEvalAverages(sessions, (createdAt) => dayFormatter.format(createdAt)),
    weekly: bucketEvalAverages(sessions, isoWeekKey),
  };
}

// ISO-8601 week label (e.g. 2026-W28), computed in UTC — adequate for a weekly
// quality trend.
function isoWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
