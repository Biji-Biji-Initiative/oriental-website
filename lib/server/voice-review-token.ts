import { createHmac, timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";

const tokenTtlMs = 6 * 60 * 60 * 1000;

export type VoiceReviewCredentials = {
  id: string;
  token: string;
  expiresAt: number;
};

export type VoiceReviewCredentialClaims = {
  synthetic: boolean;
};

export function createVoiceReviewCredentials(
  now = Date.now(),
  claims: VoiceReviewCredentialClaims = { synthetic: false },
): VoiceReviewCredentials {
  const id = crypto.randomUUID();
  const expiresAt = now + tokenTtlMs;
  // Ordinary visitors keep the established three-part token contract so a
  // mixed-version rollout or rollback can continue accepting active reviews.
  // Only the staging smoke needs the explicit fourth-part capability claim.
  const payload = claims.synthetic ? `${id}.${expiresAt}.synthetic` : `${id}.${expiresAt}`;
  return { id, expiresAt, token: `${payload}.${sign(payload)}` };
}

export function verifyVoiceReviewCredentials(reviewId: string, token: string) {
  return readVoiceReviewCredentialClaims(reviewId, token) !== null;
}

export function readVoiceReviewCredentialClaims(reviewId: string, token: string): VoiceReviewCredentialClaims | null {
  const secret = signingSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  // Three-part tokens were issued by the previous release. Keep them valid for
  // their short TTL and treat them as ordinary visitor sessions.
  const legacy = parts.length === 3;
  const [id, expiresAtRaw, kindOrSignature, currentSignature] = parts;
  const kind = legacy ? "visitor" : kindOrSignature;
  const signature = legacy ? kindOrSignature : currentSignature;
  if (!id || !expiresAtRaw || !signature || id !== reviewId || (kind !== "visitor" && kind !== "synthetic")) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const payload = legacy ? `${id}.${expiresAtRaw}` : `${id}.${expiresAtRaw}.${kind}`;
  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  return { synthetic: kind === "synthetic" };
}

function sign(payload: string) {
  const secret = signingSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signingSecret() {
  return readEnv("IP_HASH_SECRET") ?? readEnv("ADMIN_REVIEW_TOKEN");
}
