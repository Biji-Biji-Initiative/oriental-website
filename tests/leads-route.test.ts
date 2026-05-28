import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/route";

const mocks = vi.hoisted(() => ({
  persistLead: vi.fn(),
  notifyOwner: vi.fn(),
  notifySlack: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistLead: mocks.persistLead,
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
  });
});
