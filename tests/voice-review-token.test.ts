import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceReviewCredentials, verifyVoiceReviewCredentials } from "@/lib/server/voice-review-token";

const originalEnv = process.env;

describe("voice review tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env = {
      ...originalEnv,
      IP_HASH_SECRET: "voice-review-secret",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("creates short-lived signed credentials for voice session review", () => {
    const now = new Date("2026-05-28T00:00:00Z");
    vi.setSystemTime(now);
    const credentials = createVoiceReviewCredentials(now.getTime());

    expect(verifyVoiceReviewCredentials(credentials.id, credentials.token)).toBe(true);
    expect(verifyVoiceReviewCredentials(crypto.randomUUID(), credentials.token)).toBe(false);

    vi.setSystemTime(new Date(now.getTime() + 7 * 60 * 60 * 1000));
    expect(verifyVoiceReviewCredentials(credentials.id, credentials.token)).toBe(false);
  });
});
