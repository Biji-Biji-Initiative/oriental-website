import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/login/route";
import { adminCookieName } from "@/lib/server/admin-auth";
import { resetRateLimitBucketsForTest } from "@/lib/server/security";

const originalEnv = process.env;

describe("admin login route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      IP_HASH_SECRET: "admin-login-test-hash-secret",
      REDIS_URL: undefined,
      UPSTASH_REDIS_URL: undefined,
      VALKEY_URL: undefined,
    };
    resetRateLimitBucketsForTest();
  });

  afterEach(() => {
    resetRateLimitBucketsForTest();
    process.env = originalEnv;
  });

  it("sets a root-scoped session only for the governed token", async () => {
    const rejected = await POST(loginRequest("legacy-alias", "203.0.113.7"));
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("set-cookie")).toBeNull();

    const accepted = await POST(loginRequest("admin-review-token-123456789", "203.0.113.7"));
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("set-cookie")).toContain(`${adminCookieName}=`);
    expect(accepted.headers.get("set-cookie")).toContain("Path=/;");
  });

  it("rate-limits repeated attempts by trusted-proxy identity", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(loginRequest("wrong-token", "198.51.100.23"));
      expect(response.status).toBe(401);
    }

    const blocked = await POST(loginRequest("admin-review-token-123456789", "198.51.100.23"));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    const otherIp = await POST(loginRequest("admin-review-token-123456789", "198.51.100.24"));
    expect(otherIp.status).toBe(200);
  });
});

function loginRequest(token: string, ip: string) {
  return new NextRequest("http://localhost/api/admin/login", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    method: "POST",
  });
}
