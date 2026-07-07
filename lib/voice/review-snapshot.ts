import type { VoiceReviewSnapshotRequest } from "@/lib/schemas";
import type { VoiceRuntimeState } from "@/lib/voice/realtime-events";
import type { VoiceTransportTelemetry } from "@/lib/voice/transport-telemetry";

type VoiceReviewConnectionStatus = VoiceReviewSnapshotRequest["snapshot"]["connectionStatus"];
type VoiceReviewStatus = VoiceReviewSnapshotRequest["snapshot"]["status"];

export type VoiceReviewCredentials = VoiceReviewSnapshotRequest["review"] & {
  sessionId?: string;
  model?: string;
  voice?: string;
  speed?: number;
  variant?: string | null;
  prewarmedAt?: number;
  connectStartedAt?: number;
  connectedAt?: number;
  firstEventAt?: number;
  transport?: VoiceTransportTelemetry;
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
    conversationId: review.conversationId,
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
    model: review.model,
    voice: review.voice,
    speed: review.speed,
    variant: review.variant,
    captured: state.captured,
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
