import { describe, expect, it } from "vitest";
import {
  REALTIME_BUSY_RETRY_MAX_MS,
  REALTIME_BUSY_RETRY_MIN_MS,
  realtimeBusyRetryDelayMs,
  shouldRetryRealtimeCall,
} from "@/lib/voice/realtime-retry";

describe("Realtime busy retry policy", () => {
  it("retries one capacity 429 and never retries other failures", () => {
    expect(shouldRetryRealtimeCall("realtime_busy", 0)).toBe(true);
    expect(shouldRetryRealtimeCall("realtime_busy", 1)).toBe(false);
    expect(shouldRetryRealtimeCall("realtime_quota_exhausted", 0)).toBe(false);
    expect(shouldRetryRealtimeCall("webrtc_failed", 0)).toBe(false);
  });

  it("bounds jitter between 300 and 700 milliseconds", () => {
    expect(realtimeBusyRetryDelayMs(-1)).toBe(REALTIME_BUSY_RETRY_MIN_MS);
    expect(realtimeBusyRetryDelayMs(0.5)).toBe(500);
    expect(realtimeBusyRetryDelayMs(2)).toBe(REALTIME_BUSY_RETRY_MAX_MS);
  });
});
