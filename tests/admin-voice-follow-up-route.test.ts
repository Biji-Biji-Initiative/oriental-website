import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/voice-sessions/[reviewId]/route";
import { setAdminVoiceFollowUp } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({
  setAdminVoiceFollowUp: vi.fn(),
}));

const originalEnv = process.env;
const followUpMock = vi.mocked(setAdminVoiceFollowUp);

describe("admin voice follow-up route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
    };
    followUpMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("requires admin auth", async () => {
    const response = await PATCH(followUpRequest({ token: null }), {
      params: Promise.resolve({ reviewId: "review_1" }),
    });

    expect(response.status).toBe(401);
    expect(followUpMock).not.toHaveBeenCalled();
  });

  it("rejects payloads without a boolean followedUp flag", async () => {
    const response = await PATCH(followUpRequest({ body: { followedUp: "yes" } }), {
      params: Promise.resolve({ reviewId: "review_1" }),
    });

    expect(response.status).toBe(400);
    expect(followUpMock).not.toHaveBeenCalled();
  });

  it("marks a session as followed up", async () => {
    const response = await PATCH(followUpRequest({}), { params: Promise.resolve({ reviewId: "review_1" }) });

    expect(response.status).toBe(200);
    expect(followUpMock).toHaveBeenCalledWith("review_1", true);
  });

  it("maps missing sessions to 404", async () => {
    followUpMock.mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await PATCH(followUpRequest({}), { params: Promise.resolve({ reviewId: "missing" }) });

    expect(response.status).toBe(404);
  });
});

function followUpRequest({
  token = "admin-review-token-123456789",
  body = { followedUp: true },
}: {
  token?: string | null;
  body?: Record<string, unknown>;
}) {
  return new Request("http://localhost/api/admin/voice-sessions/review_1", {
    method: "PATCH",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
