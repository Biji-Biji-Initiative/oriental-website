import { z } from "zod";
import { ADMIN_LEAD_PRIORITIES, ADMIN_LEAD_STATUSES } from "@/lib/admin-workflow";
import { SEGMENT_IDS } from "@/lib/segments";

const segmentSchema = z.enum(SEGMENT_IDS);

const utmSchema = z
  .record(z.string().max(80), z.string().max(300))
  .refine((utm) => Object.keys(utm).length <= 20, "Too many utm entries")
  .default({});

export const transcriptEntrySchema = z.object({
  role: z.enum(["user", "assistant", "system"]).default("user"),
  text: z.string().min(1).max(4000),
});

export const leadFormSchema = z.object({
  // Only a valid email is enforced so the team can follow up; every other field
  // may be left empty to keep the handoff low-friction.
  email: z.string().trim().email("Use a valid email").max(180),
  name: z.string().trim().max(120),
  org: z.string().trim().max(180),
  phone: z.string().trim().max(60),
  website: z.string().trim().max(300),
  message: z.string().trim().max(2500),
});

export const leadRequestSchema = z.object({
  source: z.enum(["voice", "form"]),
  segment: segmentSchema.default("other"),
  form: leadFormSchema,
  transcript: z.array(transcriptEntrySchema).max(200).default([]),
  turnstileToken: z.string().optional(),
  voiceReviewId: z.string().uuid().optional(),
  voiceReviewToken: z.string().min(20).max(500).optional(),
  voiceSessionId: z.string().max(160).optional(),
  voiceVariant: z.string().max(64).optional(),
  voiceModel: z.string().max(80).optional(),
  voiceModelCell: z.enum(["control", "candidate"]).optional(),
  voiceReasoningCell: z.enum(["low", "minimal"]).optional(),
  voiceName: z.string().max(80).optional(),
  voiceSpeed: z.number().min(0.25).max(1.5).optional(),
  voiceRuntimeProfile: z.enum(["baseline", "instant-v1"]).optional(),
  voiceInputPolicy: z.enum(["baseline", "fast", "patient"]).optional(),
  utm: utmSchema,
});

export const newsletterRequestSchema = z.object({
  email: z.string().trim().email().max(180),
  turnstileToken: z.string().optional(),
  utm: utmSchema,
});

export const voiceSessionRequestSchema = z.object({
  turnstileToken: z.string().optional(),
  intent: segmentSchema.optional(),
  // Voice A/B variant id; resolved against the server-side catalog (unknown ids
  // fall back to the env default). Never carries voice/persona data itself.
  variant: z.string().max(64).optional(),
  utm: utmSchema,
});

export const adminLoginSchema = z.object({
  token: z.string().min(8).max(2000),
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
    conversationId: z.string().uuid().optional(),
    leadId: z.string().max(160).nullable().optional(),
    segment: segmentSchema,
    status: z.enum(["idle", "submitted"]).default("idle"),
    connectionStatus: z.enum(["idle", "requesting_mic", "connecting", "listening"]),
    closeReason: z
      .enum([
        "idle_timeout",
        "max_duration",
        "manual",
        "error",
        "voice_limit_reached",
        "mic_denied",
        "session_failed",
        "webrtc_failed",
        "disconnected",
        "page_hidden",
      ])
      .optional(),
    prewarmedAt: z.number().optional(),
    connectStartedAt: z.number().optional(),
    connectedAt: z.number().optional(),
    firstEventAt: z.number().optional(),
    closedAt: z.number().optional(),
    model: z.string().max(80).optional(),
    modelCell: z.enum(["control", "candidate"]).optional(),
    reasoningCell: z.enum(["low", "minimal"]).optional(),
    voice: z.string().max(80).optional(),
    speed: z.number().min(0.25).max(1.5).optional(),
    variant: z.string().max(64).nullable().optional(),
    runtimeProfile: z.enum(["baseline", "instant-v1"]).optional(),
    inputPolicy: z.enum(["baseline", "fast", "patient"]).optional(),
    captured: z.object({
      name: z.string().max(120).default(""),
      email: z.string().max(180).default(""),
      org: z.string().max(180).default(""),
      phone: z.string().max(60).default(""),
      website: z.string().max(300).default(""),
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
    latency: z
      .object({
        version: z.literal(1),
        activation: z
          .object({
            tapToArmCueScheduledMs: z.number().nonnegative().max(10_000).optional(),
            tapToLiveMs: z.number().nonnegative().max(120_000).optional(),
          })
          .optional(),
        turns: z
          .array(
            z.object({
              sequence: z.number().int().nonnegative(),
              inputPolicy: z.enum(["baseline", "fast", "patient"]),
              speechDurationMs: z.number().nonnegative().max(600_000).optional(),
              stopToResponseCreatedMs: z.number().nonnegative().max(120_000).optional(),
              stopToFirstOutputEventMs: z.number().nonnegative().max(120_000).optional(),
              localSpeechEndToSpeechStoppedMs: z.number().nonnegative().max(120_000).optional(),
              stopToRemoteAudioMs: z.number().nonnegative().max(120_000).optional(),
              firstOutputEventToRemoteAudioMs: z.number().nonnegative().max(120_000).optional(),
              toolDurationMs: z.number().nonnegative().max(120_000).optional(),
              bargeInToResponseDoneMs: z.number().nonnegative().max(120_000).optional(),
              responseDurationMs: z.number().nonnegative().max(600_000).optional(),
              interrupted: z.boolean(),
              rapidResume: z.boolean(),
            }),
          )
          .max(80),
      })
      .optional(),
    transport: z
      .object({
        disconnectCount: z.number().int().nonnegative(),
        recoveryCount: z.number().int().nonnegative(),
        iceRestartCount: z.number().int().nonnegative(),
        wasSpeakingAtClose: z.boolean().optional(),
        transitions: z
          .array(z.object({ state: z.string().max(24), at: z.number() }))
          .max(60)
          .default([]),
        lastStats: z
          .object({
            at: z.number(),
            packetsLost: z.number().optional(),
            packetsReceived: z.number().optional(),
            jitterMs: z.number().optional(),
            roundTripMs: z.number().optional(),
          })
          .optional(),
        worstStats: z
          .object({
            packetsLostPct: z.number().optional(),
            maxJitterMs: z.number().optional(),
            maxRttMs: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type NewsletterRequest = z.infer<typeof newsletterRequestSchema>;
export type VoiceSessionRequest = z.infer<typeof voiceSessionRequestSchema>;
export type AdminLeadWorkflowRequest = z.infer<typeof adminLeadWorkflowSchema>;
export type VoiceReviewSnapshotRequest = z.infer<typeof voiceReviewSnapshotSchema>;
