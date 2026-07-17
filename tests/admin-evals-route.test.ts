import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/evals/route";
import { resetRateLimitBucketsForTest } from "@/lib/server/rate-limit";
import { classifyJudgeError, needsAdminEvaluation, runAdminVoiceEvals } from "@/lib/server/voice-evals";

vi.mock("@/lib/server/voice-evals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/voice-evals")>();
  return {
    ...actual,
    runAdminVoiceEvals: vi.fn(),
  };
});

const originalEnv = process.env;
const runMock = vi.mocked(runAdminVoiceEvals);

describe("admin evals route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_ACTOR: "Gurpreet",
    };
    resetRateLimitBucketsForTest();
    runMock.mockResolvedValue({
      ok: true,
      model: "gpt-4o-mini",
      fetched: 4,
      conversations: 3,
      judged: 3,
      persisted: 3,
      failures: 0,
      alreadyEvaluated: 0,
      failureCategories: {
        run_deadline: 0,
        provider_timeout: 0,
        provider_rate_limited: 0,
        provider_auth: 0,
        provider_error: 0,
        empty_response: 0,
        invalid_response: 0,
      },
      failureSamples: [],
    });
  });

  afterEach(() => {
    resetRateLimitBucketsForTest();
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("requires the evals.run permission", async () => {
    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "viewer" };

    const response = await POST(evalsRequest({}));

    expect(response.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("runs a bounded evaluation batch and reports the outcome", async () => {
    const response = await POST(evalsRequest({ limit: 10 }));

    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith({ limit: 10 });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      model: "gpt-4o-mini",
      judged: 3,
      persisted: 3,
      failures: 0,
    });
  });

  it("passes a targeted review id and an explicit judge model through", async () => {
    const response = await POST(evalsRequest({ model: "gpt-5.6-luna", reviewIds: ["voice-critical-1"] }));

    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith({ model: "gpt-5.6-luna", reviewIds: ["voice-critical-1"] });
  });

  it("passes an explicit force rescore through", async () => {
    const response = await POST(evalsRequest({ force: true, limit: 4 }));

    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith({ force: true, limit: 4 });
  });

  it("rejects every model outside the curated allowlist before spending tokens", async () => {
    const response = await POST(evalsRequest({ model: "gpt-4.1-mini" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_model" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("allows only one evaluation run in each five-minute cost-control window", async () => {
    const first = await POST(evalsRequest({ limit: 5 }));
    const second = await POST(evalsRequest({ limit: 5 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    await expect(second.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized batches", async () => {
    const response = await POST(evalsRequest({ limit: 13 }));

    expect(response.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("maps unconfigured environments to 503 without leaking details", async () => {
    runMock.mockResolvedValue({ ok: false, reason: "unconfigured" });

    const response = await POST(evalsRequest({}));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "unconfigured" });
  });

  it("maps an empty judgeable window to 404", async () => {
    runMock.mockResolvedValue({
      ok: false,
      reason: "no_sessions",
      window: { fetched: 100, conversations: 92, alreadyEvaluated: 92 },
    });

    const response = await POST(evalsRequest({}));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "no_sessions",
      window: { fetched: 100, conversations: 92, alreadyEvaluated: 92 },
    });
  });

  it("maps a whole-run deadline to 504 without leaking internals", async () => {
    runMock.mockResolvedValue({ ok: false, reason: "deadline_exceeded" });

    const response = await POST(evalsRequest({}));

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "deadline_exceeded" });
  });

  it("does not spend tokens rescoring the same model unless a session is explicitly targeted", () => {
    const evaluated = { reviewId: "review-1", eval: { model: "gpt-4o-mini", evaluatedAt: Date.now() } };

    expect(needsAdminEvaluation(evaluated as never, "gpt-4o-mini", false)).toBe(false);
    expect(needsAdminEvaluation(evaluated as never, "gpt-5.6-luna", false)).toBe(true);
    expect(needsAdminEvaluation(evaluated as never, "gpt-4o-mini", true)).toBe(true);
    expect(needsAdminEvaluation({ reviewId: "legacy", evaluatedAt: Date.now() } as never, "gpt-4o-mini", false)).toBe(
      false,
    );
  });

  it("classifies provider failures without exposing provider messages", () => {
    expect(classifyJudgeError({ name: "APIConnectionTimeoutError" })).toBe("provider_timeout");
    expect(classifyJudgeError({ status: 429 })).toBe("provider_rate_limited");
    expect(classifyJudgeError({ status: 401 })).toBe("provider_auth");
    expect(classifyJudgeError(new Error("private upstream detail"))).toBe("provider_error");
  });
});

function evalsRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/evals", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-review-token-123456789",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
