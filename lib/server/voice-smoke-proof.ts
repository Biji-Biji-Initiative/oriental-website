import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const VOICE_SMOKE_PROOF_HEADER = "x-mereka-voice-smoke-proof";
export const VOICE_SMOKE_HOSTNAME = "staging.oriental.mereka.io";
export const VOICE_SMOKE_SYNTHETIC_EMAIL = "qa.nebula@example.test";

const proofVersion = "v1";
const proofAudience = "staging-oriental-mereka-io";
const proofMaxAgeMs = 90_000;
const proofFutureSkewMs = 5_000;

/**
 * Create a short-lived staging smoke capability without sending the signing
 * secret to the browser page. The Playwright runner injects only this HMAC into
 * the session request at the network boundary.
 */
export function createVoiceSmokeProof(secret: string, now = Date.now(), nonce: string = randomUUID()) {
  if (!secret) throw new Error("IP_HASH_SECRET is required for the staging voice smoke");
  const issuedAt = Math.trunc(now);
  const payload = `${proofVersion}.${issuedAt}.${nonce}.${proofAudience}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Only the canonical staging hostname may turn a signed proof into synthetic evidence. */
export function verifyVoiceSmokeProof(
  proof: string | null,
  hostname: string,
  secret: string | null | undefined,
  now = Date.now(),
) {
  if (!proof || !secret || hostname.toLowerCase() !== VOICE_SMOKE_HOSTNAME) return false;
  const [version, issuedAtRaw, nonce, audience, signature, ...extra] = proof.split(".");
  if (
    extra.length > 0 ||
    version !== proofVersion ||
    !issuedAtRaw ||
    !nonce ||
    audience !== proofAudience ||
    !signature
  ) {
    return false;
  }
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + proofFutureSkewMs || now - issuedAt > proofMaxAgeMs) {
    return false;
  }
  const payload = `${version}.${issuedAtRaw}.${nonce}.${audience}`;
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
