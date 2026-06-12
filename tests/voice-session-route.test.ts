import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/session/route";
import { resetRateLimitBucketsForTest } from "@/lib/server/security";

const originalEnv = process.env;

function request(body: unknown, ip = "203.0.113.10") {
  return new Request("http://127.0.0.1/api/voice/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

async function json(response: Response) {
  return (await response.json()) as { ok?: boolean; error?: string; review?: { id?: string; token?: string } };
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
    expect(await json(invalid)).toMatchObject({ ok: false, error: "invalid_payload" });

    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request({ intent: "technology", turnstileToken: "local-dev" }));
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        ok: true,
        review: { id: expect.any(String), token: expect.any(String) },
      });
    }

    const limited = await POST(request({ intent: "technology", turnstileToken: "local-dev" }));
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: "voice_limit_reached" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours VOICE_SESSION_DAILY_LIMIT overrides", async () => {
    process.env.VOICE_SESSION_DAILY_LIMIT = "1";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(request({ intent: "technology", turnstileToken: "local-dev" }));
    expect(first.status).toBe(200);

    const limited = await POST(request({ intent: "technology", turnstileToken: "local-dev" }));
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: "voice_limit_reached" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not spend daily voice quota on failed Turnstile checks", async () => {
    process.env.VOICE_SESSION_DAILY_LIMIT = "3";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    let turnstileOk = false;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.includes("challenges.cloudflare.com")) {
        return Response.json({ success: turnstileOk });
      }
      return Response.json({
        client_secret: { value: "client-secret", expires_at: 123 },
        session: { id: "sess_123" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const failedTurnstile = await POST(request({ intent: "technology", turnstileToken: "bad-token" }));
    expect(failedTurnstile.status).toBe(403);
    expect(await json(failedTurnstile)).toMatchObject({ ok: false, error: "turnstile_failed" });

    turnstileOk = true;
    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request({ intent: "technology", turnstileToken: "good-token" }));
      expect(response.status).toBe(200);
      expect(await json(response)).toMatchObject({
        ok: true,
        review: { id: expect.any(String), token: expect.any(String) },
      });
    }

    const limited = await POST(request({ intent: "technology", turnstileToken: "good-token" }));
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: "voice_limit_reached" });
  });

  it("accepts the local development Turnstile token from localhost with a configured secret", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology", turnstileToken: "local-dev" }, "127.0.0.1"));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      ok: true,
      review: { id: expect.any(String), token: expect.any(String) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.openai.com");
  });
});
