import { createHmac } from "node:crypto";
import { cleanup, render } from "@testing-library/react";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/login/route";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { adminCookieName, verifyAdminSessionCookie } from "@/lib/server/admin-auth";
import { resetRateLimitBucketsForTest } from "@/lib/server/security";

const originalEnv = process.env;
const adminReviewToken = "admin-review-token-123456789";
const interactivePassword = "shared-test-password-123";
const interactivePasswordHmac = createHmac("sha256", adminReviewToken)
  .update("oriental-admin-password:v1\0")
  .update(interactivePassword)
  .digest("hex");

describe("admin login route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_ACTOR: "Test operator",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_TOKEN: adminReviewToken,
      ADMIN_REVIEW_PASSWORD_HMAC: interactivePasswordHmac,
      IP_HASH_SECRET: "admin-login-test-hash-secret",
      REDIS_URL: undefined,
      UPSTASH_REDIS_URL: undefined,
      VALKEY_URL: undefined,
    };
    resetRateLimitBucketsForTest();
  });

  afterEach(() => {
    cleanup();
    resetRateLimitBucketsForTest();
    process.env = originalEnv;
  });

  it("sets a root-scoped session for the governed token or managed interactive password", async () => {
    const rejected = await POST(loginRequest("legacy-alias", "203.0.113.7"));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(rejected.headers.get("x-ratelimit-store")).toBe("memory");
    expect(rejected.headers.get("x-ratelimit-remaining")).toBe("7");

    const acceptedToken = await POST(loginRequest(adminReviewToken, "203.0.113.7"));
    expect(acceptedToken.status).toBe(200);
    expect(acceptedToken.headers.get("set-cookie")).toContain(`${adminCookieName}=`);
    expect(acceptedToken.headers.get("set-cookie")).toContain("Path=/;");
    expect(acceptedToken.headers.get("x-ratelimit-store")).toBe("memory");
    expect(acceptedToken.headers.get("x-ratelimit-remaining")).toBe("6");
    expect(verifyAdminSessionCookie(sessionValue(acceptedToken))).toMatchObject({
      ok: true,
      credential: "review_session",
      role: "operator",
    });

    const passwordStartedAt = Date.now();
    const acceptedPassword = await POST(loginRequest(interactivePassword, "203.0.113.8"));
    expect(acceptedPassword.status).toBe(200);
    expect(acceptedPassword.headers.get("set-cookie")).toContain(`${adminCookieName}=`);
    expect(acceptedPassword.headers.get("x-ratelimit-store")).toBe("memory");
    expect(acceptedPassword.headers.get("x-ratelimit-remaining")).toBe("7");
    const passwordSession = verifyAdminSessionCookie(sessionValue(acceptedPassword));
    expect(passwordSession).toMatchObject({
      ok: true,
      credential: "password_session",
      principal: "password",
      role: "admin",
    });
    expect(passwordSession.ok && passwordSession.expiresAt).toBeGreaterThanOrEqual(passwordStartedAt + 30 * 60 * 1000);
    expect(passwordSession.ok && passwordSession.expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
  });

  it("rate-limits repeated attempts by the proxy-owned identity even when the client spoofs earlier hops", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(loginRequest("wrong-token", `198.51.100.${attempt + 1}, 203.0.113.99`));
      expect(response.status).toBe(401);
      expect(response.headers.get("x-ratelimit-store")).toBe("memory");
      expect(response.headers.get("x-ratelimit-remaining")).toBe(String(7 - attempt));
    }

    const blocked = await POST(loginRequest(adminReviewToken, "192.0.2.44, 203.0.113.99"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-ratelimit-store")).toBe("memory");
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
    await expect(blocked.json()).resolves.toEqual({ ok: false, error: "rate_limited" });

    const independent = await POST(loginRequest(adminReviewToken, "192.0.2.44, 203.0.113.100"));
    expect(independent.status).toBe(200);
    expect(verifyAdminSessionCookie(sessionValue(independent))).toMatchObject({
      ok: true,
      credential: "review_session",
    });
  });

  it("rejects missing, malformed, cross-origin, and non-JSON login attempts before consuming credentials", async () => {
    const missingOrigin = new NextRequest("http://localhost/api/admin/login", {
      body: JSON.stringify({ token: adminReviewToken }),
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.8" },
      method: "POST",
    });
    expect((await POST(missingOrigin)).status).toBe(403);

    const malformedOrigin = await POST(loginRequest(adminReviewToken, "203.0.113.8", "not-an-origin"));
    expect(malformedOrigin.status).toBe(403);

    const crossOrigin = await POST(loginRequest(adminReviewToken, "203.0.113.8", "https://attacker.test"));
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toEqual({ ok: false, error: "csrf" });

    const nonJson = new NextRequest("http://localhost/api/admin/login", {
      body: "token=admin-review-token-123456789",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost" },
      method: "POST",
    });
    expect((await POST(nonJson)).status).toBe(403);
  });

  it("uses a native POST fallback so pre-hydration submits cannot put the token in the URL", () => {
    const { container } = render(createElement(AdminLoginForm, {}));
    const form = container.querySelector("form");

    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/admin/login");
  });
});

function sessionValue(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  return cookie?.slice(`${adminCookieName}=`.length);
}

function loginRequest(token: string, ip: string, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/admin/login", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json", origin, "x-forwarded-for": ip },
    method: "POST",
  });
}
