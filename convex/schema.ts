import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  leads: defineTable({
    leadId: v.string(),
    source: v.union(v.literal("voice"), v.literal("form"), v.literal("hero-email")),
    segment: v.string(),
    routedTo: v.string(),
    routedToEmail: v.optional(v.union(v.string(), v.null())),
    name: v.string(),
    email: v.string(),
    org: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    message: v.string(),
    transcript: v.array(
      v.object({
        role: v.string(),
        text: v.string(),
      }),
    ),
    voiceReviewId: v.optional(v.string()),
    voiceSessionId: v.optional(v.string()),
    voiceVariant: v.optional(v.string()),
    voiceModel: v.optional(v.string()),
    voiceName: v.optional(v.string()),
    voiceSpeed: v.optional(v.number()),
    utm: v.record(v.string(), v.string()),
    status: v.string(),
    priority: v.optional(v.string()),
    owner: v.optional(v.string()),
    workflowNote: v.optional(v.string()),
    lastReviewedAt: v.optional(v.number()),
    notificationDelivered: v.optional(v.boolean()),
    notificationEmailOk: v.optional(v.boolean()),
    notificationSlackOk: v.optional(v.boolean()),
    notificationConfirmationOk: v.optional(v.boolean()),
    notificationSummary: v.optional(v.string()),
    lastNotificationAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_lead_id", ["leadId"])
    .index("by_email", ["email"])
    .index("by_segment", ["segment"])
    .index("by_status", ["status"]),
  leadEvents: defineTable({
    leadId: v.string(),
    kind: v.string(),
    actor: v.optional(v.string()),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_lead", ["leadId"]),
  voiceSessions: defineTable({
    reviewId: v.string(),
    sessionId: v.string(),
    leadId: v.optional(v.union(v.string(), v.null())),
    segment: v.string(),
    status: v.string(),
    connectionStatus: v.string(),
    closeReason: v.optional(v.string()),
    prewarmedAt: v.optional(v.number()),
    connectStartedAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    firstEventAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    model: v.optional(v.string()),
    voice: v.optional(v.string()),
    speed: v.optional(v.number()),
    variant: v.optional(v.union(v.string(), v.null())),
    captured: v.object({
      name: v.string(),
      email: v.string(),
      org: v.string(),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      message: v.string(),
    }),
    transcript: v.array(
      v.object({
        role: v.string(),
        text: v.string(),
      }),
    ),
    usage: v.optional(
      v.object({
        responseCount: v.number(),
        responseTokens: v.number(),
        responseInputTokens: v.number(),
        responseOutputTokens: v.number(),
        responseCachedTokens: v.number(),
        transcriptionCount: v.number(),
        transcriptionTokens: v.number(),
        transcriptionInputTokens: v.number(),
        transcriptionOutputTokens: v.number(),
      }),
    ),
    errors: v.array(
      v.object({
        eventId: v.optional(v.string()),
        message: v.string(),
        code: v.optional(v.string()),
      }),
    ),
    rateLimits: v.array(v.any()),
    routeRequested: v.boolean(),
    transport: v.optional(
      v.object({
        disconnectCount: v.number(),
        recoveryCount: v.number(),
        iceRestartCount: v.number(),
        wasSpeakingAtClose: v.optional(v.boolean()),
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
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    followedUpAt: v.optional(v.number()),
  })
    .index("by_review_id", ["reviewId"])
    .index("by_session_id", ["sessionId"])
    .index("by_updated_at", ["updatedAt"]),
});
