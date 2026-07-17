import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/evals/route";
import { runAdminVoiceEvals } from "@/lib/server/voice-evals";

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
    runMock.mockResolvedValue({
      ok: true,
      model: "gpt-4o-mini",
      fetched: 4,
      conversations: 3,
      judged: 3,
      persisted: 3,
      failures: 0,
    });
  });

  afterEach(() => {
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

  it("rejects malformed judge model ids before spending tokens", async () => {
    const response = await POST(evalsRequest({ model: "not a model!!" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_model" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects oversized batches", async () => {
    const response = await POST(evalsRequest({ limit: 500 }));

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
    runMock.mockResolvedValue({ ok: false, reason: "no_sessions" });

    const response = await POST(evalsRequest({}));

    expect(response.status).toBe(404);
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
