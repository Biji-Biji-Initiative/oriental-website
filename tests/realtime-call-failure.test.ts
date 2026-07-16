import { describe, expect, it } from "vitest";
import { isVoiceAvailabilityFailure, readRealtimeCallFailure } from "@/lib/voice/realtime-call-failure";

describe("OpenAI Realtime call failure classification", () => {
  it("separates exhausted project quota from transient 429 capacity", async () => {
    const quota = await readRealtimeCallFailure(
      Response.json(
        { error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota exhausted" } },
        { status: 429 },
      ),
    );
    const capacity = await readRealtimeCallFailure(
      Response.json({ error: { type: "rate_limit_error", code: "rate_limit_exceeded" } }, { status: 429 }),
    );

    expect(quota).toEqual({
      closeReason: "realtime_quota_exhausted",
      code: "insufficient_quota",
      type: "insufficient_quota",
    });
    expect(capacity).toEqual({
      closeReason: "realtime_busy",
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
    });
  });

  it("keeps malformed 429 responses retryable but treats other statuses as transport failures", async () => {
    await expect(readRealtimeCallFailure(new Response("not-json", { status: 429 }))).resolves.toEqual({
      closeReason: "realtime_busy",
    });
    await expect(readRealtimeCallFailure(new Response("upstream down", { status: 503 }))).resolves.toEqual({
      closeReason: "webrtc_failed",
    });
  });

  it("recognizes close reasons that should count against voice availability", () => {
    expect(isVoiceAvailabilityFailure("realtime_quota_exhausted")).toBe(true);
    expect(isVoiceAvailabilityFailure("disconnected")).toBe(true);
    expect(isVoiceAvailabilityFailure("manual")).toBe(false);
  });
});
