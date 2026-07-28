import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { summarizeAdminLeads } from "../lib/admin-lead-counts";
import { ADMIN_ACTIVE_LEAD_STATUSES, ADMIN_LEAD_OWNERS, validateAdminLeadWorkflow } from "../lib/admin-workflow";
import { boundTranscript, normalizeStoredEmail } from "../lib/data-payload";
import {
  archivedLeadRetentionExpiresAt,
  leadTranscriptRetentionExpiresAt,
  RETENTION_BATCH_LIMITS,
  voiceRetentionExpiresAt,
} from "../lib/data-retention";
import { summarizeIntakeAttribution } from "../lib/intake-attribution-analytics";
import { isVoiceAvailabilityFailure } from "../lib/voice/realtime-call-failure";
import { MIN_ORPHAN_STALE_MS } from "../lib/voice/session-policy";
import { isEngagedVoiceCaptureSession, summarizeVoiceCaptureFunnel } from "../lib/voice-capture-analytics";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

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

const entryPointValidator = v.union(
  v.literal("hero_primary"),
  v.literal("hero_updates"),
  v.literal("hero_updates_followup"),
  v.literal("nav_desktop"),
  v.literal("nav_mobile"),
  v.literal("keyboard_shortcut"),
  v.literal("voice_rail"),
  v.literal("ecosystem"),
  v.literal("facilities"),
  v.literal("partners"),
  v.literal("closing_cta"),
  v.literal("footer_cta"),
  v.literal("faq_cta"),
  v.literal("unknown"),
);
const entryMethodValidator = v.union(
  v.literal("voice_button"),
  v.literal("form"),
  v.literal("email_capture"),
  v.literal("unknown"),
);

const fieldInputValidator = v.union(v.literal("voice"), v.literal("form"), v.literal("chat"), v.literal("prefill"));
const fieldCompletionValidator = v.union(fieldInputValidator, v.literal("mixed"), v.literal("unknown"));
const fieldProvenanceEntryValidator = v.object({
  method: fieldCompletionValidator,
  lastInput: v.optional(fieldInputValidator),
  editCount: v.number(),
  correctionCount: v.number(),
  clearCount: v.number(),
});
const fieldProvenanceValidator = v.object({
  name: fieldProvenanceEntryValidator,
  email: fieldProvenanceEntryValidator,
  org: fieldProvenanceEntryValidator,
  phone: fieldProvenanceEntryValidator,
  website: fieldProvenanceEntryValidator,
  message: fieldProvenanceEntryValidator,
});

const leadValidator = v.object({
  id: v.string(),
  source: v.union(v.literal("voice"), v.literal("form"), v.literal("hero-email")),
  entryPoint: v.optional(entryPointValidator),
  entryMethod: v.optional(entryMethodValidator),
  submissionMethod: v.optional(
    v.union(v.literal("handoff_button"), v.literal("voice_command"), v.literal("email_capture_button")),
  ),
  fieldProvenance: v.optional(fieldProvenanceValidator),
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
  confidence: v.optional(v.union(v.literal("high"), v.literal("medium"))),
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
          v.literal("clear_fields"),
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
  snapshotSequence: v.optional(v.number()),
  conversationId: v.optional(v.string()),
  leadId: v.optional(v.union(v.string(), v.null())),
  segment: v.string(),
  status: v.string(),
  connectionStatus: v.string(),
  closeReason: v.optional(v.string()),
  deviceProfile: v.optional(v.union(v.literal("mobile"), v.literal("desktop"))),
  deploymentEnvironment: v.optional(v.union(v.literal("local"), v.literal("staging"), v.literal("production"))),
  activationAttempted: v.optional(v.boolean()),
  entryPoint: v.optional(entryPointValidator),
  entryMethod: v.optional(entryMethodValidator),
  submissionMethod: v.optional(
    v.union(v.literal("handoff_button"), v.literal("voice_command"), v.literal("email_capture_button")),
  ),
  fieldProvenance: v.optional(fieldProvenanceValidator),
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

    // The web adapter may retry once after a forward-field validator mismatch.
    // A committed response can also be lost in transit, so make the insert
    // idempotent on the application-generated UUID before writing either row.
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_lead_id", (query) => query.eq("leadId", lead.id))
      .first();
    if (existing) return { id: existing.leadId };

    const createdAt = Date.now();
    const transcript = boundTranscript(lead.transcript);
    await ctx.db.insert("leads", {
      leadId: lead.id,
      source: lead.source,
      ...(lead.entryPoint ? { entryPoint: lead.entryPoint } : {}),
      ...(lead.entryMethod ? { entryMethod: lead.entryMethod } : {}),
      ...(lead.submissionMethod ? { submissionMethod: lead.submissionMethod } : {}),
      ...(lead.fieldProvenance ? { fieldProvenance: lead.fieldProvenance } : {}),
      segment: lead.segment,
      routedTo: lead.routedTo,
      routedToEmail: lead.routedToEmail ?? null,
      name: lead.form.name,
      email: normalizeStoredEmail(lead.form.email),
      emailNormalized: normalizeStoredEmail(lead.form.email),
      org: lead.form.org,
      phone: lead.form.phone,
      website: lead.form.website,
      message: lead.form.message,
      transcript,
      ...(transcript.length > 0
        ? { hasRetainedTranscript: true, transcriptRetentionExpiresAt: leadTranscriptRetentionExpiresAt(createdAt) }
        : {}),
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
      payloadSafe: true,
      createdAt,
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
    slackMessageId: v.optional(v.string()),
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
      slackMessageId,
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
      ...(slackMessageId?.trim() ? { notificationSlackMessageId: slackMessageId.trim() } : {}),
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
    v.object({ ok: v.literal(false), reason: v.literal("archive_boundary") }),
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

    if (status === "archived" || lead.status === "archived") {
      return { ok: false as const, reason: "archive_boundary" as const };
    }

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
              retentionExpiresAt: archivedLeadRetentionExpiresAt(now),
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
              retentionExpiresAt: undefined,
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
  returns: v.object({ ok: v.boolean(), id: v.string(), applied: v.boolean(), autoEvalQueued: v.boolean() }),
  handler: async (ctx, { ingestSecret, snapshot }) => {
    requireIngestSecret(ingestSecret);
    const now = Date.now();
    const existing = await ctx.db
      .query("voiceSessions")
      .withIndex("by_review_id", (query) => query.eq("reviewId", snapshot.reviewId))
      .unique();
    if (
      existing &&
      typeof existing.snapshotSequence === "number" &&
      (typeof snapshot.snapshotSequence !== "number" || snapshot.snapshotSequence <= existing.snapshotSequence)
    ) {
      return { ok: true, id: existing.reviewId, applied: false, autoEvalQueued: false };
    }

    const transcript = boundTranscript(snapshot.transcript);
    const captured = {
      ...snapshot.captured,
      email: normalizeStoredEmail(snapshot.captured.email),
    };
    const linkedLeadId =
      typeof existing?.leadId === "string" && existing.leadId
        ? existing.leadId
        : typeof snapshot.leadId === "string" && snapshot.leadId
          ? snapshot.leadId
          : (existing?.leadId ?? snapshot.leadId);
    const submitted = existing?.status === "submitted" || snapshot.status === "submitted" || Boolean(linkedLeadId);
    const submittedAt = existing?.submittedAt ?? snapshot.submittedAt;
    const connectedAt = existing?.connectedAt ?? snapshot.connectedAt;
    const closedAt = Math.max(existing?.closedAt ?? 0, snapshot.closedAt ?? 0) || undefined;
    const sessionState = closedAt ? "closed" : connectedAt ? "connected_open" : "preconnected";
    const shouldQueueAutoEval = Boolean(!existing?.autoEvalQueuedAt && snapshot.closeReason && transcript.length > 0);
    const createdAt = existing?.createdAt ?? now;
    const patch = {
      sessionId: snapshot.sessionId,
      ...(typeof snapshot.snapshotSequence === "number" ? { snapshotSequence: snapshot.snapshotSequence } : {}),
      ...(snapshot.conversationId ? { conversationId: snapshot.conversationId } : {}),
      // Heartbeats do not know about a lead until submission. Once linked, an
      // omitted leadId must not erase that durable relationship.
      ...(typeof linkedLeadId !== "undefined" ? { leadId: linkedLeadId } : {}),
      segment: snapshot.segment,
      status: submitted ? "submitted" : snapshot.status,
      connectionStatus: snapshot.connectionStatus,
      sessionState,
      ...(snapshot.closeReason ? { closeReason: snapshot.closeReason } : {}),
      ...(snapshot.deviceProfile ? { deviceProfile: snapshot.deviceProfile } : {}),
      ...(snapshot.deploymentEnvironment ? { deploymentEnvironment: snapshot.deploymentEnvironment } : {}),
      ...(typeof snapshot.activationAttempted === "boolean"
        ? { activationAttempted: snapshot.activationAttempted }
        : {}),
      ...(snapshot.entryPoint ? { entryPoint: snapshot.entryPoint } : {}),
      ...(snapshot.entryMethod ? { entryMethod: snapshot.entryMethod } : {}),
      ...(snapshot.submissionMethod ? { submissionMethod: snapshot.submissionMethod } : {}),
      ...(snapshot.fieldProvenance ? { fieldProvenance: snapshot.fieldProvenance } : {}),
      ...(typeof snapshot.prewarmedAt === "number" ? { prewarmedAt: snapshot.prewarmedAt } : {}),
      ...(typeof snapshot.connectStartedAt === "number" ? { connectStartedAt: snapshot.connectStartedAt } : {}),
      ...(typeof connectedAt === "number" ? { connectedAt } : {}),
      ...(typeof snapshot.firstEventAt === "number" ? { firstEventAt: snapshot.firstEventAt } : {}),
      ...(typeof closedAt === "number" ? { closedAt } : {}),
      captured,
      capturedEmailNormalized: captured.email,
      ...(snapshot.emailVerification ? { emailVerification: snapshot.emailVerification } : {}),
      ...(snapshot.emailCaptureMode ? { emailCaptureMode: snapshot.emailCaptureMode } : {}),
      transcript,
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
      ...(typeof submittedAt === "number" ? { submittedAt } : {}),
      ...(snapshot.latency ? { latency: snapshot.latency } : {}),
      ...(snapshot.transport ? { transport: snapshot.transport } : {}),
      ...(shouldQueueAutoEval ? { autoEvalQueuedAt: now } : {}),
      retentionExpiresAt: voiceRetentionExpiresAt({
        createdAt,
        ...(typeof submittedAt === "number" ? { submittedAt } : {}),
        ...(typeof closedAt === "number" ? { closedAt } : {}),
        linked: submitted,
      }),
      payloadSafe: true,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true, id: existing.reviewId, applied: true, autoEvalQueued: shouldQueueAutoEval };
    }
    await ctx.db.insert("voiceSessions", {
      reviewId: snapshot.reviewId,
      ...patch,
      createdAt,
    });
    return { ok: true, id: snapshot.reviewId, applied: true, autoEvalQueued: shouldQueueAutoEval };
  },
});

export const applyDataRetention = mutation({
  args: { ingestSecret: v.string(), now: v.number() },
  returns: v.object({
    deleted: v.object({ archivedLeads: v.number(), leadEvents: v.number(), voiceSessions: v.number() }),
    redacted: v.object({ leadTranscripts: v.number() }),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { ingestSecret, now }) => {
    requireIngestSecret(ingestSecret);
    let voiceSessions = 0;
    let archivedLeads = 0;
    let leadEvents = 0;
    let leadTranscripts = 0;
    let hasMore = false;

    // Backfill only a handful of legacy documents per mutation. Queries used by
    // the live dashboard stay byte-safe while old near-limit documents are
    // normalized and assigned an indexed expiry over successive nightly calls.
    const legacyVoice = await ctx.db
      .query("voiceSessions")
      .withIndex("by_payload_safe_updated_at", (query) => query.eq("payloadSafe", undefined))
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.legacyVoiceSessions + 1);
    if (legacyVoice.length > RETENTION_BATCH_LIMITS.legacyVoiceSessions) hasMore = true;
    for (const session of legacyVoice.slice(0, RETENTION_BATCH_LIMITS.legacyVoiceSessions)) {
      const capturedEmailNormalized = normalizeStoredEmail(session.captured.email);
      await ctx.db.patch(session._id, {
        captured: { ...session.captured, email: capturedEmailNormalized },
        capturedEmailNormalized,
        transcript: boundTranscript(session.transcript),
        payloadSafe: true,
        sessionState: session.closedAt ? "closed" : session.connectedAt ? "connected_open" : "preconnected",
        retentionExpiresAt: voiceRetentionExpiresAt({
          createdAt: session.createdAt,
          ...(typeof session.submittedAt === "number" ? { submittedAt: session.submittedAt } : {}),
          ...(typeof session.closedAt === "number" ? { closedAt: session.closedAt } : {}),
          linked: session.status === "submitted" || Boolean(session.leadId),
        }),
      });
    }

    const legacyVoiceState = await ctx.db
      .query("voiceSessions")
      .withIndex("by_safe_session_state_updated_at", (query) =>
        query.eq("payloadSafe", true).eq("sessionState", undefined),
      )
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.legacyVoiceSessions + 1);
    if (legacyVoiceState.length > RETENTION_BATCH_LIMITS.legacyVoiceSessions) hasMore = true;
    for (const session of legacyVoiceState.slice(0, RETENTION_BATCH_LIMITS.legacyVoiceSessions)) {
      await ctx.db.patch(session._id, {
        sessionState: session.closedAt ? "closed" : session.connectedAt ? "connected_open" : "preconnected",
        retentionExpiresAt: voiceRetentionExpiresAt({
          createdAt: session.createdAt,
          ...(typeof session.submittedAt === "number" ? { submittedAt: session.submittedAt } : {}),
          ...(typeof session.closedAt === "number" ? { closedAt: session.closedAt } : {}),
          linked: session.status === "submitted" || Boolean(session.leadId),
        }),
      });
    }

    const legacyLeads = await ctx.db
      .query("leads")
      .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", undefined))
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.legacyLeads + 1);
    if (legacyLeads.length > RETENTION_BATCH_LIMITS.legacyLeads) hasMore = true;
    for (const lead of legacyLeads.slice(0, RETENTION_BATCH_LIMITS.legacyLeads)) {
      const transcript = boundTranscript(lead.transcript);
      await ctx.db.patch(lead._id, {
        email: normalizeStoredEmail(lead.email),
        emailNormalized: normalizeStoredEmail(lead.email),
        transcript,
        payloadSafe: true,
        ...(transcript.length > 0 && typeof lead.transcriptRetentionExpiresAt !== "number"
          ? {
              hasRetainedTranscript: true,
              transcriptRetentionExpiresAt: leadTranscriptRetentionExpiresAt(lead.createdAt),
            }
          : {}),
        ...(lead.status === "archived" && typeof lead.retentionExpiresAt !== "number"
          ? { retentionExpiresAt: archivedLeadRetentionExpiresAt(lead.archivedAt ?? lead.createdAt) }
          : {}),
      });
    }

    const expiredVoice = await ctx.db
      .query("voiceSessions")
      .withIndex("by_safe_retention_expires_at", (query) =>
        query.eq("payloadSafe", true).lte("retentionExpiresAt", now),
      )
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.expiredVoiceSessions + 1);
    if (expiredVoice.length > RETENTION_BATCH_LIMITS.expiredVoiceSessions) hasMore = true;
    const deletedVoiceIds = new Set<string>();
    for (const session of expiredVoice.slice(0, RETENTION_BATCH_LIMITS.expiredVoiceSessions)) {
      await ctx.db.delete(session._id);
      deletedVoiceIds.add(String(session._id));
      voiceSessions += 1;
    }

    const expiredTranscripts = await ctx.db
      .query("leads")
      .withIndex("by_retained_transcript_expires_at", (query) =>
        query.eq("hasRetainedTranscript", true).lte("transcriptRetentionExpiresAt", now),
      )
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.expiredLeadTranscripts + 1);
    if (expiredTranscripts.length > RETENTION_BATCH_LIMITS.expiredLeadTranscripts) hasMore = true;
    for (const lead of expiredTranscripts.slice(0, RETENTION_BATCH_LIMITS.expiredLeadTranscripts)) {
      await ctx.db.patch(lead._id, {
        transcript: [],
        hasRetainedTranscript: false,
        transcriptRetentionExpiresAt: undefined,
      });
      leadTranscripts += 1;
    }

    const expiredLeads = await ctx.db
      .query("leads")
      .withIndex("by_safe_status_retention_expires_at", (query) =>
        query.eq("payloadSafe", true).eq("status", "archived").lte("retentionExpiresAt", now),
      )
      .order("asc")
      .take(RETENTION_BATCH_LIMITS.archivedLeads + 1);
    if (expiredLeads.length > RETENTION_BATCH_LIMITS.archivedLeads) hasMore = true;
    for (const lead of expiredLeads.slice(0, RETENTION_BATCH_LIMITS.archivedLeads)) {
      const relatedLimit = RETENTION_BATCH_LIMITS.relatedRecordsPerLead;
      const [events, sessions] = await Promise.all([
        ctx.db
          .query("leadEvents")
          .withIndex("by_lead", (query) => query.eq("leadId", lead.leadId))
          .take(relatedLimit + 1),
        ctx.db
          .query("voiceSessions")
          .withIndex("by_lead_updated_at", (query) => query.eq("leadId", lead.leadId))
          .take(relatedLimit + 1),
      ]);
      for (const event of events.slice(0, relatedLimit)) {
        await ctx.db.delete(event._id);
        leadEvents += 1;
      }
      for (const session of sessions.slice(0, relatedLimit)) {
        await ctx.db.delete(session._id);
        voiceSessions += 1;
      }
      if (events.length > relatedLimit || sessions.length > relatedLimit) {
        hasMore = true;
        continue;
      }
      await ctx.db.delete(lead._id);
      archivedLeads += 1;
    }

    return {
      deleted: { archivedLeads, leadEvents, voiceSessions },
      redacted: { leadTranscripts },
      hasMore,
    };
  },
});

/**
 * Release migration for the materialized voice-session lifecycle index.
 * It changes only sessionState on already payload-safe rows. Unsafe legacy
 * payload normalization and retention scheduling remain separately governed by
 * applyDataRetention; the release verifier blocks while any such row exists.
 */
export const backfillVoiceSessionLifecycle = mutation({
  args: { ingestSecret: v.string(), limit: v.number() },
  returns: v.object({ updated: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit), 1), RETENTION_BATCH_LIMITS.legacyVoiceSessions);
    const legacyStates = await ctx.db
      .query("voiceSessions")
      .withIndex("by_safe_session_state_updated_at", (query) =>
        query.eq("payloadSafe", true).eq("sessionState", undefined),
      )
      .order("asc")
      .take(take + 1);

    let updated = 0;
    for (const session of legacyStates.slice(0, take)) {
      await ctx.db.patch(session._id, {
        sessionState: session.closedAt ? "closed" : session.connectedAt ? "connected_open" : "preconnected",
      });
      updated += 1;
    }

    return {
      updated,
      hasMore: legacyStates.length > take,
    };
  },
});

export const normalizeLegacyPrivacyEmails = mutationGeneric({
  args: { ingestSecret: v.string() },
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx, { ingestSecret }) => {
    requireIngestSecret(ingestSecret);
    const [leads, sessions] = await Promise.all([
      ctx.db
        .query("leads")
        .withIndex("by_email_normalized", (query) => query.eq("emailNormalized", undefined))
        .order("asc")
        .take(RETENTION_BATCH_LIMITS.legacyLeads + 1),
      ctx.db
        .query("voiceSessions")
        .withIndex("by_captured_email_normalized", (query) => query.eq("capturedEmailNormalized", undefined))
        .order("asc")
        .take(RETENTION_BATCH_LIMITS.legacyVoiceSessions + 1),
    ]);
    for (const lead of leads.slice(0, RETENTION_BATCH_LIMITS.legacyLeads)) {
      const emailNormalized = normalizeStoredEmail(lead.email);
      const transcript = boundTranscript(lead.transcript);
      await ctx.db.patch(lead._id, {
        email: emailNormalized,
        emailNormalized,
        transcript,
        payloadSafe: true,
        ...(transcript.length > 0
          ? {
              hasRetainedTranscript: true,
              transcriptRetentionExpiresAt:
                lead.transcriptRetentionExpiresAt ?? leadTranscriptRetentionExpiresAt(lead.createdAt),
            }
          : {}),
        ...(lead.status === "archived"
          ? {
              retentionExpiresAt:
                lead.retentionExpiresAt ?? archivedLeadRetentionExpiresAt(lead.archivedAt ?? lead.createdAt),
            }
          : {}),
      });
    }
    for (const session of sessions.slice(0, RETENTION_BATCH_LIMITS.legacyVoiceSessions)) {
      const capturedEmailNormalized = normalizeStoredEmail(session.captured.email);
      await ctx.db.patch(session._id, {
        captured: { ...session.captured, email: capturedEmailNormalized },
        capturedEmailNormalized,
        transcript: boundTranscript(session.transcript),
        payloadSafe: true,
        retentionExpiresAt:
          session.retentionExpiresAt ??
          voiceRetentionExpiresAt({
            createdAt: session.createdAt,
            ...(typeof session.submittedAt === "number" ? { submittedAt: session.submittedAt } : {}),
            ...(typeof session.closedAt === "number" ? { closedAt: session.closedAt } : {}),
            linked: session.status === "submitted" || Boolean(session.leadId),
          }),
      });
    }
    return {
      complete:
        leads.length <= RETENTION_BATCH_LIMITS.legacyLeads &&
        sessions.length <= RETENTION_BATCH_LIMITS.legacyVoiceSessions,
    };
  },
});

export const privacyDeletionPlanByEmail = queryGeneric({
  args: { ingestSecret: v.string(), email: v.string() },
  returns: v.object({
    leads: v.array(
      v.object({
        leadId: v.string(),
        notificationEmailOk: v.boolean(),
        notificationConfirmationOk: v.boolean(),
        notificationSlackOk: v.boolean(),
        notificationSlackMessageId: v.optional(v.string()),
        notificationClickUpOk: v.boolean(),
        notificationClickUpTaskId: v.optional(v.string()),
      }),
    ),
    complete: v.boolean(),
  }),
  handler: async (ctx, { ingestSecret, email }) => {
    requireIngestSecret(ingestSecret);
    const normalized = normalizeStoredEmail(email);
    const matchLimit = RETENTION_BATCH_LIMITS.privacyMatches;
    const [leads, legacyLead, legacySession] = await Promise.all([
      ctx.db
        .query("leads")
        .withIndex("by_email_normalized", (query) => query.eq("emailNormalized", normalized))
        .take(matchLimit + 1),
      ctx.db
        .query("leads")
        .withIndex("by_email_normalized", (query) => query.eq("emailNormalized", undefined))
        .first(),
      ctx.db
        .query("voiceSessions")
        .withIndex("by_captured_email_normalized", (query) => query.eq("capturedEmailNormalized", undefined))
        .first(),
    ]);
    return {
      leads: leads.slice(0, matchLimit).map((lead) => ({
        leadId: lead.leadId,
        notificationEmailOk: lead.notificationEmailOk === true,
        notificationConfirmationOk: lead.notificationConfirmationOk === true,
        notificationSlackOk: lead.notificationSlackOk === true,
        ...(lead.notificationSlackMessageId ? { notificationSlackMessageId: lead.notificationSlackMessageId } : {}),
        notificationClickUpOk: lead.notificationClickUpOk === true,
        ...(lead.notificationClickUpTaskId ? { notificationClickUpTaskId: lead.notificationClickUpTaskId } : {}),
      })),
      complete: leads.length <= matchLimit && !legacyLead && !legacySession,
    };
  },
});

export const deletePersonalData = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    email: v.string(),
    reason: v.union(
      v.literal("data_subject_request"),
      v.literal("consent_withdrawn"),
      v.literal("operator_correction"),
    ),
    requestId: v.string(),
    actor: v.string(),
    downstreamCleanupComplete: v.boolean(),
  },
  returns: v.object({
    deleted: v.object({ leads: v.number(), leadEvents: v.number(), voiceSessions: v.number() }),
    complete: v.boolean(),
  }),
  handler: async (ctx, { ingestSecret, email, reason, requestId, actor, downstreamCleanupComplete }) => {
    requireIngestSecret(ingestSecret);
    const relatedLimit = RETENTION_BATCH_LIMITS.relatedRecordsPerLead;
    let deletedLeads = 0;
    let deletedLeadEvents = 0;
    let deletedVoiceSessions = 0;
    let complete = downstreamCleanupComplete;
    const deletedVoiceIds = new Set<string>();

    const normalized = normalizeStoredEmail(email);
    const [legacyLead, legacySession] = await Promise.all([
      ctx.db
        .query("leads")
        .withIndex("by_email_normalized", (query) => query.eq("emailNormalized", undefined))
        .first(),
      ctx.db
        .query("voiceSessions")
        .withIndex("by_captured_email_normalized", (query) => query.eq("capturedEmailNormalized", undefined))
        .first(),
    ]);
    if (legacyLead || legacySession) complete = false;
    if (!complete) {
      await ctx.db.insert("privacyEvents", {
        requestId,
        reason,
        actor,
        deletedLeads: 0,
        deletedVoiceSessions: 0,
        deletedLeadEvents: 0,
        downstreamCleanupComplete,
        completed: false,
        createdAt: Date.now(),
      });
      return {
        deleted: { leads: 0, leadEvents: 0, voiceSessions: 0 },
        complete: false,
      };
    }

    const matchingSessions = await ctx.db
      .query("voiceSessions")
      .withIndex("by_captured_email_normalized", (query) => query.eq("capturedEmailNormalized", normalized))
      .take(relatedLimit + 1);
    if (matchingSessions.length > relatedLimit) complete = false;
    for (const session of matchingSessions.slice(0, relatedLimit)) {
      await ctx.db.delete(session._id);
      deletedVoiceIds.add(String(session._id));
      deletedVoiceSessions += 1;
    }

    const matchingLeads = await ctx.db
      .query("leads")
      .withIndex("by_email_normalized", (query) => query.eq("emailNormalized", normalized))
      .take(RETENTION_BATCH_LIMITS.archivedLeads + 1);
    if (matchingLeads.length > RETENTION_BATCH_LIMITS.archivedLeads) complete = false;
    for (const lead of matchingLeads.slice(0, RETENTION_BATCH_LIMITS.archivedLeads)) {
      const [events, sessions] = await Promise.all([
        ctx.db
          .query("leadEvents")
          .withIndex("by_lead", (query) => query.eq("leadId", lead.leadId))
          .take(relatedLimit + 1),
        ctx.db
          .query("voiceSessions")
          .withIndex("by_lead_updated_at", (query) => query.eq("leadId", lead.leadId))
          .take(relatedLimit + 1),
      ]);
      for (const event of events.slice(0, relatedLimit)) {
        await ctx.db.delete(event._id);
        deletedLeadEvents += 1;
      }
      for (const session of sessions.slice(0, relatedLimit)) {
        if (deletedVoiceIds.has(String(session._id))) continue;
        await ctx.db.delete(session._id);
        deletedVoiceIds.add(String(session._id));
        deletedVoiceSessions += 1;
      }
      if (events.length > relatedLimit || sessions.length > relatedLimit) {
        complete = false;
        continue;
      }
      await ctx.db.delete(lead._id);
      deletedLeads += 1;
    }

    await ctx.db.insert("privacyEvents", {
      requestId,
      reason,
      actor,
      deletedLeads,
      deletedVoiceSessions,
      deletedLeadEvents,
      downstreamCleanupComplete,
      completed: complete,
      createdAt: Date.now(),
    });
    return {
      deleted: { leads: deletedLeads, leadEvents: deletedLeadEvents, voiceSessions: deletedVoiceSessions },
      complete,
    };
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
    return session ? { ...session, transcript: boundTranscript(session.transcript) } : null;
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
    const sessions = await ctx.db
      .query("voiceSessions")
      .withIndex("by_payload_safe_updated_at", (query) => query.eq("payloadSafe", true))
      .order("desc")
      .take(take);
    return sessions.map((session) => ({
      reviewId: session.reviewId,
      sessionId: session.sessionId,
      evaluatedAt: session.eval?.evaluatedAt ?? null,
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
      voice: session.voice ?? null,
      speed: session.speed ?? null,
      variant: session.variant ?? null,
      routeRequested: session.routeRequested,
      submittedAt: session.submittedAt ?? null,
      eval: session.eval ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  },
});

export const recent = queryGeneric({
  args: { ingestSecret: v.string() },
  handler: async (ctx, { ingestSecret }) => {
    requireIngestSecret(ingestSecret);

    return await ctx.db
      .query("leads")
      .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
      .order("desc")
      .take(20);
  },
});

export const leadsForClickUpBackfill = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 500), 1), 500);
    return await ctx.db
      .query("leads")
      .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
      .order("desc")
      .take(take);
  },
});

export const adminLeadTable = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 500), 1), 500);
    return await ctx.db
      .query("leads")
      .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
      .order("desc")
      .take(take);
  },
});

export const adminLeadCounts = queryGeneric({
  args: { ingestSecret: v.string() },
  handler: async (ctx, { ingestSecret }) => {
    requireIngestSecret(ingestSecret);
    const countLimit = 750;
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
      .order("desc")
      .take(countLimit + 1);
    return { ...summarizeAdminLeads(leads.slice(0, countLimit)), truncated: leads.length > countLimit };
  },
});

export const adminAggregateMetrics = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    generatedAt: v.number(),
    metrics: v.object({
      activeLeads: v.number(),
      connectedSessions: v.number(),
      engagedSessions: v.number(),
      notificationDeliveryRate: v.number(),
      notificationFailures: v.number(),
      prewarmedSessions: v.number(),
      qualifiedLeads: v.number(),
      recentLeads: v.number(),
      reviewedSessions: v.number(),
      sessionsWithErrors: v.number(),
      submittedSessions: v.number(),
      urgentLeads: v.number(),
      voiceLeads: v.number(),
      voiceSubmitRate: v.number(),
    }),
  }),
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 100), 1), 100);
    const generatedAt = Date.now();
    const [leads, voiceSessions] = await Promise.all([
      ctx.db
        .query("leads")
        .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
        .order("desc")
        .take(take),
      ctx.db
        .query("voiceSessions")
        .withIndex("by_payload_safe_updated_at", (query) => query.eq("payloadSafe", true))
        .order("desc")
        .take(take),
    ]);
    return { generatedAt, metrics: calculateAdminAggregateMetrics(leads, voiceSessions) };
  },
});

const SLA_QUERY_BUCKET_LIMIT = 75;
const HOUR_MS = 60 * 60 * 1000;

/**
 * PII-free operational SLA snapshot. Each bucket reads oldest-first through a
 * matching index and one overflow sentinel. A saturated bucket is reported as
 * truncated, so the route can alert on a lower bound without silently losing
 * older breaches to the dashboard's recent-row window.
 */
export const adminLeadSlaSnapshot = query({
  args: { ingestSecret: v.string(), maxUnownedMs: v.number() },
  handler: async (ctx, { ingestSecret, maxUnownedMs }) => {
    requireIngestSecret(ingestSecret);
    const generatedAt = Date.now();
    const boundedWindowMs = Math.min(Math.max(Math.floor(maxUnownedMs), HOUR_MS), 72 * HOUR_MS);
    const breachCutoff = generatedAt - boundedWindowMs;

    const [activeBuckets, unownedBuckets, failedNotificationRows] = await Promise.all([
      Promise.all(
        ADMIN_ACTIVE_LEAD_STATUSES.map((status) =>
          ctx.db
            .query("leads")
            .withIndex("by_payload_safe_status_created_at", (query) =>
              query.eq("payloadSafe", true).eq("status", status),
            )
            .order("asc")
            .take(SLA_QUERY_BUCKET_LIMIT + 1),
        ),
      ),
      Promise.all(
        ADMIN_ACTIVE_LEAD_STATUSES.flatMap((status) =>
          (["", undefined] as const).map((owner) =>
            ctx.db
              .query("leads")
              .withIndex("by_payload_safe_status_owner_created_at", (query) =>
                query.eq("payloadSafe", true).eq("status", status).eq("owner", owner).lt("createdAt", breachCutoff),
              )
              .order("asc")
              .take(SLA_QUERY_BUCKET_LIMIT + 1),
          ),
        ),
      ),
      ctx.db
        .query("leads")
        .withIndex("by_payload_safe_notification_delivered_created_at", (query) =>
          query.eq("payloadSafe", true).eq("notificationDelivered", false),
        )
        .order("asc")
        .take(SLA_QUERY_BUCKET_LIMIT + 1),
    ]);

    const activeLeads = summarizeSlaBuckets(activeBuckets);
    const unownedBreaches = summarizeSlaBuckets(unownedBuckets, true);
    const failedNotifications = summarizeSlaBuckets([failedNotificationRows]);
    return { generatedAt, activeLeads, unownedBreaches, failedNotifications };
  },
});

/**
 * An indexed connected-open session becomes orphan-eligible only after the
 * canonical maximum live duration, goodbye grace, and two heartbeat intervals.
 * It remains visible until a close snapshot changes sessionState or retention
 * removes the row; there is no narrow lower lookback window to miss.
 */
export const adminOrphanedVoiceSessionsSweep = query({
  args: { ingestSecret: v.string(), maxStaleMs: v.number() },
  handler: async (ctx, { ingestSecret, maxStaleMs }) => {
    requireIngestSecret(ingestSecret);
    const generatedAt = Date.now();
    const boundedStaleMs = Math.min(Math.max(Math.floor(maxStaleMs), MIN_ORPHAN_STALE_MS), 24 * HOUR_MS);
    const staleCutoff = generatedAt - boundedStaleMs;

    const candidates = await ctx.db
      .query("voiceSessions")
      .withIndex("by_safe_session_state_updated_at", (q) =>
        q.eq("payloadSafe", true).eq("sessionState", "connected_open").lt("updatedAt", staleCutoff),
      )
      .order("asc")
      .take(SLA_QUERY_BUCKET_LIMIT + 1);
    const legacyStates = await ctx.db
      .query("voiceSessions")
      .withIndex("by_safe_session_state_updated_at", (q) => q.eq("payloadSafe", true).eq("sessionState", undefined))
      .take(1);

    const legacyPayloads = await ctx.db
      .query("voiceSessions")
      .withIndex("by_payload_safe_updated_at", (q) => q.eq("payloadSafe", undefined))
      .take(1);

    const orphaned = candidates.slice(0, SLA_QUERY_BUCKET_LIMIT).map((row) => ({
      reviewId: row.reviewId,
      conversationId: row.conversationId,
      segment: row.segment,
      connectedAt: row.connectedAt,
      updatedAt: row.updatedAt,
      deploymentEnvironment: row.deploymentEnvironment,
    }));

    return {
      generatedAt,
      migrationPending: legacyPayloads.length > 0 || legacyStates.length > 0,
      orphaned: {
        count: orphaned.length,
        truncated: candidates.length > SLA_QUERY_BUCKET_LIMIT,
        rows: orphaned,
      },
    };
  },
});

function summarizeSlaBuckets(
  buckets: Array<Array<{ createdAt: number }>>,
  includeOldest = false,
): { count: number; truncated: boolean; oldestCreatedAt?: number } {
  const boundedRows = buckets.flatMap((bucket) => bucket.slice(0, SLA_QUERY_BUCKET_LIMIT));
  const oldestCreatedAt = includeOldest
    ? boundedRows.reduce<number | undefined>(
        (oldest, row) => (oldest === undefined || row.createdAt < oldest ? row.createdAt : oldest),
        undefined,
      )
    : undefined;
  return {
    count: boundedRows.length,
    truncated: buckets.some((bucket) => bucket.length > SLA_QUERY_BUCKET_LIMIT),
    ...(oldestCreatedAt === undefined ? {} : { oldestCreatedAt }),
  };
}

export const reviewDashboard = queryGeneric({
  args: { ingestSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { ingestSecret, limit }) => {
    requireIngestSecret(ingestSecret);
    const take = Math.min(Math.max(Math.floor(limit ?? 50), 1), 100);
    const now = Date.now();
    const [leads, voiceSessions, leadEvents] = await Promise.all([
      ctx.db
        .query("leads")
        .withIndex("by_payload_safe_created_at", (query) => query.eq("payloadSafe", true))
        .order("desc")
        .take(take),
      ctx.db
        .query("voiceSessions")
        .withIndex("by_payload_safe_updated_at", (query) => query.eq("payloadSafe", true))
        .order("desc")
        .take(take),
      ctx.db
        .query("leadEvents")
        .order("desc")
        .take(take * 2),
    ]);
    const notificationDelivered = leads.filter((lead) => lead.notificationDelivered === true).length;
    const notificationFailures = leads.filter((lead) => lead.notificationDelivered === false).length;
    const intakeAttribution = summarizeIntakeAttribution(leads);
    const metrics = calculateAdminAggregateMetrics(leads, voiceSessions);
    const prewarmedSessions = metrics.prewarmedSessions;
    const connectedSessions = metrics.connectedSessions;
    const engagedSessions = voiceSessions.filter(isEngagedVoiceCaptureSession);
    const submittedSessions = metrics.submittedSessions;
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
      metrics,
      analytics: {
        sourceCounts: countBy(leads, (lead) => lead.source),
        ...intakeAttribution,
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
          withErrors: voiceSessions.filter(
            (session) => session.errors.length > 0 || isVoiceAvailabilityFailure(session.closeReason),
          ).length,
          routeRequested: voiceSessions.filter((session) => session.routeRequested).length,
          totalResponseTokens,
          latency: voiceLatency,
        },
        voiceCaptureFunnel: summarizeVoiceCaptureFunnel(voiceSessions, take),
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

function calculateAdminAggregateMetrics(leads: Doc<"leads">[], voiceSessions: Doc<"voiceSessions">[]) {
  const notificationDelivered = leads.filter((lead) => lead.notificationDelivered === true).length;
  const notificationFailures = leads.filter((lead) => lead.notificationDelivered === false).length;
  const engagedSessions = voiceSessions.filter(isEngagedVoiceCaptureSession).length;
  const submittedSessions = voiceSessions.filter((session) => Boolean(session.leadId)).length;
  return {
    recentLeads: leads.length,
    activeLeads: leads.filter((lead) => !["qualified", "archived"].includes(lead.status)).length,
    voiceLeads: leads.filter((lead) => lead.source === "voice").length,
    notificationFailures,
    urgentLeads: leads.filter((lead) => lead.priority === "urgent" || lead.priority === "high").length,
    qualifiedLeads: leads.filter((lead) => lead.status === "qualified").length,
    reviewedSessions: voiceSessions.length,
    prewarmedSessions: voiceSessions.filter((session) => typeof session.prewarmedAt === "number").length,
    engagedSessions,
    connectedSessions: voiceSessions.filter((session) => typeof session.connectedAt === "number").length,
    sessionsWithErrors: voiceSessions.filter(
      (session) => session.errors.length > 0 || isVoiceAvailabilityFailure(session.closeReason),
    ).length,
    submittedSessions,
    notificationDeliveryRate: percent(notificationDelivered, leads.length),
    voiceSubmitRate: percent(submittedSessions, engagedSessions || voiceSessions.length),
  };
}

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
