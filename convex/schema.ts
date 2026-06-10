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
    message: v.string(),
    transcript: v.array(
      v.object({
        role: v.string(),
        text: v.string(),
      }),
    ),
    utm: v.record(v.string(), v.string()),
    status: v.string(),
    priority: v.optional(v.string()),
    owner: v.optional(v.string()),
    workflowNote: v.optional(v.string()),
    lastReviewedAt: v.optional(v.number()),
    notificationDelivered: v.optional(v.boolean()),
    notificationEmailOk: v.optional(v.boolean()),
    notificationSlackOk: v.optional(v.boolean()),
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
    model: v.optional(v.string()),
    voice: v.optional(v.string()),
    speed: v.optional(v.number()),
    captured: v.object({
      name: v.string(),
      email: v.string(),
      org: v.string(),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    followedUpAt: v.optional(v.number()),
  })
    .index("by_review_id", ["reviewId"])
    .index("by_session_id", ["sessionId"])
    .index("by_updated_at", ["updatedAt"]),
});
