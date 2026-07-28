import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminCookieHeader,
  adminCookieName,
  clearAdminCookieHeader,
  createAdminSessionCookie,
  verifyAdminLoginCredential,
  verifyAdminPermission,
  verifyAdminRequest,
  verifyAdminSessionCookie,
} from "@/lib/server/admin-auth";

const originalEnv = process.env;
const adminReviewToken = "admin-review-token-123456789";
const interactivePassword = "shared-test-password-123";
const passwordHmacDomain = "oriental-admin-password:v1\0";

function interactivePasswordHmac(password: string, signingKey = adminReviewToken) {
  return createHmac("sha256", signingKey).update(passwordHmacDomain).update(password).digest("hex");
}

describe("admin auth helpers", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_ACTOR: "Interactive operator",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_TOKEN: adminReviewToken,
      ADMIN_REVIEW_PASSWORD_HMAC: interactivePasswordHmac(interactivePassword),
      OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789",
      PRIVACY_ADMIN_TOKEN: "privacy-admin-token-123456789",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("validates login credentials with distinct provenance and signed session cookies", () => {
    expect(verifyAdminLoginCredential("bad-token")).toMatchObject({ ok: false, reason: "invalid" });
    const reviewLogin = verifyAdminLoginCredential(adminReviewToken);
    expect(reviewLogin).toMatchObject({
      ok: true,
      actor: "Interactive operator",
      credential: "review_bearer",
      principal: "interactive",
      role: "operator",
    });
    const passwordLogin = verifyAdminLoginCredential(interactivePassword);
    expect(passwordLogin).toMatchObject({
      ok: true,
      actor: "Interactive operator",
      credential: "interactive_password",
      principal: "interactive",
      role: "viewer",
    });

    const now = Date.now();
    const reviewCookie = createAdminSessionCookie(now, reviewLogin.ok ? reviewLogin : undefined);
    expect(verifyAdminSessionCookie(reviewCookie)).toMatchObject({
      ok: true,
      credential: "review_session",
      expiresAt: now + 12 * 60 * 60 * 1000,
      role: "operator",
    });
    const passwordCookie = createAdminSessionCookie(now, passwordLogin.ok ? passwordLogin : undefined);
    expect(verifyAdminSessionCookie(passwordCookie)).toMatchObject({
      ok: true,
      credential: "password_session",
      expiresAt: now + 30 * 60 * 1000,
      role: "viewer",
    });

    const request = new Request("http://localhost/api/admin/review", {
      headers: { cookie: `${adminCookieName}=${passwordCookie}` },
    });
    expect(verifyAdminRequest(request)).toMatchObject({
      ok: true,
      credential: "password_session",
      role: "viewer",
    });
    expect(
      verifyAdminPermission(
        new Request("http://localhost/api/admin/leads/lead-1", {
          method: "PATCH",
          headers: {
            cookie: `${adminCookieName}=${passwordCookie}`,
            "content-type": "application/json",
            origin: "http://localhost",
          },
        }),
        "leads.update",
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("keeps the interactive password out of bearer authentication and fails closed on invalid HMAC configuration", () => {
    const passwordBearer = new Request("http://localhost/api/admin/review", {
      headers: { authorization: `Bearer ${interactivePassword}` },
    });
    expect(verifyAdminRequest(passwordBearer)).toEqual({ ok: false, reason: "invalid" });

    for (const malformed of [
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      ` ${"a".repeat(64)}`,
      "g".repeat(64),
    ]) {
      process.env = { ...process.env, ADMIN_REVIEW_PASSWORD_HMAC: malformed };
      expect(verifyAdminLoginCredential(interactivePassword)).toEqual({ ok: false, reason: "invalid" });
      expect(verifyAdminLoginCredential(adminReviewToken)).toMatchObject({
        ok: true,
        credential: "review_bearer",
      });
    }

    process.env = {
      ...process.env,
      ADMIN_REVIEW_PASSWORD_HMAC: interactivePasswordHmac(interactivePassword, "superseded-signing-key"),
    };
    expect(verifyAdminLoginCredential(interactivePassword)).toEqual({ ok: false, reason: "invalid" });
  });

  it("invalidates the old password HMAC and signed session after review-token rotation", () => {
    const oldCookie = createAdminSessionCookie();
    process.env = {
      ...process.env,
      ADMIN_REVIEW_TOKEN: "rotated-admin-review-token-123456789",
    };

    expect(verifyAdminLoginCredential(interactivePassword)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAdminSessionCookie(oldCookie)).toEqual({ ok: false, reason: "invalid" });

    process.env = {
      ...process.env,
      ADMIN_REVIEW_PASSWORD_HMAC: interactivePasswordHmac(interactivePassword, "rotated-admin-review-token-123456789"),
    };
    expect(verifyAdminLoginCredential(interactivePassword)).toMatchObject({
      ok: true,
      credential: "interactive_password",
    });
  });

  it("rejects historical shared-password aliases", () => {
    expect(verifyAdminLoginCredential("legacy-alias")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAdminLoginCredential("ops-automation-token-123456789")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAdminLoginCredential("privacy-admin-token-123456789")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("binds the actor and role into the signed cookie instead of re-reading mutable role configuration", () => {
    process.env = { ...process.env, ADMIN_REVIEW_ACTOR: "Read only reviewer", ADMIN_REVIEW_ROLE: "viewer" };
    const cookie = createAdminSessionCookie();
    process.env = { ...process.env, ADMIN_REVIEW_ACTOR: "Different administrator", ADMIN_REVIEW_ROLE: "admin" };

    expect(verifyAdminSessionCookie(cookie)).toMatchObject({
      ok: true,
      actor: "Read only reviewer",
      credential: "review_session",
      principal: "interactive",
      role: "viewer",
    });
    expect(verifyAdminSessionCookie("v1.9999999999999.invalid")).toEqual({ ok: false, reason: "invalid" });
  });

  it("marks session cookies secure only in production", () => {
    const localHeader = adminCookieHeader("cookie-value", Date.now() + 1000);
    expect(localHeader).toContain("Path=/;");
    expect(localHeader).toContain("SameSite=Lax;");
    expect(localHeader).not.toContain(" Secure;");

    process.env = { ...process.env, NODE_ENV: "production" };
    const productionHeader = adminCookieHeader("cookie-value", Date.now() + 1000);
    expect(productionHeader).toContain("Path=/;");
    expect(productionHeader).toContain(" Secure;");
    expect(clearAdminCookieHeader()).toContain("Path=/;");
    expect(clearAdminCookieHeader()).toContain("Max-Age=0");
  });

  it("enforces the central role permission registry", () => {
    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "viewer", ADMIN_REVIEW_ACTOR: "Read only reviewer" };
    const request = new Request("http://localhost/api/admin/review", {
      headers: { authorization: "Bearer admin-review-token-123456789" },
    });

    expect(verifyAdminPermission(request, "dashboard.read")).toMatchObject({
      ok: true,
      actor: "Read only reviewer",
      role: "viewer",
    });
    expect(verifyAdminPermission(request, "leads.update")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(request, "ops.sla_check")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(request, "ops.retention")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(request, "privacy.delete")).toEqual({ ok: false, reason: "forbidden" });

    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "admin" };
    expect(verifyAdminPermission(request, "ops.sla_check")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(request, "ops.retention")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(request, "privacy.delete")).toEqual({ ok: false, reason: "forbidden" });

    const opsRequest = new Request("http://localhost/api/admin/sla-check", {
      headers: { authorization: "Bearer ops-automation-token-123456789" },
      method: "POST",
    });
    expect(verifyAdminPermission(opsRequest, "ops.sla_check")).toMatchObject({
      ok: true,
      credential: "ops_bearer",
      principal: "automation",
    });
    expect(verifyAdminPermission(opsRequest, "leads.update")).toEqual({ ok: false, reason: "forbidden" });
    expect(verifyAdminPermission(opsRequest, "privacy.delete")).toEqual({ ok: false, reason: "forbidden" });

    const privacyRequest = new Request("http://localhost/api/admin/privacy", {
      headers: { authorization: "Bearer privacy-admin-token-123456789" },
      method: "DELETE",
    });
    expect(verifyAdminPermission(privacyRequest, "privacy.delete")).toMatchObject({
      ok: true,
      credential: "privacy_bearer",
      principal: "privacy",
    });
    expect(verifyAdminPermission(privacyRequest, "dashboard.read")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("requires same-origin JSON for cookie-authenticated mutations", () => {
    const cookie = createAdminSessionCookie();
    const headers = {
      cookie: `${adminCookieName}=${cookie}`,
      "content-type": "application/json",
      origin: "http://localhost",
    };

    expect(
      verifyAdminPermission(
        new Request("http://localhost/api/admin/leads/lead-1", { method: "PATCH", headers }),
        "leads.update",
      ),
    ).toMatchObject({ ok: true, credential: "review_session" });
    expect(
      verifyAdminPermission(
        new Request("http://localhost/api/admin/leads/lead-1", {
          method: "PATCH",
          headers: { ...headers, origin: "https://attacker.example" },
        }),
        "leads.update",
      ),
    ).toEqual({ ok: false, reason: "csrf" });
    expect(
      verifyAdminPermission(
        new Request("http://localhost/api/admin/leads/lead-1", {
          method: "PATCH",
          headers: { cookie: `${adminCookieName}=${cookie}`, origin: "http://localhost" },
        }),
        "leads.update",
      ),
    ).toEqual({ ok: false, reason: "csrf" });

    expect(
      verifyAdminPermission(
        new Request("http://app:3000/api/admin/leads/lead-1", {
          method: "PATCH",
          headers: {
            ...headers,
            host: "oriental.mereka.io",
            origin: "https://oriental.mereka.io",
            "x-forwarded-proto": "https",
          },
        }),
        "leads.update",
      ),
    ).toMatchObject({ ok: true, credential: "review_session" });
  });
});
