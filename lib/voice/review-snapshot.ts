import type { VoiceReviewSnapshotRequest } from "@/lib/schemas";
import { isConversationId } from "@/lib/voice/conversation";
import type { VoiceModelCell, VoiceReasoningCell } from "@/lib/voice/experiments";
import type { VoiceInputPolicy, VoiceLatencyTelemetry } from "@/lib/voice/latency";
import type { VoiceRuntimeState } from "@/lib/voice/realtime-events";
import type { VoiceRuntimeProfileId } from "@/lib/voice/runtime-profile";
import type { VoiceTransportTelemetry } from "@/lib/voice/transport-telemetry";

type VoiceReviewConnectionStatus = VoiceReviewSnapshotRequest["snapshot"]["connectionStatus"];
type VoiceReviewStatus = VoiceReviewSnapshotRequest["snapshot"]["status"];

export type VoiceReviewCredentials = VoiceReviewSnapshotRequest["review"] & {
  sessionId?: string;
  model?: string;
  modelCell?: VoiceModelCell;
  reasoningCell?: VoiceReasoningCell;
  voice?: string;
  speed?: number;
  deviceProfile?: "mobile" | "desktop";
  deploymentEnvironment?: "local" | "staging" | "production";
  activationAttempted?: boolean;
  variant?: string | null;
  runtimeProfile?: VoiceRuntimeProfileId;
  inputPolicy?: VoiceInputPolicy;
  prewarmedAt?: number;
  connectStartedAt?: number;
  connectedAt?: number;
  firstEventAt?: number;
  transport?: VoiceTransportTelemetry;
  latency?: VoiceLatencyTelemetry;
  conversationId?: string;
};

export function buildVoiceReviewSnapshot(
  review: VoiceReviewCredentials,
  state: VoiceRuntimeState,
  connectionStatus: VoiceReviewConnectionStatus,
  overrides: {
    leadId?: string | null;
    status?: VoiceReviewStatus;
    submittedAt?: number;
    closeReason?: VoiceReviewSnapshotRequest["snapshot"]["closeReason"];
    closedAt?: number;
  } = {},
): VoiceReviewSnapshotRequest["snapshot"] {
  return {
    sessionId: review.sessionId ?? review.id,
    ...(isConversationId(review.conversationId) ? { conversationId: review.conversationId } : {}),
    leadId: overrides.leadId,
    segment: state.segment,
    status: overrides.status ?? (overrides.submittedAt ? "submitted" : "idle"),
    connectionStatus,
    closeReason: overrides.closeReason,
    prewarmedAt: review.prewarmedAt,
    connectStartedAt: review.connectStartedAt,
    connectedAt: review.connectedAt,
    firstEventAt: review.firstEventAt,
    closedAt: overrides.closedAt,
    transport: review.transport,
    latency: review.latency,
    model: review.model,
    modelCell: review.modelCell,
    reasoningCell: review.reasoningCell,
    voice: review.voice,
    speed: review.speed,
    deviceProfile: review.deviceProfile,
    deploymentEnvironment: review.deploymentEnvironment,
    activationAttempted: review.activationAttempted,
    variant: review.variant,
    runtimeProfile: review.runtimeProfile,
    inputPolicy: review.inputPolicy,
    captured: state.captured,
    emailVerification: state.emailVerification
      ? {
          source: state.emailVerification.source,
          status: state.emailVerification.status,
          matchesCaptured:
            state.emailVerification.value.trim().toLowerCase() === state.captured.email.trim().toLowerCase(),
        }
      : undefined,
    transcript: state.transcript,
    usage: state.usage,
    errors: state.errors ?? [],
    rateLimits: state.rateLimits ?? [],
    routeRequested: state.routeRequested ?? false,
    submittedAt: overrides.submittedAt,
  };
}

export async function postVoiceReviewSnapshot(
  review: VoiceReviewCredentials,
  snapshot: VoiceReviewSnapshotRequest["snapshot"],
  options: { keepalive?: boolean } = {},
) {
  const payload = JSON.stringify({ review: { id: review.id, token: review.token }, snapshot });
  if (options.keepalive && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    const body = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon("/api/voice/debug", body)) return;
  }

  const response = await fetch("/api/voice/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: options.keepalive,
  });
  if (!response.ok) throw new Error(`voice_review_snapshot_${response.status}`);
}
