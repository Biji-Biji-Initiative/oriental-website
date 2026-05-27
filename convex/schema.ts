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
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_segment", ["segment"])
    .index("by_status", ["status"]),
  leadEvents: defineTable({
    leadId: v.string(),
    kind: v.string(),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_lead", ["leadId"]),
});
