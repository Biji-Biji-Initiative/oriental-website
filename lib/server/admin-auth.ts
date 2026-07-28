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
const passwordSessionTtlMs = 30 * 60 * 1000;
const adminPasswordHmacDomain = "oriental-admin-password:v1\0";
const adminSessionHmacDomain = "oriental-admin-session:v3\0";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const verifiedAdminLoginProof = Symbol("verified-admin-login");
type AdminCredential =
  | "interactive_password"
  | "review_bearer"
  | "password_session"
  | "review_session"
  | "ops_bearer"
  | "privacy_bearer";
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
export type AdminLoginSuccess = Extract<AdminAuthState, { ok: true }> & {
  credential: "interactive_password" | "review_bearer";
  principal: "interactive";
  readonly [verifiedAdminLoginProof]: true;
};
type AdminLoginState = AdminLoginSuccess | Extract<AdminAuthState, { ok: false }>;

export function verifyAdminLoginCredential(credential: string | null | undefined): AdminLoginState {
  const configuration = adminCredentialConfiguration();
  if (!configuration || configuration.passwordBearerCollision) return { ok: false, reason: "unconfigured" };
  if (!credential) return { ok: false, reason: "missing" };
  const method = constantTimeEqual(credential, configuration.signingKey)
    ? "review_bearer"
    : configuration.passwordHmac &&
        verifyInteractivePassword(credential, configuration.signingKey, configuration.passwordHmac)
      ? "interactive_password"
      : null;
  if (!method) return { ok: false, reason: "invalid" };
  const identity = configuredAdminIdentity();
  const passwordLogin = method === "interactive_password";
  return {
    ok: true,
    actor: identity.actor,
    credential: method,
    expiresAt: Date.now() + (passwordLogin ? passwordSessionTtlMs : sessionTtlMs),
    principal: "interactive",
    role: passwordLogin ? "viewer" : identity.role,
    [verifiedAdminLoginProof]: true,
  };
}

export function createAdminLoginSession(identity: AdminLoginSuccess, now: number) {
  if (
    identity[verifiedAdminLoginProof] !== true ||
    identity.principal !== "interactive" ||
    !isValidAdminActor(identity.actor) ||
    !isAdminRole(identity.role) ||
    (identity.credential === "interactive_password" && identity.role !== "viewer")
  ) {
    throw new Error("Invalid admin login identity");
  }

  let expiresAt: number;
  let method: "password" | "review";
  let role: AdminRole;
  switch (identity.credential) {
    case "interactive_password":
      expiresAt = now + passwordSessionTtlMs;
      method = "password";
      role = "viewer";
      break;
    case "review_bearer":
      expiresAt = now + sessionTtlMs;
      method = "review";
      role = identity.role;
      break;
    default:
      return assertNever(identity.credential);
  }

  const actor = Buffer.from(identity.actor, "utf8").toString("base64url");
  const payload = `v3.${expiresAt}.${role}.${actor}.${method}`;
  return { cookie: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyAdminSessionCookie(value: string | null | undefined): AdminAuthState {
  const configuration = adminCredentialConfiguration();
  if (!configuration || configuration.passwordBearerCollision) return { ok: false, reason: "unconfigured" };
  if (!value) return { ok: false, reason: "missing" };
  const parts = value.split(".");
  if (parts.length !== 6 || parts[0] !== "v3") return { ok: false, reason: "invalid" };
  const payload = parts.slice(0, 5).join(".");
  if (!constantTimeEqual(parts[5] ?? "", sign(payload))) return { ok: false, reason: "invalid" };
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, reason: "invalid" };
  const role = parts[2] ?? "";
  const actorEncoded = parts[3] ?? "";
  const method = parts[4];
  if (
    !isAdminRole(role) ||
    actorEncoded.length === 0 ||
    actorEncoded.length > 108 ||
    (method !== "password" && method !== "review") ||
    (method === "password" && (role !== "viewer" || !configuration.passwordHmac))
  ) {
    return { ok: false, reason: "invalid" };
  }
  const actor = Buffer.from(actorEncoded, "base64url").toString("utf8");
  if (!isValidAdminActor(actor) || Buffer.from(actor, "utf8").toString("base64url") !== actorEncoded) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    actor,
    credential: method === "password" ? "password_session" : "review_session",
    expiresAt,
    principal: "interactive",
    role,
  };
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
  if (
    auth.credential === "password_session" &&
    permission !== "dashboard.aggregate" &&
    permission !== "session.logout"
  ) {
    return { ok: false, reason: "forbidden" };
  }
  if (!hasAdminPermission(auth.role, permission, auth.principal)) return { ok: false, reason: "forbidden" };
  if (
    isSessionCredential(auth.credential) &&
    unsafeMethods.has(request.method.toUpperCase()) &&
    !isSameOriginJsonRequest(request)
  ) {
    return { ok: false, reason: "csrf" };
  }
  return auth;
}

function isSessionCredential(credential: AdminCredential) {
  return credential === "password_session" || credential === "review_session";
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
  const configuration = adminCredentialConfiguration();
  return configuration && !configuration.passwordBearerCollision ? configuration.signingKey : null;
}

function verifyInteractivePassword(password: string, signingKey: string, expectedHmac: string) {
  const actualHmac = passwordHmacFor(password, signingKey);
  return constantTimeEqual(actualHmac, expectedHmac);
}

function adminCredentialConfiguration() {
  const signingKey = readEnv("ADMIN_REVIEW_TOKEN");
  const passwordHmacValue = process.env.ADMIN_REVIEW_PASSWORD_HMAC;
  if (!signingKey) return null;
  const passwordHmac = passwordHmacValue && /^[a-f0-9]{64}$/.test(passwordHmacValue) ? passwordHmacValue : null;

  const bearerCandidates = [signingKey, readEnv("OPS_AUTOMATION_TOKEN"), readEnv("PRIVACY_ADMIN_TOKEN")].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  const passwordBearerCollision = Boolean(
    passwordHmac &&
      bearerCandidates.some((candidate) => constantTimeEqual(passwordHmacFor(candidate, signingKey), passwordHmac)),
  );
  return { passwordBearerCollision, passwordHmac, signingKey };
}

function passwordHmacFor(password: string, signingKey: string) {
  return createHmac("sha256", signingKey).update(adminPasswordHmacDomain).update(password).digest("hex");
}

function verifyAdminBearerToken(token: string): AdminAuthState {
  if (!token) return { ok: false, reason: "missing" };
  const configuration = adminCredentialConfiguration();
  if (!configuration || configuration.passwordBearerCollision) return { ok: false, reason: "unconfigured" };
  const interactiveIdentity = configuredAdminIdentity();
  const candidates = [
    {
      actor: interactiveIdentity.actor,
      credential: "review_bearer" as const,
      expected: configuration.signingKey,
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

function assertNever(value: never): never {
  throw new Error(`Unhandled admin login credential: ${String(value)}`);
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
