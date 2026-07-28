import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORPHAN_STALE_MINUTES,
  MIN_ORPHAN_STALE_MINUTES,
  MIN_ORPHAN_STALE_MS,
  resolveVoiceDurationPolicy,
  VOICE_DURATION_DEFAULTS,
  VOICE_DURATION_LIMITS,
  VOICE_HEARTBEAT_INTERVAL_MS,
} from "@/lib/voice/session-policy";

describe("voice duration policy", () => {
  it("has one typed rollback-safe default", () => {
    expect(resolveVoiceDurationPolicy({})).toEqual(VOICE_DURATION_DEFAULTS);
  });

  it("derives orphan eligibility beyond every valid live-call deadline", () => {
    expect(MIN_ORPHAN_STALE_MS).toBe(
      VOICE_DURATION_LIMITS.maxDurationMs +
        VOICE_DURATION_LIMITS.maxIdleGoodbyeGraceMs +
        2 * VOICE_HEARTBEAT_INTERVAL_MS,
    );
    expect(MIN_ORPHAN_STALE_MS).toBe(1_854_000);
    expect(MIN_ORPHAN_STALE_MINUTES).toBe(31);
    expect(DEFAULT_ORPHAN_STALE_MINUTES).toBeGreaterThanOrEqual(MIN_ORPHAN_STALE_MINUTES);
  });

  it("accepts bounded operator overrides", () => {
    expect(
      resolveVoiceDurationPolicy({ maxDurationMs: "300000", idleTimeoutMs: "30000", idleGoodbyeGraceMs: "8000" }),
    ).toEqual({ maxDurationMs: 300_000, idleTimeoutMs: 30_000, idleGoodbyeGraceMs: 8_000 });
  });

  it("falls back for unsafe values and keeps goodbye grace inside idle timeout", () => {
    expect(resolveVoiceDurationPolicy({ maxDurationMs: 1, idleTimeoutMs: 10_000, idleGoodbyeGraceMs: 30_000 })).toEqual(
      {
        maxDurationMs: 600_000,
        idleTimeoutMs: 10_000,
        idleGoodbyeGraceMs: 9_000,
      },
    );
  });
});
