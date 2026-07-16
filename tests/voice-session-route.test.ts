import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/session/route";
import { resetRateLimitBucketsForTest } from "@/lib/server/security";

const originalEnv = process.env;

function request(body: unknown, ip = "203.0.113.10", url = "http://127.0.0.1/api/voice/session") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      "user-agent": "Mozilla/5.0",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

async function json(response: Response) {
  return (await response.json()) as {
    ok?: boolean;
    error?: string;
    review?: { id?: string; token?: string };
    device_profile?: string;
    deployment_environment?: string;
  };
}

function mockOpenAiFetch() {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      client_secret: { value: "client-secret", expires_at: 123 },
      session: { id: "sess_123" },
    }),
  );
}

describe("POST /api/voice/session", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-test",
      IP_HASH_SECRET: "voice-route-test",
    };
    resetRateLimitBucketsForTest();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    resetRateLimitBucketsForTest();
  });

  it("does not spend daily voice quota on invalid payloads", async () => {
    process.env.VOICE_SESSION_DAILY_LIMIT = "3";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await POST(request("not-json"));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("server-timing")).toMatch(/parse;dur=.+total;dur=/);
    expect(await json(invalid)).toMatchObject({ ok: false, error: "invalid_payload" });

    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request({ intent: "technology" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("server-timing")).toMatch(
        /parse;dur=.+rate_limit;dur=.+openai_mint;dur=.+total;dur=/,
      );
      expect(await json(response)).toMatchObject({
        ok: true,
        review: { id: expect.any(String), token: expect.any(String) },
      });
    }

    const limited = await POST(request({ intent: "technology" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
    expect(limited.headers.get("server-timing")).toMatch(/parse;dur=.+rate_limit;dur=.+total;dur=/);
    expect(await json(limited)).toMatchObject({ ok: false, error: "voice_limit_reached" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours VOICE_SESSION_DAILY_LIMIT overrides", async () => {
    process.env.VOICE_SESSION_DAILY_LIMIT = "1";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(request({ intent: "technology" }));
    expect(first.status).toBe(200);

    const limited = await POST(request({ intent: "technology" }));
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: "voice_limit_reached" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores configured Turnstile secrets unless enforcement is explicitly required", async () => {
    process.env.VOICE_SESSION_DAILY_LIMIT = "3";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology" }));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ok: true,
      review: { id: expect.any(String), token: expect.any(String) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.openai.com");
  });

  it("accepts localhost session mints without a verification token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology" }, "127.0.0.1"));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ok: true,
      review: { id: expect.any(String), token: expect.any(String) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.openai.com");
  });

  it("labels staging evidence independently from production", async () => {
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ intent: "technology" }, "203.0.113.10", "https://staging.oriental.mereka.io/api/voice/session"),
    );

    expect(await json(response)).toMatchObject({
      ok: true,
      device_profile: "desktop",
      deployment_environment: "staging",
    });
  });

  it("uses the managed environment behind an internal reverse-proxy URL", async () => {
    process.env.APP_ENV = "staging";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology" }));

    expect(await json(response)).toMatchObject({ deployment_environment: "staging" });
  });
});
