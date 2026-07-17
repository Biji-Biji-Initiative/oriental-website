import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminCookieHeader,
  adminCookieName,
  clearAdminCookieHeader,
  createAdminSessionCookie,
  verifyAdminPermission,
  verifyAdminRequest,
  verifyAdminSessionCookie,
  verifyAdminToken,
} from "@/lib/server/admin-auth";

const originalEnv = process.env;

describe("admin auth helpers", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_ACTOR: "Interactive operator",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789",
      PRIVACY_ADMIN_TOKEN: "privacy-admin-token-123456789",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("validates bearer tokens and signed session cookies", () => {
    expect(verifyAdminToken("bad-token")).toMatchObject({ ok: false, reason: "invalid" });
    expect(verifyAdminToken("admin-review-token-123456789")).toMatchObject({
      ok: true,
      actor: "Interactive operator",
      credential: "review_bearer",
      principal: "interactive",
      role: "operator",
    });

    const cookie = createAdminSessionCookie();
    expect(verifyAdminSessionCookie(cookie)).toMatchObject({ ok: true });

    const request = new Request("http://localhost/api/admin/review", {
      headers: { cookie: `${adminCookieName}=${cookie}` },
    });
    expect(verifyAdminRequest(request)).toMatchObject({ ok: true });
  });

  it("rejects historical shared-password aliases", () => {
    expect(verifyAdminToken("legacy-alias")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAdminToken("ops-automation-token-123456789")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyAdminToken("privacy-admin-token-123456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("binds the actor and role into the signed cookie instead of re-reading mutable role configuration", () => {
    process.env = { ...process.env, ADMIN_REVIEW_ACTOR: "Read only reviewer", ADMIN_REVIEW_ROLE: "viewer" };
    const cookie = createAdminSessionCookie();
    process.env = { ...process.env, ADMIN_REVIEW_ACTOR: "Different administrator", ADMIN_REVIEW_ROLE: "admin" };

    expect(verifyAdminSessionCookie(cookie)).toMatchObject({
      ok: true,
      actor: "Read only reviewer",
      credential: "session",
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
    ).toMatchObject({ ok: true, credential: "session" });
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
    ).toMatchObject({ ok: true, credential: "session" });
  });
});
