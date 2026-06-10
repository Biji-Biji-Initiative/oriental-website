import { z } from "zod";
import { ADMIN_LEAD_PRIORITIES, ADMIN_LEAD_STATUSES } from "@/lib/admin-workflow";
import { SEGMENT_IDS } from "@/lib/segments";

const segmentSchema = z.enum(SEGMENT_IDS);

export const transcriptEntrySchema = z.object({
  role: z.enum(["user", "assistant", "system"]).default("user"),
  text: z.string().min(1).max(4000),
});

export const leadFormSchema = z.object({
  name: z.string().trim().min(2, "Add your name").max(120),
  email: z.string().trim().email("Use a valid email").max(180),
  org: z.string().trim().min(2, "Add your organisation").max(180),
  message: z.string().trim().min(8, "Share a little more").max(2500),
});

export const leadRequestSchema = z.object({
  source: z.enum(["voice", "form"]),
  segment: segmentSchema.default("other"),
  form: leadFormSchema,
  transcript: z.array(transcriptEntrySchema).default([]),
  turnstileToken: z.string().optional(),
  utm: z.record(z.string(), z.string()).default({}),
});

export const newsletterRequestSchema = z.object({
  email: z.string().trim().email().max(180),
  turnstileToken: z.string().optional(),
  utm: z.record(z.string(), z.string()).default({}),
});

export const voiceSessionRequestSchema = z.object({
  turnstileToken: z.string().optional(),
  intent: segmentSchema.optional(),
  utm: z.record(z.string(), z.string()).default({}),
});

export const adminLoginSchema = z.object({
  token: z.string().min(20).max(300),
});

export const adminLeadWorkflowSchema = z.object({
  status: z.enum(ADMIN_LEAD_STATUSES),
  priority: z.enum(ADMIN_LEAD_PRIORITIES),
  owner: z.string().trim().max(80).default(""),
  note: z.string().trim().max(600).optional(),
});

export const adminVoiceFollowUpSchema = z.object({
  followedUp: z.boolean(),
});

export const voiceReviewSnapshotSchema = z.object({
  review: z.object({
    id: z.string().uuid(),
    token: z.string().min(20).max(500),
  }),
  snapshot: z.object({
    sessionId: z.string().min(1).max(160),
    leadId: z.string().max(160).nullable().optional(),
    segment: segmentSchema,
    status: z.enum(["idle", "submitted"]).default("idle"),
    connectionStatus: z.enum(["idle", "connecting", "listening"]),
    model: z.string().max(80).optional(),
    voice: z.string().max(80).optional(),
    speed: z.number().min(0.25).max(1.5).optional(),
    captured: z.object({
      name: z.string().max(120).default(""),
      email: z.string().max(180).default(""),
      org: z.string().max(180).default(""),
      message: z.string().max(2500).default(""),
    }),
    transcript: z.array(transcriptEntrySchema).max(120).default([]),
    usage: z
      .object({
        responseCount: z.number().int().nonnegative(),
        responseTokens: z.number().int().nonnegative(),
        responseInputTokens: z.number().int().nonnegative(),
        responseOutputTokens: z.number().int().nonnegative(),
        responseCachedTokens: z.number().int().nonnegative(),
        transcriptionCount: z.number().int().nonnegative(),
        transcriptionTokens: z.number().int().nonnegative(),
        transcriptionInputTokens: z.number().int().nonnegative(),
        transcriptionOutputTokens: z.number().int().nonnegative(),
      })
      .optional(),
    errors: z
      .array(
        z.object({
          eventId: z.string().max(160).optional(),
          message: z.string().min(1).max(500),
          code: z.string().max(120).optional(),
        }),
      )
      .max(20)
      .default([]),
    rateLimits: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
    routeRequested: z.boolean().default(false),
    submittedAt: z.number().optional(),
  }),
});

export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type NewsletterRequest = z.infer<typeof newsletterRequestSchema>;
export type VoiceSessionRequest = z.infer<typeof voiceSessionRequestSchema>;
export type AdminLeadWorkflowRequest = z.infer<typeof adminLeadWorkflowSchema>;
export type VoiceReviewSnapshotRequest = z.infer<typeof voiceReviewSnapshotSchema>;
