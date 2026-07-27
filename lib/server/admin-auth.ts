import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type AdminPermission,
  type AdminPrincipal,
  type AdminRole,
  configuredAdminIdentity,
  hasAdminPermission,
  isAdminRole,
  isValidAdminActor,
} from "@/lib/admin-permissions";
import { readEnv } from "@/lib/env";

export const adminCookieName = "oriental_admin";

const sessionTtlMs = 12 * 60 * 60 * 1000;
const adminPasswordHmacDomain = "oriental-admin-password:v1\0";
const adminSessionHmacDomain = "oriental-admin-session:v2\0";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
type AdminCredential = "interactive_password" | "review_bearer" | "session" | "ops_bearer" | "privacy_bearer";
export type AdminAuthState =
  | {
      ok: true;
      actor: string;
      credential: AdminCredential;
      expiresAt: number;
      principal: AdminPrincipal;
      role: AdminRole;
    }
  | { ok: false; reason: "unconfigured" | "missing" | "invalid" | "forbidden" | "csrf" };

export function verifyAdminLoginCredential(credential: string | null | undefined): AdminAuthState {
  const expected = readEnv("ADMIN_REVIEW_TOKEN");
  if (!expected) return { ok: false, reason: "unconfigured" };
  if (!credential) return { ok: false, reason: "missing" };
  const method = constantTimeEqual(credential, expected)
    ? "review_bearer"
    : verifyInteractivePassword(credential, expected)
      ? "interactive_password"
      : null;
  if (!method) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    ...configuredAdminIdentity(),
    credential: method,
    expiresAt: Date.now() + sessionTtlMs,
    principal: "interactive",
  };
}

export function createAdminSessionCookie(now = Date.now(), identity = configuredAdminIdentity()) {
  const expiresAt = now + sessionTtlMs;
  const actor = Buffer.from(identity.actor, "utf8").toString("base64url");
  const payload = `v2.${expiresAt}.${identity.role}.${actor}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminSessionCookie(value: string | null | undefined): AdminAuthState {
  const secret = signingSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (!value) return { ok: false, reason: "missing" };
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return { ok: false, reason: "invalid" };
  const payload = parts.slice(0, 4).join(".");
  if (!constantTimeEqual(parts[4] ?? "", sign(payload))) return { ok: false, reason: "invalid" };
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: "invalid" };
  const role = parts[2] ?? "";
  const actorEncoded = parts[3] ?? "";
  if (!isAdminRole(role) || actorEncoded.length === 0 || actorEncoded.length > 108) {
    return { ok: false, reason: "invalid" };
  }
  const actor = Buffer.from(actorEncoded, "base64url").toString("utf8");
  if (!isValidAdminActor(actor) || Buffer.from(actor, "utf8").toString("base64url") !== actorEncoded) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, actor, credential: "session", expiresAt, principal: "interactive", role };
}

export function verifyAdminRequest(request: Request): AdminAuthState {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) return { ok: false, reason: "invalid" };
    return verifyAdminBearerToken(authorization.slice("Bearer ".length).trim());
  }
  return verifyAdminSessionCookie(cookieValue(request.headers.get("cookie"), adminCookieName));
}

export function verifyAdminPermission(request: Request, permission: AdminPermission): AdminAuthState {
  const auth = verifyAdminRequest(request);
  if (!auth.ok) return auth;
  if (!hasAdminPermission(auth.role, permission, auth.principal)) return { ok: false, reason: "forbidden" };
  if (
    auth.credential === "session" &&
    unsafeMethods.has(request.method.toUpperCase()) &&
    !isSameOriginJsonRequest(request)
  ) {
    return { ok: false, reason: "csrf" };
  }
  return auth;
}

export function adminAuthFailureStatus(auth: Extract<AdminAuthState, { ok: false }>) {
  if (auth.reason === "unconfigured") return 503;
  if (auth.reason === "forbidden" || auth.reason === "csrf") return 403;
  return 401;
}

export function isSameOriginJsonRequest(request: Request) {
  if (!unsafeMethods.has(request.method.toUpperCase())) return true;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host")?.trim().toLowerCase() || requestUrl.host.toLowerCase();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
    const requestProtocol =
      forwardedProtocol === "http" || forwardedProtocol === "https" ? `${forwardedProtocol}:` : requestUrl.protocol;
    return originUrl.host.toLowerCase() === requestHost && originUrl.protocol === requestProtocol;
  } catch {
    return false;
  }
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
  return createHmac("sha256", secret).update(adminSessionHmacDomain).update(payload).digest("base64url");
}

function signingSecret() {
  return readEnv("ADMIN_REVIEW_TOKEN");
}

function verifyInteractivePassword(password: string, signingKey: string) {
  const expectedHmac = process.env.ADMIN_REVIEW_PASSWORD_HMAC;
  if (!expectedHmac || !/^[a-f0-9]{64}$/.test(expectedHmac)) return false;
  const actualHmac = createHmac("sha256", signingKey).update(adminPasswordHmacDomain).update(password).digest("hex");
  return constantTimeEqual(actualHmac, expectedHmac);
}

function verifyAdminBearerToken(token: string): AdminAuthState {
  if (!token) return { ok: false, reason: "missing" };
  const interactiveIdentity = configuredAdminIdentity();
  const candidates = [
    {
      actor: interactiveIdentity.actor,
      credential: "review_bearer" as const,
      expected: readEnv("ADMIN_REVIEW_TOKEN"),
      principal: "interactive" as const,
      role: interactiveIdentity.role,
    },
    {
      actor: "Oriental ops automation",
      credential: "ops_bearer" as const,
      expected: readEnv("OPS_AUTOMATION_TOKEN"),
      principal: "automation" as const,
      role: "operator" as const,
    },
    {
      actor: "Oriental privacy administrator",
      credential: "privacy_bearer" as const,
      expected: readEnv("PRIVACY_ADMIN_TOKEN"),
      principal: "privacy" as const,
      role: "admin" as const,
    },
  ];
  if (candidates.every((candidate) => !candidate.expected)) return { ok: false, reason: "unconfigured" };
  for (const candidate of candidates) {
    if (candidate.expected && constantTimeEqual(token, candidate.expected)) {
      return {
        ok: true,
        actor: candidate.actor,
        credential: candidate.credential,
        expiresAt: Date.now() + sessionTtlMs,
        principal: candidate.principal,
        role: candidate.role,
      };
    }
  }
  return { ok: false, reason: "invalid" };
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
