import { describe, expect, it } from "vitest";
import { createVoiceSmokeProof, VOICE_SMOKE_HOSTNAME, verifyVoiceSmokeProof } from "@/lib/server/voice-smoke-proof";

describe("staging voice smoke proof", () => {
  const secret = "smoke-proof-secret";
  const now = Date.parse("2026-07-18T02:00:00.000Z");

  it("accepts one fresh proof only on the canonical staging hostname", () => {
    const proof = createVoiceSmokeProof(secret, now, "probe-nonce");

    expect(
      verifyVoiceSmokeProof(
        proof,
        { hostname: VOICE_SMOKE_HOSTNAME, deploymentEnvironment: "staging" },
        secret,
        now + 1_000,
      ),
    ).toBe(true);
    expect(
      verifyVoiceSmokeProof(
        proof,
        { hostname: "oriental.mereka.io", deploymentEnvironment: "staging" },
        secret,
        now + 1_000,
      ),
    ).toBe(false);
  });

  it("accepts a managed staging reverse-proxy URL but never another environment", () => {
    const proof = createVoiceSmokeProof(secret, now, "proxy-nonce");

    expect(
      verifyVoiceSmokeProof(
        proof,
        { hostname: "oriental-staging-1ff751c", deploymentEnvironment: "staging" },
        secret,
        now,
      ),
    ).toBe(true);
    expect(
      verifyVoiceSmokeProof(
        proof,
        { hostname: VOICE_SMOKE_HOSTNAME, deploymentEnvironment: "production" },
        secret,
        now,
      ),
    ).toBe(false);
  });

  it("rejects stale, future, malformed, and tampered proofs", () => {
    const proof = createVoiceSmokeProof(secret, now, "probe-nonce");

    const context = { hostname: VOICE_SMOKE_HOSTNAME, deploymentEnvironment: "staging" as const };
    expect(verifyVoiceSmokeProof(proof, context, secret, now + 90_001)).toBe(false);
    expect(verifyVoiceSmokeProof(proof, context, secret, now - 5_001)).toBe(false);
    expect(verifyVoiceSmokeProof(`${proof}extra`, context, secret, now)).toBe(false);
    expect(verifyVoiceSmokeProof(`${proof}.extra`, context, secret, now)).toBe(false);
    expect(verifyVoiceSmokeProof(proof, context, "wrong-secret", now)).toBe(false);
  });
});
