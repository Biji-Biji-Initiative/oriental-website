import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

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

export const createLead = mutationGeneric({
  args: { lead: leadValidator },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, { lead }) => {
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

export const recent = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("leads").order("desc").take(20);
  },
});
