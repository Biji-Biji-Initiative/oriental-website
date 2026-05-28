import { createHmac, timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";

const tokenTtlMs = 6 * 60 * 60 * 1000;

export type VoiceReviewCredentials = {
  id: string;
  token: string;
  expiresAt: number;
};

export function createVoiceReviewCredentials(now = Date.now()): VoiceReviewCredentials {
  const id = crypto.randomUUID();
  const expiresAt = now + tokenTtlMs;
  const payload = `${id}.${expiresAt}`;
  return { id, expiresAt, token: `${payload}.${sign(payload)}` };
}

export function verifyVoiceReviewCredentials(reviewId: string, token: string) {
  const secret = signingSecret();
  if (!secret) return false;
  const [id, expiresAtRaw, signature] = token.split(".");
  if (!id || !expiresAtRaw || !signature || id !== reviewId) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `${id}.${expiresAtRaw}`;
  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

function sign(payload: string) {
  const secret = signingSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signingSecret() {
  return readEnv("IP_HASH_SECRET") ?? readEnv("ADMIN_REVIEW_TOKEN");
}
