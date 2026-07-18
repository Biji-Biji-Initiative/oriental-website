import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/session/route";
import { resetRateLimitBucketsForTest } from "@/lib/server/security";
import { readVoiceReviewCredentialClaims } from "@/lib/server/voice-review-token";
import { createVoiceSmokeProof, VOICE_SMOKE_PROOF_HEADER } from "@/lib/server/voice-smoke-proof";

const originalEnv = process.env;

function request(
  body: unknown,
  ip = "203.0.113.10",
  url = "http://127.0.0.1/api/voice/session",
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
      "user-agent": "Mozilla/5.0",
      ...headers,
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
    email_capture_mode?: string;
    variant?: string | null;
    model?: string;
    model_cell?: string;
    voice?: string;
    speed?: number;
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

  it("mints a signed synthetic review claim only for an authenticated staging smoke", async () => {
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);
    const proof = createVoiceSmokeProof(process.env.IP_HASH_SECRET as string);
    const response = await POST(
      request({ intent: "technology" }, "203.0.113.10", "https://staging.oriental.mereka.io/api/voice/session", {
        [VOICE_SMOKE_PROOF_HEADER]: proof,
      }),
    );
    const body = await json(response);

    expect(body.review?.id).toEqual(expect.any(String));
    expect(body.review?.token).toEqual(expect.any(String));
    expect(readVoiceReviewCredentialClaims(body.review?.id as string, body.review?.token as string)).toEqual({
      synthetic: true,
    });
  });

  it("cannot mark production or an unsigned staging request as synthetic", async () => {
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);
    const proof = createVoiceSmokeProof(process.env.IP_HASH_SECRET as string);
    const [production, staging] = await Promise.all([
      POST(
        request({ intent: "technology" }, "203.0.113.10", "https://oriental.mereka.io/api/voice/session", {
          [VOICE_SMOKE_PROOF_HEADER]: proof,
        }),
      ),
      POST(
        request({ intent: "technology" }, "203.0.113.11", "https://staging.oriental.mereka.io/api/voice/session", {
          [VOICE_SMOKE_PROOF_HEADER]: `${proof}tampered`,
        }),
      ),
    ]);

    for (const response of [production, staging]) {
      const body = await json(response);
      expect(readVoiceReviewCredentialClaims(body.review?.id as string, body.review?.token as string)).toEqual({
        synthetic: false,
      });
    }
  });

  it("returns the server-governed adaptive email mode to the browser", async () => {
    process.env.VOICE_EMAIL_CAPTURE_MODE = "adaptive";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology" }));

    expect(await json(response)).toMatchObject({ ok: true, email_capture_mode: "adaptive" });
  });

  it("uses the managed environment behind an internal reverse-proxy URL", async () => {
    process.env.APP_ENV = "staging";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology" }));

    expect(await json(response)).toMatchObject({ deployment_environment: "staging" });
  });

  it("ignores browser voice variants when the runtime picker is disabled", async () => {
    process.env.VOICE_VARIANT_PICKER = "false";
    process.env.OPENAI_REALTIME_VOICE = "coral";
    process.env.OPENAI_REALTIME_SPEED = "1.28";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ intent: "technology", variant: "gen-z-kl" }));

    expect(await json(response)).toMatchObject({ ok: true, variant: null, voice: "coral", speed: 1.28 });
  });

  it("accepts a catalogued voice variant only when staging enables the picker", async () => {
    process.env.VOICE_VARIANT_PICKER = "true";
    process.env.OPENAI_REALTIME_VOICE = "coral";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(
        { intent: "technology", variant: "gen-z-kl" },
        "203.0.113.10",
        "https://staging.oriental.mereka.io/api/voice/session",
      ),
    );

    expect(await json(response)).toMatchObject({ ok: true, variant: "gen-z-kl", voice: "alloy", speed: 1.3 });
  });

  it("ignores a picker flag accidentally enabled on production", async () => {
    process.env.VOICE_VARIANT_PICKER = "true";
    process.env.APP_ENV = "staging";
    process.env.OPENAI_REALTIME_VOICE = "coral";
    process.env.OPENAI_REALTIME_SPEED = "1.28";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(
        { intent: "technology", variant: "gen-z-kl" },
        "203.0.113.10",
        "https://oriental.mereka.io/api/voice/session",
      ),
    );

    expect(await json(response)).toMatchObject({ ok: true, variant: null, voice: "coral", speed: 1.28 });
  });

  it("forces the control model cell on the production hostname", async () => {
    process.env.APP_ENV = "staging";
    process.env.VOICE_MODEL_CELL = "candidate";
    process.env.OPENAI_REALTIME_MODEL = "gpt-realtime-2";
    process.env.OPENAI_REALTIME_MODEL_CANDIDATE = "gpt-realtime-2.1";
    const fetchMock = mockOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ intent: "technology" }, "203.0.113.10", "https://oriental.mereka.io/api/voice/session"),
    );

    expect(await json(response)).toMatchObject({
      ok: true,
      deployment_environment: "production",
      model: "gpt-realtime-2",
      model_cell: "control",
    });
  });
});
