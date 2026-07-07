import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/route";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";

const mocks = vi.hoisted(() => ({
  persistLead: vi.fn(),
  recordLeadNotificationStatus: vi.fn(),
  notifyOwner: vi.fn(),
  notifySlack: vi.fn(),
  notifyClickUp: vi.fn(),
  notifySubmitter: vi.fn(),
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
    notifyClickUp: mocks.notifyClickUp,
    notifySubmitter: mocks.notifySubmitter,
  };
});

const originalEnv = process.env;

function leadBody(overrides: Record<string, unknown> = {}) {
  return {
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
    voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
    voiceSessionId: "sess_123",
    voiceVariant: "kl-polished",
    voiceModel: "gpt-realtime-2",
    voiceName: "marin",
    voiceSpeed: 1.22,
    turnstileToken: "local-dev",
    utm: {},
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}, ip = "127.0.0.1") {
  return new Request("http://127.0.0.1/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(leadBody(overrides)),
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
    mocks.notifyClickUp.mockResolvedValue({ ok: false, skipped: true, reason: "clickup_unconfigured" });
    mocks.notifySubmitter.mockResolvedValue({ ok: true, transport: "smtp" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
        clickup: { ok: false, skipped: true, reason: "clickup_unconfigured" },
        confirmation: { ok: true, transport: "smtp" },
      },
    });
    expect(mocks.recordLeadNotificationStatus).toHaveBeenCalledWith(
      "lead_123",
      {
        email: body.notifications.email,
        slack: body.notifications.slack,
        clickup: body.notifications.clickup,
        confirmation: body.notifications.confirmation,
      },
      true,
    );
    expect(mocks.persistLead).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
        voiceSessionId: "sess_123",
        voiceVariant: "kl-polished",
        voiceModel: "gpt-realtime-2",
        voiceName: "marin",
        voiceSpeed: 1.22,
      }),
    );
    expect(mocks.persistLead.mock.calls[0]?.[0]).not.toHaveProperty("voiceReviewToken");
  });

  it("accepts signed voice leads without a Cloudflare token when Turnstile enforcement is required", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const review = createVoiceReviewCredentials();
    const fetchMock = vi.fn(async () => Response.json({ success: false }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(
        {
          turnstileToken: undefined,
          voiceReviewId: review.id,
          voiceReviewToken: review.token,
        },
        "203.0.113.10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.persistLead.mock.calls[0]?.[0]).not.toHaveProperty("voiceReviewToken");
  });

  it("rejects unsigned voice leads when Turnstile enforcement is required and no token is present", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

    const response = await POST(request({ turnstileToken: undefined }, "203.0.113.10"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "turnstile_failed" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
  });

  it("still requires Turnstile for form leads when enforcement is required", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

    const response = await POST(
      request(
        {
          source: "form",
          turnstileToken: undefined,
          voiceReviewId: undefined,
          voiceSessionId: undefined,
          voiceVariant: undefined,
          voiceModel: undefined,
          voiceName: undefined,
          voiceSpeed: undefined,
        },
        "203.0.113.10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "turnstile_failed" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
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
      expect(mocks.notifyClickUp).toHaveBeenCalledTimes(1);
      expect(mocks.recordLeadNotificationStatus).not.toHaveBeenCalled();
    });

    it("returns 502 only when persistence and every notification channel fail", async () => {
      mocks.notifyOwner.mockResolvedValue({ ok: false, error: "smtp_down" });
      mocks.notifySlack.mockResolvedValue({ ok: false, error: "slack_http_error", status: 500 });
      mocks.notifyClickUp.mockResolvedValue({ ok: false, error: "clickup_api_error", status: 500 });

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toMatchObject({ ok: false, error: "persistence_failed", reason: "convex_down" });
    });
  });
});
