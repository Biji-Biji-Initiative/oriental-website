import { z } from "zod";
import {
  ADMIN_LEAD_OWNERS,
  ADMIN_LEAD_PRIORITIES,
  ADMIN_WORKFLOW_LEAD_STATUSES,
  validateAdminLeadWorkflow,
} from "@/lib/admin-workflow";
import { boundTranscript, normalizeStoredEmail } from "@/lib/data-payload";
import { SEGMENT_IDS } from "@/lib/segments";
import { SUBMISSION_METHODS, VOICE_ENTRY_METHODS, VOICE_ENTRY_POINTS } from "@/lib/voice/interaction-attribution";

const segmentSchema = z.enum(SEGMENT_IDS);
const entryPointSchema = z.enum(VOICE_ENTRY_POINTS);
const entryMethodSchema = z.enum(VOICE_ENTRY_METHODS);
const submissionMethodSchema = z.enum(SUBMISSION_METHODS);
const fieldInputMethodSchema = z.enum(["voice", "form", "chat", "prefill"]);
const fieldCompletionMethodSchema = z.enum(["voice", "form", "chat", "prefill", "mixed", "unknown"]);
const fieldProvenanceEntrySchema = z.object({
  method: fieldCompletionMethodSchema,
  lastInput: fieldInputMethodSchema.optional(),
  editCount: z.number().int().min(0).max(100),
  correctionCount: z.number().int().min(0).max(100),
  clearCount: z.number().int().min(0).max(100),
});
export const fieldProvenanceSummarySchema = z.object({
  name: fieldProvenanceEntrySchema,
  email: fieldProvenanceEntrySchema,
  org: fieldProvenanceEntrySchema,
  phone: fieldProvenanceEntrySchema,
  website: fieldProvenanceEntrySchema,
  message: fieldProvenanceEntrySchema,
});

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
  email: z.string().trim().email("Use a valid email").max(180).transform(normalizeStoredEmail),
  name: z.string().trim().max(120),
  org: z.string().trim().max(180),
  phone: z.string().trim().max(60),
  website: z.string().trim().max(300),
  message: z.string().trim().max(2500),
});

export const leadRequestSchema = z
  .object({
    source: z.enum(["voice", "form"]),
    entryPoint: entryPointSchema.optional(),
    entryMethod: entryMethodSchema.optional(),
    submissionMethod: submissionMethodSchema.optional(),
    fieldProvenance: fieldProvenanceSummarySchema.optional(),
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
    voiceEmailVerified: z.boolean().optional(),
    voiceEmailVerificationSource: z.enum(["prefill", "speech", "typed"]).optional(),
    voiceEmailVerificationUserTurnSequence: z.number().int().nonnegative().max(200).optional(),
    utm: utmSchema,
  })
  .superRefine((lead, context) => {
    if (lead.submissionMethod) {
      const validPair =
        (lead.source === "form" && lead.submissionMethod === "handoff_button") ||
        (lead.source === "voice" &&
          (lead.submissionMethod === "handoff_button" || lead.submissionMethod === "voice_command"));
      if (!validPair) {
        context.addIssue({
          code: "custom",
          message: "Submission method does not match the lead source",
          path: ["submissionMethod"],
        });
      }
    }

    const claimsVoiceProvenance =
      lead.fieldProvenance &&
      Object.values(lead.fieldProvenance).some(
        (field) =>
          field.method === "voice" ||
          field.method === "chat" ||
          field.method === "mixed" ||
          field.lastInput === "voice" ||
          field.lastInput === "chat",
      );
    if (claimsVoiceProvenance && lead.source !== "voice") {
      context.addIssue({
        code: "custom",
        message: "Voice or chat provenance requires a voice-attributed lead",
        path: ["fieldProvenance"],
      });
    }

    if ((lead.source === "voice" || claimsVoiceProvenance) && (!lead.voiceReviewId || !lead.voiceReviewToken)) {
      context.addIssue({
        code: "custom",
        message: "Voice attribution requires signed voice review linkage",
        path: [!lead.voiceReviewId ? "voiceReviewId" : "voiceReviewToken"],
      });
    }

  })
  .transform((lead) => {
    const transcript = boundTranscript(lead.transcript);
    if (typeof lead.voiceEmailVerificationUserTurnSequence !== "number") return { ...lead, transcript };
    const rawUserTurns = lead.transcript.filter((turn) => turn.role === "user").length;
    const retainedUserTurns = transcript.filter((turn) => turn.role === "user").length;
    const removedUserTurns = Math.max(0, rawUserTurns - retainedUserTurns);
    return {
      ...lead,
      transcript,
      voiceEmailVerificationUserTurnSequence: Math.max(
        0,
        lead.voiceEmailVerificationUserTurnSequence - removedUserTurns,
      ),
    };
  });

export const newsletterRequestSchema = z.object({
  email: z.string().trim().email().max(180).transform(normalizeStoredEmail),
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

export const adminLeadWorkflowSchema = z
  .object({
    status: z.enum(ADMIN_WORKFLOW_LEAD_STATUSES),
    priority: z.enum(ADMIN_LEAD_PRIORITIES),
    owner: z.string().trim().max(80),
    note: z.string().trim().max(600).optional(),
    nextActionAt: z.number().int().positive().nullable(),
    nextActionNote: z.string().trim().max(500).optional(),
    outcomeReason: z.string().trim().max(500).optional(),
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(300),
  })
  .superRefine((workflow, context) => {
    for (const issue of validateAdminLeadWorkflow(workflow)) {
      context.addIssue({ code: "custom", message: issue.message, path: [issue.field] });
    }
  });

export const adminLeadBulkAssignmentSchema = z
  .object({
    leads: z
      .array(
        z.object({
          leadId: z.string().trim().min(1).max(160),
          expectedRevision: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(50)
      .refine((leads) => new Set(leads.map((lead) => lead.leadId)).size === leads.length, "Duplicate lead IDs"),
    owner: z.enum(ADMIN_LEAD_OWNERS),
    nextActionAt: z.number().int().positive(),
    nextActionNote: z.string().trim().min(3).max(500),
    reason: z.string().trim().min(3).max(300),
  })
  .superRefine((workflow, context) => {
    if (workflow.nextActionAt < Date.now() - 60_000) {
      context.addIssue({
        code: "custom",
        message: "The next action cannot be scheduled in the past.",
        path: ["nextActionAt"],
      });
    }
  });

export const adminLeadArchiveSchema = z.object({
  action: z.enum(["archive", "restore"]),
  leads: z
    .array(
      z.object({
        leadId: z.string().trim().min(1).max(160),
        expectedRevision: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(50)
    .refine((leads) => new Set(leads.map((lead) => lead.leadId)).size === leads.length, "Duplicate lead IDs"),
  reason: z.string().trim().min(3).max(300),
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
    snapshotSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    conversationId: z.string().uuid().optional(),
    leadId: z.string().max(160).nullable().optional(),
    segment: segmentSchema,
    status: z.enum(["idle", "submitted"]).default("idle"),
    connectionStatus: z.enum(["idle", "requesting_mic", "connecting", "reconnecting", "listening"]),
    closeReason: z
      .enum([
        "idle_timeout",
        "max_duration",
        "manual",
        "error",
        "voice_limit_reached",
        "mic_denied",
        "session_failed",
        "realtime_busy",
        "realtime_quota_exhausted",
        "webrtc_failed",
        "disconnected",
        "page_hidden",
      ])
      .optional(),
    deviceProfile: z.enum(["mobile", "desktop"]).optional(),
    deploymentEnvironment: z.enum(["local", "staging", "production"]).optional(),
    activationAttempted: z.boolean().optional(),
    entryPoint: entryPointSchema.optional(),
    entryMethod: entryMethodSchema.optional(),
    submissionMethod: submissionMethodSchema.optional(),
    fieldProvenance: fieldProvenanceSummarySchema.optional(),
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
      email: z.string().trim().max(180).default("").transform(normalizeStoredEmail),
      org: z.string().max(180).default(""),
      phone: z.string().max(60).default(""),
      website: z.string().max(300).default(""),
      message: z.string().max(2500).default(""),
    }),
    emailVerification: z
      .object({
        source: z.enum(["prefill", "speech", "typed"]),
        status: z.enum(["confirmed", "pending"]),
        matchesCaptured: z.boolean(),
        confidence: z.enum(["high", "medium"]).optional(),
      })
      .optional(),
    emailCaptureMode: z.enum(["strict", "adaptive"]).optional(),
    transcript: z.array(transcriptEntrySchema).max(120).default([]).transform(boundTranscript),
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
    rateLimits: z
      .array(
        z.object({
          name: z.string().max(80),
          limit: z.number().nonnegative().max(1_000_000),
          remaining: z.number().nonnegative().max(1_000_000),
          reset_seconds: z.number().nonnegative().max(86_400),
        }),
      )
      .max(20)
      .default([]),
    routeRequested: z.boolean().default(false),
    submittedAt: z.number().optional(),
    latency: z
      .object({
        version: z.literal(1),
        activation: z
          .object({
            tapToArmCueScheduledMs: z.number().nonnegative().max(10_000).optional(),
            tapToLiveMs: z.number().nonnegative().max(120_000).optional(),
            tapToAudibleMs: z.number().nonnegative().max(120_000).optional(),
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
        toolCalls: z
          .array(
            z.object({
              sequence: z.number().int().nonnegative().optional(),
              name: z.enum([
                "set_partner_type",
                "capture_field",
                "capture_fields",
                "confirm_email",
                "lookup_oriental",
                "clear_field",
                "clear_fields",
                "summarise_lead",
                "route_to_team",
                "wait_for_user",
                "end_call",
                "unknown",
              ]),
              outcome: z.enum(["success", "rejected", "failed", "dispatch_failed"]),
              executionMs: z.number().nonnegative().max(120_000),
              responseCreatedToCallMs: z.number().nonnegative().max(120_000).optional(),
              responseCreatedToResultMs: z.number().nonnegative().max(120_000).optional(),
            }),
          )
          .max(120)
          .optional(),
      })
      .optional(),
    transport: z
      .object({
        realtimeBusyRetryCount: z.number().int().nonnegative().default(0),
        disconnectCount: z.number().int().nonnegative(),
        recoveryCount: z.number().int().nonnegative(),
        iceRestartCount: z.number().int().nonnegative(),
        wasSpeakingAtClose: z.boolean().optional(),
        remoteTrackReceivedAt: z.number().optional(),
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
export type AdminLeadBulkAssignmentRequest = z.infer<typeof adminLeadBulkAssignmentSchema>;
export type AdminLeadArchiveRequest = z.infer<typeof adminLeadArchiveSchema>;
export type VoiceReviewSnapshotRequest = z.infer<typeof voiceReviewSnapshotSchema>;
