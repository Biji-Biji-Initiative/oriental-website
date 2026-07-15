import { describe, expect, it } from "vitest";
import { resolveVoiceDurationPolicy, VOICE_DURATION_DEFAULTS } from "@/lib/voice/session-policy";

describe("voice duration policy", () => {
  it("has one typed rollback-safe default", () => {
    expect(resolveVoiceDurationPolicy({})).toEqual(VOICE_DURATION_DEFAULTS);
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
