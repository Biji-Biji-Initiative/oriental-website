import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";

export const adminCookieName = "oriental_admin";

const sessionTtlMs = 12 * 60 * 60 * 1000;
const sharedAdminPasswordHash = "70ba5f3dd65f091c85e93a0e3155a17121225e799d25e18e8f3675cbb5669c2d";

export type AdminAuthState =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "unconfigured" | "missing" | "invalid" };

export function verifyAdminToken(token: string | null | undefined): AdminAuthState {
  const expected = readEnv("ADMIN_REVIEW_TOKEN");
  if (!expected) return { ok: false, reason: "unconfigured" };
  if (!token) return { ok: false, reason: "missing" };
  if (!constantTimeEqual(token, expected) && !constantTimeEqual(sha256(token), sharedAdminPasswordHash)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, expiresAt: Date.now() + sessionTtlMs };
}

export function createAdminSessionCookie(now = Date.now()) {
  const expiresAt = now + sessionTtlMs;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminSessionCookie(value: string | null | undefined): AdminAuthState {
  const secret = signingSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (!value) return { ok: false, reason: "missing" };
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "invalid" };
  const payload = `${parts[0]}.${parts[1]}`;
  if (!constantTimeEqual(parts[2] ?? "", sign(payload))) return { ok: false, reason: "invalid" };
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: "invalid" };
  return { ok: true, expiresAt };
}

export function verifyAdminRequest(request: Request): AdminAuthState {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return verifyAdminToken(authorization.slice("Bearer ".length).trim());
  }
  return verifyAdminSessionCookie(cookieValue(request.headers.get("cookie"), adminCookieName));
}

export function adminCookieHeader(value: string, expiresAt: number) {
  const secure = readEnv("NODE_ENV") === "production" ? " Secure;" : "";
  return `${adminCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax;${secure} Expires=${new Date(
    expiresAt,
  ).toUTCString()}`;
}

export function clearAdminCookieHeader() {
  const secure = readEnv("NODE_ENV") === "production" ? " Secure;" : "";
  return `${adminCookieName}=; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=0`;
}

function sign(payload: string) {
  const secret = signingSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signingSecret() {
  return readEnv("ADMIN_REVIEW_TOKEN") ?? readEnv("IP_HASH_SECRET");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
