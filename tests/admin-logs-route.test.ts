import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ getAdminApplicationLogs: vi.fn(), persistApplicationLog: vi.fn() }));

vi.mock("@/lib/server/convex", () => logs);

import { GET } from "@/app/api/admin/logs/route";
import {
  adminCookieName,
  createAdminLoginSession,
  verifyAdminLoginCredential,
  verifyAdminSessionCookie,
} from "@/lib/server/admin-auth";

const originalEnv = process.env;
const adminToken = "admin-review-token-123456789";
const password = "shared-test-password-123";

function passwordHmac(value: string) {
  return createHmac("sha256", adminToken).update("oriental-admin-password:v1\0").update(value).digest("hex");
}

function passwordCookie() {
  const login = verifyAdminLoginCredential(password);
  if (!login.ok) throw new Error("Expected password login to succeed");
  const cookie = createAdminLoginSession(login, Date.now()).cookie;
  const verified = verifyAdminSessionCookie(cookie);
  if (!verified.ok) throw new Error(`Expected password session to verify: ${verified.reason}`);
  return cookie;
}

describe("admin retained-logs route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_ACTOR: "Interactive operator",
      ADMIN_REVIEW_ROLE: "admin",
      ADMIN_REVIEW_TOKEN: adminToken,
      ADMIN_REVIEW_PASSWORD_HMAC: passwordHmac(password),
      OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789",
      PRIVACY_ADMIN_TOKEN: "privacy-admin-token-123456789",
    };
    logs.getAdminApplicationLogs.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("returns the bounded durable log history only to the full password session", async () => {
    logs.getAdminApplicationLogs.mockResolvedValue({
      ok: true,
      logs: [
        {
          logId: "log-1",
          occurredAt: 1_785_801_600_000,
          level: "warn",
          service: "oriental-website",
          version: "release-sha",
          event: "voice_review.transport_degraded",
          payload: '{"schema":"oriental.application_log.v1"}',
          retentionExpiresAt: 1_788_393_600_000,
        },
      ],
    });

    const response = await GET(
      new Request("http://localhost/api/admin/logs?limit=999", {
        headers: { cookie: `${adminCookieName}=${passwordCookie()}` },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, logs: [{ logId: "log-1" }] });
    expect(logs.getAdminApplicationLogs).toHaveBeenCalledWith(200);
  });

  it("does not expose retained logs to the automation bearer", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/logs", {
        headers: { authorization: "Bearer ops-automation-token-123456789" },
      }),
    );

    expect(response.status).toBe(403);
    expect(logs.getAdminApplicationLogs).not.toHaveBeenCalled();
  });
});
