import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminCookieHeader,
  adminCookieName,
  clearAdminCookieHeader,
  createAdminSessionCookie,
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
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("validates bearer tokens and signed session cookies", () => {
    expect(verifyAdminToken("bad-token")).toMatchObject({ ok: false, reason: "invalid" });
    expect(verifyAdminToken("admin-review-token-123456789")).toMatchObject({ ok: true });

    const cookie = createAdminSessionCookie();
    expect(verifyAdminSessionCookie(cookie)).toMatchObject({ ok: true });

    const request = new Request("http://localhost/api/admin/review", {
      headers: { cookie: `${adminCookieName}=${cookie}` },
    });
    expect(verifyAdminRequest(request)).toMatchObject({ ok: true });
  });

  it("marks session cookies secure only in production", () => {
    const localHeader = adminCookieHeader("cookie-value", Date.now() + 1000);
    expect(localHeader).toContain("Path=/;");
    expect(localHeader).not.toContain(" Secure;");

    process.env = { ...process.env, NODE_ENV: "production" };
    const productionHeader = adminCookieHeader("cookie-value", Date.now() + 1000);
    expect(productionHeader).toContain("Path=/;");
    expect(productionHeader).toContain(" Secure;");
    expect(clearAdminCookieHeader()).toContain("Path=/;");
    expect(clearAdminCookieHeader()).toContain("Max-Age=0");
  });
});
