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
    voiceModelCell: v.optional(v.string()),
    voiceReasoningCell: v.optional(v.string()),
    voiceName: v.optional(v.string()),
    voiceSpeed: v.optional(v.number()),
    voiceRuntimeProfile: v.optional(v.string()),
    voiceInputPolicy: v.optional(v.string()),
    utm: v.record(v.string(), v.string()),
    status: v.string(),
    priority: v.optional(v.string()),
    owner: v.optional(v.string()),
    workflowNote: v.optional(v.string()),
    lastReviewedAt: v.optional(v.number()),
    nextActionAt: v.optional(v.number()),
    nextActionNote: v.optional(v.string()),
    firstAssignedAt: v.optional(v.number()),
    firstContactedAt: v.optional(v.number()),
    outcomeReason: v.optional(v.string()),
    workflowRevision: v.optional(v.number()),
    notificationDelivered: v.optional(v.boolean()),
    notificationEmailOk: v.optional(v.boolean()),
    notificationSlackOk: v.optional(v.boolean()),
    notificationClickUpOk: v.optional(v.boolean()),
    notificationClickUpTaskId: v.optional(v.string()),
    notificationClickUpTaskUrl: v.optional(v.string()),
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
    requestId: v.optional(v.string()),
    reason: v.optional(v.string()),
    changes: v.optional(
      v.array(
        v.object({
          field: v.string(),
          before: v.optional(v.string()),
          after: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
  }).index("by_lead", ["leadId"]),
  voiceSessions: defineTable({
    reviewId: v.string(),
    sessionId: v.string(),
    // Stable id shared by every call/reconnect in one intake conversation, so a
    // dropped-and-resumed call reads as one conversation, not many rows.
    conversationId: v.optional(v.string()),
    leadId: v.optional(v.union(v.string(), v.null())),
    segment: v.string(),
    status: v.string(),
    connectionStatus: v.string(),
    closeReason: v.optional(v.string()),
    deviceProfile: v.optional(v.union(v.literal("mobile"), v.literal("desktop"))),
    deploymentEnvironment: v.optional(v.union(v.literal("local"), v.literal("staging"), v.literal("production"))),
    // Explicit post-mint user activation. This distinguishes failed attempts
    // with missing latency payloads from unused permission-aware prewarms.
    activationAttempted: v.optional(v.boolean()),
    prewarmedAt: v.optional(v.number()),
    connectStartedAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    firstEventAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    model: v.optional(v.string()),
    modelCell: v.optional(v.union(v.literal("control"), v.literal("candidate"))),
    reasoningCell: v.optional(v.union(v.literal("low"), v.literal("minimal"))),
    voice: v.optional(v.string()),
    speed: v.optional(v.number()),
    variant: v.optional(v.union(v.string(), v.null())),
    runtimeProfile: v.optional(v.union(v.literal("baseline"), v.literal("instant-v1"))),
    inputPolicy: v.optional(v.union(v.literal("baseline"), v.literal("fast"), v.literal("patient"))),
    captured: v.object({
      name: v.string(),
      email: v.string(),
      org: v.string(),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      message: v.string(),
    }),
    emailVerification: v.optional(
      v.object({
        source: v.union(v.literal("prefill"), v.literal("speech"), v.literal("typed")),
        status: v.union(v.literal("confirmed"), v.literal("pending")),
        matchesCaptured: v.boolean(),
      }),
    ),
    emailCaptureMode: v.optional(v.union(v.literal("strict"), v.literal("adaptive"))),
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
    latency: v.optional(
      v.object({
        version: v.literal(1),
        activation: v.optional(
          v.object({
            tapToArmCueScheduledMs: v.optional(v.number()),
            tapToLiveMs: v.optional(v.number()),
            tapToAudibleMs: v.optional(v.number()),
          }),
        ),
        turns: v.array(
          v.object({
            sequence: v.number(),
            inputPolicy: v.union(v.literal("baseline"), v.literal("fast"), v.literal("patient")),
            speechDurationMs: v.optional(v.number()),
            stopToResponseCreatedMs: v.optional(v.number()),
            stopToFirstOutputEventMs: v.optional(v.number()),
            localSpeechEndToSpeechStoppedMs: v.optional(v.number()),
            stopToRemoteAudioMs: v.optional(v.number()),
            firstOutputEventToRemoteAudioMs: v.optional(v.number()),
            toolDurationMs: v.optional(v.number()),
            bargeInToResponseDoneMs: v.optional(v.number()),
            responseDurationMs: v.optional(v.number()),
            interrupted: v.boolean(),
            rapidResume: v.boolean(),
          }),
        ),
        toolCalls: v.optional(
          v.array(
            v.object({
              sequence: v.optional(v.number()),
              name: v.union(
                v.literal("set_partner_type"),
                v.literal("capture_field"),
                v.literal("capture_fields"),
                v.literal("confirm_email"),
                v.literal("lookup_oriental"),
                v.literal("clear_field"),
                v.literal("summarise_lead"),
                v.literal("route_to_team"),
                v.literal("wait_for_user"),
                v.literal("end_call"),
                v.literal("unknown"),
              ),
              outcome: v.union(
                v.literal("success"),
                v.literal("rejected"),
                v.literal("failed"),
                v.literal("dispatch_failed"),
              ),
              executionMs: v.number(),
              responseCreatedToCallMs: v.optional(v.number()),
              responseCreatedToResultMs: v.optional(v.number()),
            }),
          ),
        ),
      }),
    ),
    transport: v.optional(
      v.object({
        realtimeBusyRetryCount: v.optional(v.number()),
        disconnectCount: v.number(),
        recoveryCount: v.number(),
        iceRestartCount: v.number(),
        wasSpeakingAtClose: v.optional(v.boolean()),
        remoteTrackReceivedAt: v.optional(v.number()),
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
    eval: v.optional(
      v.object({
        routingCorrect: v.number(),
        captureCompleteness: v.number(),
        conversationQuality: v.number(),
        frustration: v.number(),
        summary: v.string(),
        droppedMidTurn: v.boolean(),
        model: v.string(),
        evaluatedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    followedUpAt: v.optional(v.number()),
  })
    .index("by_review_id", ["reviewId"])
    .index("by_session_id", ["sessionId"])
    .index("by_conversation", ["conversationId"])
    .index("by_updated_at", ["updatedAt"]),
});
