export type RealtimeCallCloseReason = "realtime_busy" | "realtime_quota_exhausted" | "webrtc_failed";

export const VOICE_AVAILABILITY_FAILURE_REASONS = [
  "realtime_busy",
  "realtime_quota_exhausted",
  "webrtc_failed",
  "session_failed",
  "disconnected",
  "error",
] as const;

export type VoiceAvailabilityFailureReason = (typeof VOICE_AVAILABILITY_FAILURE_REASONS)[number];

type RealtimeErrorPayload = {
  error?: {
    code?: unknown;
    type?: unknown;
  };
};

export type RealtimeCallFailure = {
  closeReason: RealtimeCallCloseReason;
  code?: string;
  type?: string;
};

/**
 * OpenAI uses HTTP 429 for both transient capacity and exhausted project quota.
 * They have opposite recovery policies, so the response body must participate
 * in classification instead of treating every 429 as retryable "busy".
 */
export async function readRealtimeCallFailure(response: Response): Promise<RealtimeCallFailure> {
  if (response.status !== 429) return { closeReason: "webrtc_failed" };

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as RealtimeErrorPayload | null;
  const code = stringValue(payload?.error?.code);
  const type = stringValue(payload?.error?.type);
  const quotaExhausted = code === "insufficient_quota" || type === "insufficient_quota";

  return {
    closeReason: quotaExhausted ? "realtime_quota_exhausted" : "realtime_busy",
    ...(code ? { code } : {}),
    ...(type ? { type } : {}),
  };
}

export function isVoiceAvailabilityFailure(reason: unknown): reason is VoiceAvailabilityFailureReason {
  return VOICE_AVAILABILITY_FAILURE_REASONS.some((candidate) => candidate === reason);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
