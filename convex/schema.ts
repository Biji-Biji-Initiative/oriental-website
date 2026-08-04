import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

function fieldProvenanceSchema() {
  const entry = () =>
    v.object({
      method: v.string(),
      lastInput: v.optional(v.string()),
      editCount: v.number(),
      correctionCount: v.number(),
      clearCount: v.number(),
    });
  return v.object({
    name: entry(),
    email: entry(),
    org: entry(),
    phone: entry(),
    website: entry(),
    message: entry(),
  });
}

export default defineSchema({
  leads: defineTable({
    leadId: v.string(),
    source: v.union(v.literal("voice"), v.literal("form"), v.literal("hero-email")),
    entryPoint: v.optional(v.string()),
    entryMethod: v.optional(v.string()),
    submissionMethod: v.optional(v.string()),
    fieldProvenance: v.optional(fieldProvenanceSchema()),
    segment: v.string(),
    routedTo: v.string(),
    routedToEmail: v.optional(v.union(v.string(), v.null())),
    name: v.string(),
    email: v.string(),
    emailNormalized: v.optional(v.string()),
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
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.string()),
    archiveReason: v.optional(v.string()),
    preArchiveStatus: v.optional(v.string()),
    restoredAt: v.optional(v.number()),
    restoredBy: v.optional(v.string()),
    notificationDelivered: v.optional(v.boolean()),
    notificationEmailOk: v.optional(v.boolean()),
    notificationSlackOk: v.optional(v.boolean()),
    notificationSlackMessageId: v.optional(v.string()),
    notificationClickUpOk: v.optional(v.boolean()),
    notificationClickUpTaskId: v.optional(v.string()),
    notificationClickUpTaskUrl: v.optional(v.string()),
    notificationConfirmationOk: v.optional(v.boolean()),
    notificationSummary: v.optional(v.string()),
    lastNotificationAt: v.optional(v.number()),
    transcriptRetentionExpiresAt: v.optional(v.number()),
    hasRetainedTranscript: v.optional(v.boolean()),
    retentionExpiresAt: v.optional(v.number()),
    payloadSafe: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_lead_id", ["leadId"])
    .index("by_email", ["email"])
    .index("by_email_normalized", ["emailNormalized"])
    .index("by_segment", ["segment"])
    .index("by_status", ["status"])
    .index("by_retained_transcript_expires_at", ["hasRetainedTranscript", "transcriptRetentionExpiresAt"])
    .index("by_safe_status_retention_expires_at", ["payloadSafe", "status", "retentionExpiresAt"])
    .index("by_payload_safe_created_at", ["payloadSafe", "createdAt"])
    .index("by_payload_safe_status_created_at", ["payloadSafe", "status", "createdAt"])
    .index("by_payload_safe_status_owner_created_at", ["payloadSafe", "status", "owner", "createdAt"])
    .index("by_payload_safe_notification_delivered_created_at", ["payloadSafe", "notificationDelivered", "createdAt"]),
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
  // This is the durable, PII-free application-log plane. The payload is a
  // bounded JSON representation of the structured log record; visitor text,
  // contact details, credentials, and free-form provider messages are removed
  // before it can reach this table.
  applicationLogs: defineTable({
    logId: v.string(),
    occurredAt: v.number(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    service: v.literal("oriental-website"),
    version: v.string(),
    event: v.string(),
    payload: v.string(),
    retentionExpiresAt: v.number(),
  })
    .index("by_log_id", ["logId"])
    .index("by_occurred_at", ["occurredAt"])
    .index("by_retention_expires_at", ["retentionExpiresAt"]),
  privacyEvents: defineTable({
    requestId: v.string(),
    reason: v.string(),
    actor: v.string(),
    deletedLeads: v.number(),
    deletedVoiceSessions: v.number(),
    deletedLeadEvents: v.number(),
    downstreamCleanupComplete: v.boolean(),
    completed: v.boolean(),
    createdAt: v.number(),
  }).index("by_created_at", ["createdAt"]),
  voiceSessions: defineTable({
    reviewId: v.string(),
    sessionId: v.string(),
    snapshotSequence: v.optional(v.number()),
    // Stable id shared by every call/reconnect in one intake conversation, so a
    // dropped-and-resumed call reads as one conversation, not many rows.
    conversationId: v.optional(v.string()),
    leadId: v.optional(v.union(v.string(), v.null())),
    segment: v.string(),
    status: v.string(),
    connectionStatus: v.string(),
    sessionState: v.optional(v.union(v.literal("preconnected"), v.literal("connected_open"), v.literal("closed"))),
    closeReason: v.optional(v.string()),
    deviceProfile: v.optional(v.union(v.literal("mobile"), v.literal("desktop"))),
    deploymentEnvironment: v.optional(v.union(v.literal("local"), v.literal("staging"), v.literal("production"))),
    // Explicit post-mint user activation. This distinguishes failed attempts
    // with missing latency payloads from unused permission-aware prewarms.
    activationAttempted: v.optional(v.boolean()),
    entryPoint: v.optional(v.string()),
    entryMethod: v.optional(v.string()),
    submissionMethod: v.optional(v.string()),
    fieldProvenance: v.optional(fieldProvenanceSchema()),
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
    capturedEmailNormalized: v.optional(v.string()),
    emailVerification: v.optional(
      v.object({
        source: v.union(v.literal("prefill"), v.literal("speech"), v.literal("typed")),
        status: v.union(v.literal("confirmed"), v.literal("pending")),
        matchesCaptured: v.boolean(),
        confidence: v.optional(v.union(v.literal("high"), v.literal("medium"))),
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
                v.literal("clear_fields"),
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
    autoEvalQueuedAt: v.optional(v.number()),
    retentionExpiresAt: v.optional(v.number()),
    payloadSafe: v.optional(v.boolean()),
  })
    .index("by_review_id", ["reviewId"])
    .index("by_session_id", ["sessionId"])
    .index("by_conversation", ["conversationId"])
    .index("by_lead_updated_at", ["leadId", "updatedAt"])
    .index("by_captured_email_normalized", ["capturedEmailNormalized"])
    .index("by_safe_retention_expires_at", ["payloadSafe", "retentionExpiresAt"])
    .index("by_safe_session_state_updated_at", ["payloadSafe", "sessionState", "updatedAt"])
    .index("by_payload_safe_updated_at", ["payloadSafe", "updatedAt"])
    .index("by_updated_at", ["updatedAt"]),
});
