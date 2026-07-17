import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  create: vi.fn(),
  openAiOptions: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = mocks.query;
    mutation = mocks.mutation;
  },
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mocks.create } };

    constructor(options: unknown) {
      mocks.openAiOptions(options);
    }
  },
}));

import { runAdminVoiceEvals } from "@/lib/server/voice-evals";

const originalEnv = process.env;

describe("admin voice evaluation runner", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      CONVEX_URL: "https://example.convex.cloud",
      CONVEX_INGEST_SECRET: "test-ingest-secret",
      OPENAI_API_KEY: "test-openai-key",
    };
    mocks.query.mockResolvedValue([judgeableSession()]);
    mocks.mutation.mockResolvedValue({ ok: true, updated: 1 });
    mocks.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              routingCorrect: 4,
              captureCompleteness: 5,
              conversationQuality: 4,
              frustration: 0,
              summary: "Clear handoff.",
            }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("uses bounded provider settings and persists only the score payload", async () => {
    const result = await runAdminVoiceEvals({ limit: 1, model: "gpt-4o-mini" });

    expect(result).toMatchObject({ ok: true, judged: 1, persisted: 1, failures: 0 });
    expect(mocks.openAiOptions).toHaveBeenCalledWith({ apiKey: "test-openai-key", maxRetries: 1, timeout: 30_000 });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    const payload = mocks.mutation.mock.calls[0]?.[1] as { evals?: Array<Record<string, unknown>> };
    expect(payload.evals).toHaveLength(1);
    expect(payload.evals?.[0]).toMatchObject({
      reviewId: "review-1",
      model: "gpt-4o-mini",
      routingCorrect: 4,
      summary: "Clear handoff.",
    });
    expect(payload.evals?.[0]).not.toHaveProperty("transcript");
    expect(payload.evals?.[0]).not.toHaveProperty("captured");
  });

  it("skips an untargeted session already scored by the selected model", async () => {
    mocks.query.mockResolvedValue([judgeableSession({ eval: { model: "gpt-4o-mini", evaluatedAt: Date.now() } })]);

    const result = await runAdminVoiceEvals({ limit: 1, model: "gpt-4o-mini" });

    expect(result).toEqual({ ok: false, reason: "no_sessions" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("returns aggregate timeout telemetry without persisting a failed score", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("upstream detail"), { name: "APIConnectionTimeoutError" }));

    const result = await runAdminVoiceEvals({ limit: 1, model: "gpt-4o-mini" });

    expect(result).toMatchObject({
      ok: true,
      judged: 1,
      persisted: 0,
      failures: 1,
      failureCategories: { provider_timeout: 1 },
    });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});

function judgeableSession(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "review-1",
    sessionId: "session-1",
    segment: "education",
    status: "idle",
    connectionStatus: "idle",
    transcript: [{ role: "user", text: "I want to run a workshop." }],
    captured: { name: "", email: "", org: "", phone: "", website: "", message: "" },
    errors: [],
    routeRequested: false,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    ...overrides,
  };
}
