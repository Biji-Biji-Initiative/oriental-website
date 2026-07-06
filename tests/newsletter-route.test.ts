import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/newsletter/route";

const mocks = vi.hoisted(() => ({
  persistLead: vi.fn(),
  recordLeadNotificationStatus: vi.fn(),
  notifyNewsletterSubscriber: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistLead: mocks.persistLead,
  recordLeadNotificationStatus: mocks.recordLeadNotificationStatus,
}));

vi.mock("@/lib/server/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/notifications")>();
  return {
    ...actual,
    notifyNewsletterSubscriber: mocks.notifyNewsletterSubscriber,
  };
});

const originalEnv = process.env;

function request() {
  return new Request("http://127.0.0.1/api/newsletter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ email: "asha@example.com", turnstileToken: "local-dev", utm: {} }),
  }) as never;
}

describe("POST /api/newsletter", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      IP_HASH_SECRET: "newsletter-route-test",
    };
    mocks.persistLead.mockResolvedValue({ id: "lead_news", persisted: true });
    mocks.recordLeadNotificationStatus.mockResolvedValue({ ok: true });
    mocks.notifyNewsletterSubscriber.mockResolvedValue({ ok: true, transport: "smtp" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts a hero email signup", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      persisted: true,
      notifications: {
        confirmation: { ok: true, transport: "smtp" },
      },
    });
    expect(mocks.notifyNewsletterSubscriber).toHaveBeenCalledWith("asha@example.com");
    expect(mocks.recordLeadNotificationStatus).toHaveBeenCalledWith(
      "lead_news",
      { confirmation: body.notifications.confirmation },
      true,
    );
  });

  it("degrades gracefully instead of crashing when persistence throws outside production", async () => {
    mocks.persistLead.mockRejectedValue(new Error("convex_down"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, persisted: false });
  });

  it("returns 502 and pages ops when production persistence fails", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, ok: true })),
    );
    mocks.persistLead.mockRejectedValue(new Error("convex_down"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ ok: false, error: "persistence_failed" });
  });
});
