import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

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
    message: v.string(),
  }),
  transcript: transcriptValidator,
  turnstileToken: v.optional(v.string()),
  utm: v.record(v.string(), v.string()),
});

const capturedValidator = v.object({
  name: v.string(),
  email: v.string(),
  org: v.string(),
  message: v.string(),
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

const voiceSessionValidator = v.object({
  reviewId: v.string(),
  sessionId: v.string(),
  leadId: v.optional(v.union(v.string(), v.null())),
  segment: v.string(),
  status: v.string(),
  connectionStatus: v.string(),
  model: v.optional(v.string()),
  voice: v.optional(v.string()),
  speed: v.optional(v.number()),
  captured: capturedValidator,
  transcript: transcriptValidator,
  usage: v.optional(usageValidator),
  errors: v.array(
    v.object({
      eventId: v.optional(v.string()),
      message: v.string(),
    }),
  ),
  rateLimits: v.array(v.any()),
  routeRequested: v.boolean(),
  submittedAt: v.optional(v.number()),
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
      message: lead.form.message,
      transcript: lead.transcript,
      utm: lead.utm,
      status: "new",
      priority: "normal",
      owner: "",
      notificationDelivered: false,
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
    summary: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { ingestSecret, leadId, notificationDelivered, emailOk, slackOk, summary }) => {
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

export const updateLeadWorkflow = mutationGeneric({
  args: {
    ingestSecret: v.string(),
    leadId: v.string(),
    status: workflowStatusValidator,
    priority: leadPriorityValidator,
    owner: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), reason: v.literal("not_found") }),
  ),
  handler: async (ctx, { ingestSecret, leadId, status, priority, owner, note }) => {
    requireIngestSecret(ingestSecret);
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_lead_id", (query) => query.eq("leadId", leadId))
      .unique();
    if (!lead) return { ok: false as const, reason: "not_found" as const };

    const now = Date.now();
    const cleanOwner = owner.trim();
    const cleanNote = note?.trim() ?? "";
    await ctx.db.patch(lead._id, {
      status,
      priority,
      owner: cleanOwner,
      ...(cleanNote ? { workflowNote: cleanNote } : {}),
      lastReviewedAt: now,
    });
    await ctx.db.insert("leadEvents", {
      leadId,
      kind: "workflow_update",
      actor: "admin",
      fromStatus: lead.status,
      toStatus: status,
      note: cleanNote || `Priority ${priority}${cleanOwner ? `, owner ${cleanOwner}` : ""}`,
      createdAt: now,
    });
    return { ok: true as const };
  },
});

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
      leadId: snapshot.leadId ?? null,
      segment: snapshot.segment,
      status: snapshot.status,
      connectionStatus: snapshot.connectionStatus,
      captured: snapshot.captured,
      transcript: snapshot.transcript,
      errors: snapshot.errors,
      rateLimits: snapshot.rateLimits,
      routeRequested: snapshot.routeRequested,
      updatedAt: now,
      ...(snapshot.model ? { model: snapshot.model } : {}),
      ...(snapshot.voice ? { voice: snapshot.voice } : {}),
      ...(typeof snapshot.speed === "number" ? { speed: snapshot.speed } : {}),
      ...(snapshot.usage ? { usage: snapshot.usage } : {}),
      ...(typeof snapshot.submittedAt === "number" ? { submittedAt: snapshot.submittedAt } : {}),
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

export const recent = queryGeneric({
  args: { ingestSecret: v.string() },
  handler: async (ctx, { ingestSecret }) => {
    requireIngestSecret(ingestSecret);

    return await ctx.db.query("leads").order("desc").take(20);
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
    const submittedSessions = voiceSessions.filter((session) => Boolean(session.leadId)).length;
    const totalResponseTokens = voiceSessions.reduce((sum, session) => sum + (session.usage?.responseTokens ?? 0), 0);
    return {
      generatedAt: now,
      leads,
      voiceSessions,
      leadEvents,
      metrics: {
        recentLeads: leads.length,
        activeLeads,
        voiceLeads,
        notificationFailures,
        urgentLeads,
        qualifiedLeads: leads.filter((lead) => lead.status === "qualified").length,
        reviewedSessions: voiceSessions.length,
        sessionsWithErrors,
        submittedSessions,
        notificationDeliveryRate: percent(notificationDelivered, leads.length),
        voiceSubmitRate: percent(submittedSessions, voiceSessions.length),
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
          submitted: submittedSessions,
          withErrors: sessionsWithErrors,
          routeRequested: voiceSessions.filter((session) => session.routeRequested).length,
          totalResponseTokens,
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
