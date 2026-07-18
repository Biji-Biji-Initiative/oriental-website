import { describe, expect, it } from "vitest";
import { createVoiceSmokeProof, VOICE_SMOKE_HOSTNAME, verifyVoiceSmokeProof } from "@/lib/server/voice-smoke-proof";

describe("staging voice smoke proof", () => {
  const secret = "smoke-proof-secret";
  const now = Date.parse("2026-07-18T02:00:00.000Z");

  it("accepts one fresh proof only on the canonical staging hostname", () => {
    const proof = createVoiceSmokeProof(secret, now, "probe-nonce");

    expect(verifyVoiceSmokeProof(proof, VOICE_SMOKE_HOSTNAME, secret, now + 1_000)).toBe(true);
    expect(verifyVoiceSmokeProof(proof, "oriental.mereka.io", secret, now + 1_000)).toBe(false);
  });

  it("rejects stale, future, malformed, and tampered proofs", () => {
    const proof = createVoiceSmokeProof(secret, now, "probe-nonce");

    expect(verifyVoiceSmokeProof(proof, VOICE_SMOKE_HOSTNAME, secret, now + 90_001)).toBe(false);
    expect(verifyVoiceSmokeProof(proof, VOICE_SMOKE_HOSTNAME, secret, now - 5_001)).toBe(false);
    expect(verifyVoiceSmokeProof(`${proof}extra`, VOICE_SMOKE_HOSTNAME, secret, now)).toBe(false);
    expect(verifyVoiceSmokeProof(`${proof}.extra`, VOICE_SMOKE_HOSTNAME, secret, now)).toBe(false);
    expect(verifyVoiceSmokeProof(proof, VOICE_SMOKE_HOSTNAME, "wrong-secret", now)).toBe(false);
  });
});
