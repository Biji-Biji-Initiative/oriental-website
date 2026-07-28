import type { NextRequest } from "next/server";
import { adminLoginSchema } from "@/lib/schemas";
import {
  adminCookieHeader,
  createAdminSessionCookie,
  isSameOriginJsonRequest,
  verifyAdminLoginCredential,
} from "@/lib/server/admin-auth";
import { logInfo } from "@/lib/server/logger";
import { checkRateLimit, hashIp, noStoreJson, rateLimitResponseHeaders, requestIp } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_LOGIN_ATTEMPTS = 8;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!isSameOriginJsonRequest(request)) {
    return noStoreJson({ ok: false, error: "csrf" }, { status: 403 });
  }
  const ipHash = hashIp(requestIp(request), "admin-login");
  const limit = await checkRateLimit(`admin-login:${ipHash}`, ADMIN_LOGIN_ATTEMPTS, ADMIN_LOGIN_WINDOW_MS);
  if (!limit.ok) {
    return noStoreJson(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rateLimitResponseHeaders(limit.resetAt) },
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = adminLoginSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_payload" }, { status: 400 });

  const auth = verifyAdminLoginCredential(parsed.data.token);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const cookie = createAdminSessionCookie(Date.now(), auth);
  logInfo("admin_login.succeeded", {
    actor: auth.actor,
    credential: auth.credential,
    expiresAt: auth.expiresAt,
    role: auth.role,
  });
  return noStoreJson(
    { ok: true },
    {
      headers: { "Set-Cookie": adminCookieHeader(cookie, auth.expiresAt) },
    },
  );
}
