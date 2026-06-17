import type { VoiceReviewSnapshotRequest } from "@/lib/schemas";
import type { VoiceRuntimeState } from "@/lib/voice/realtime-events";

type VoiceReviewConnectionStatus = VoiceReviewSnapshotRequest["snapshot"]["connectionStatus"];
type VoiceReviewStatus = VoiceReviewSnapshotRequest["snapshot"]["status"];

export type VoiceReviewCredentials = VoiceReviewSnapshotRequest["review"] & {
  sessionId?: string;
  model?: string;
  voice?: string;
  speed?: number;
  variant?: string | null;
};

export function buildVoiceReviewSnapshot(
  review: VoiceReviewCredentials,
  state: VoiceRuntimeState,
  connectionStatus: VoiceReviewConnectionStatus,
  overrides: { leadId?: string | null; status?: VoiceReviewStatus; submittedAt?: number } = {},
): VoiceReviewSnapshotRequest["snapshot"] {
  return {
    sessionId: review.sessionId ?? review.id,
    leadId: overrides.leadId,
    segment: state.segment,
    status: overrides.status ?? (overrides.submittedAt ? "submitted" : "idle"),
    connectionStatus,
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
) {
  await fetch("/api/voice/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review: { id: review.id, token: review.token }, snapshot }),
  });
}
