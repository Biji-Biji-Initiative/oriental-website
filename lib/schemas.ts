import { z } from "zod";
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

export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type NewsletterRequest = z.infer<typeof newsletterRequestSchema>;
export type VoiceSessionRequest = z.infer<typeof voiceSessionRequestSchema>;
