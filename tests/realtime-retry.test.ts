import { describe, expect, it } from "vitest";
import {
  REALTIME_BUSY_RETRY_MAX_MS,
  REALTIME_BUSY_RETRY_MIN_MS,
  realtimeBusyRetryDelayMs,
  shouldRetryRealtimeCall,
} from "@/lib/voice/realtime-retry";

describe("Realtime busy retry policy", () => {
  it("retries one capacity 429 and never retries other failures", () => {
    expect(shouldRetryRealtimeCall(429, 0)).toBe(true);
    expect(shouldRetryRealtimeCall(429, 1)).toBe(false);
    expect(shouldRetryRealtimeCall(400, 0)).toBe(false);
    expect(shouldRetryRealtimeCall(500, 0)).toBe(false);
  });

  it("bounds jitter between 300 and 700 milliseconds", () => {
    expect(realtimeBusyRetryDelayMs(-1)).toBe(REALTIME_BUSY_RETRY_MIN_MS);
    expect(realtimeBusyRetryDelayMs(0.5)).toBe(500);
    expect(realtimeBusyRetryDelayMs(2)).toBe(REALTIME_BUSY_RETRY_MAX_MS);
  });
});
