import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/logout/route";
import { adminCookieName, createAdminSessionCookie } from "@/lib/server/admin-auth";

const originalEnv = process.env;

describe("admin logout route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("clears a cookie only through the same-origin JSON boundary", async () => {
    const cookie = createAdminSessionCookie();
    const accepted = await POST(
      new Request("http://localhost/api/admin/logout", {
        method: "POST",
        headers: {
          cookie: `${adminCookieName}=${cookie}`,
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: "{}",
      }),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).toContain("Max-Age=0");

    const rejected = await POST(
      new Request("http://localhost/api/admin/logout", {
        method: "POST",
        headers: {
          cookie: `${adminCookieName}=${cookie}`,
          "content-type": "application/json",
          origin: "https://attacker.test",
        },
        body: "{}",
      }),
    );
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toEqual({ ok: false, error: "csrf" });
  });
});
