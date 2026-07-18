import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceReviewCredentials,
  readVoiceReviewCredentialClaims,
  verifyVoiceReviewCredentials,
} from "@/lib/server/voice-review-token";

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

    expect(credentials.token.split(".")).toHaveLength(3);
    expect(verifyVoiceReviewCredentials(credentials.id, credentials.token)).toBe(true);
    expect(verifyVoiceReviewCredentials(crypto.randomUUID(), credentials.token)).toBe(false);

    vi.setSystemTime(new Date(now.getTime() + 7 * 60 * 60 * 1000));
    expect(verifyVoiceReviewCredentials(credentials.id, credentials.token)).toBe(false);
  });

  it("carries an authenticated synthetic claim without trusting the snapshot", () => {
    const credentials = createVoiceReviewCredentials(Date.now(), { synthetic: true });

    expect(readVoiceReviewCredentialClaims(credentials.id, credentials.token)).toEqual({ synthetic: true });
    expect(
      readVoiceReviewCredentialClaims(credentials.id, credentials.token.replace("synthetic", "visitor")),
    ).toBeNull();
    expect(readVoiceReviewCredentialClaims(credentials.id, `${credentials.token}.extra`)).toBeNull();
  });

  it("accepts unexpired legacy credentials as ordinary visitor sessions", () => {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + 60_000;
    const payload = `${id}.${expiresAt}`;
    const signature = createHmac("sha256", "voice-review-secret").update(payload).digest("base64url");

    expect(readVoiceReviewCredentialClaims(id, `${payload}.${signature}`)).toEqual({ synthetic: false });
  });
});
