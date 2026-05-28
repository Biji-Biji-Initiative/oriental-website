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
      notificationDelivered: false,
      createdAt: Date.now(),
    });
    await ctx.db.insert("leadEvents", {
      leadId: lead.id,
      kind: "created",
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
      note: summary,
      createdAt: Date.now(),
    });
    return { ok: true };
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
    const [leads, voiceSessions] = await Promise.all([
      ctx.db.query("leads").order("desc").take(take),
      ctx.db.query("voiceSessions").withIndex("by_updated_at").order("desc").take(take),
    ]);
    return {
      leads,
      voiceSessions,
      metrics: {
        recentLeads: leads.length,
        voiceLeads: leads.filter((lead) => lead.source === "voice").length,
        notificationFailures: leads.filter((lead) => lead.notificationDelivered === false).length,
        reviewedSessions: voiceSessions.length,
        sessionsWithErrors: voiceSessions.filter((session) => session.errors.length > 0).length,
        submittedSessions: voiceSessions.filter((session) => Boolean(session.leadId)).length,
      },
    };
  },
});
