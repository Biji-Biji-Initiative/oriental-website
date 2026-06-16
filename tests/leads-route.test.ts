import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/route";

const mocks = vi.hoisted(() => ({
  persistLead: vi.fn(),
  recordLeadNotificationStatus: vi.fn(),
  notifyOwner: vi.fn(),
  notifySlack: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistLead: mocks.persistLead,
  recordLeadNotificationStatus: mocks.recordLeadNotificationStatus,
}));

vi.mock("@/lib/server/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/notifications")>();
  return {
    ...actual,
    notifyOwner: mocks.notifyOwner,
    notifySlack: mocks.notifySlack,
  };
});

const originalEnv = process.env;

function request() {
  return new Request("http://127.0.0.1/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({
      source: "voice",
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "We want to run public AI literacy demos.",
      },
      transcript: [{ role: "user", text: "We want to run public AI literacy demos." }],
      turnstileToken: "local-dev",
      utm: {},
    }),
  }) as never;
}

describe("POST /api/leads", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      IP_HASH_SECRET: "lead-route-test",
    };
    mocks.persistLead.mockResolvedValue({ id: "lead_123", persisted: true });
    mocks.recordLeadNotificationStatus.mockResolvedValue({ ok: true });
    mocks.notifyOwner.mockResolvedValue({ ok: false, skipped: true, reason: "email_unconfigured" });
    mocks.notifySlack.mockResolvedValue({ ok: true, transport: "slack" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("returns a successful local response instead of crashing when persistence fails outside production", async () => {
    mocks.persistLead.mockRejectedValue(new Error("convex_failed"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, persisted: false });
    expect(mocks.persistLead).toHaveBeenCalledTimes(1);
    expect(mocks.recordLeadNotificationStatus).not.toHaveBeenCalled();
  });

  it("returns notification delivery details with a successful response", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      persisted: true,
      notifications: {
        email: { ok: false, skipped: true, reason: "email_unconfigured" },
        slack: { ok: true, transport: "slack" },
      },
    });
    expect(mocks.recordLeadNotificationStatus).toHaveBeenCalledWith("lead_123", body.notifications);
  });

  describe("production persistence failure", () => {
    beforeEach(() => {
      process.env = {
        ...process.env,
        NODE_ENV: "production",
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        OWNER_TECHNOLOGY: "gurpreet@example.com",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: true, ok: true })),
      );
      mocks.persistLead.mockRejectedValue(new Error("convex_down"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("degrades to notification-only delivery instead of dropping the lead", async () => {
      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        persisted: false,
        notifications: { slack: { ok: true, transport: "slack" } },
      });
      expect(mocks.notifySlack).toHaveBeenCalledTimes(1);
      expect(mocks.recordLeadNotificationStatus).not.toHaveBeenCalled();
    });

    it("returns 502 only when persistence and every notification channel fail", async () => {
      mocks.notifyOwner.mockResolvedValue({ ok: false, error: "smtp_down" });
      mocks.notifySlack.mockResolvedValue({ ok: false, error: "slack_http_error", status: 500 });

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toMatchObject({ ok: false, error: "persistence_failed", reason: "convex_down" });
    });
  });
});
