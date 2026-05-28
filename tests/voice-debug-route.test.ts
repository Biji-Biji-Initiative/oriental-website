import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/debug/route";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";

const mocks = vi.hoisted(() => ({
  persistVoiceReviewSnapshot: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistVoiceReviewSnapshot: mocks.persistVoiceReviewSnapshot,
}));

const originalEnv = process.env;

function snapshotRequest(review: { id: string; token: string } = createVoiceReviewCredentials()) {
  return new Request("http://127.0.0.1/api/voice/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      review: { id: review.id, token: review.token },
      snapshot: {
        sessionId: "sess_123",
        leadId: null,
        segment: "technology",
        status: "idle",
        connectionStatus: "listening",
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          message: "AI literacy demos.",
        },
        transcript: [{ role: "user", text: "I can run demos." }],
        errors: [],
        rateLimits: [],
        routeRequested: false,
      },
    }),
  });
}

describe("POST /api/voice/debug", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      IP_HASH_SECRET: "voice-review-secret",
    };
    mocks.persistVoiceReviewSnapshot.mockResolvedValue({ ok: true, id: "review_123" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("persists verified production snapshots", async () => {
    const response = await POST(snapshotRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, persisted: true });
    expect(mocks.persistVoiceReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: expect.any(String) }),
    );
  });

  it("rejects unverified production snapshots", async () => {
    const response = await POST(snapshotRequest({ id: crypto.randomUUID(), token: "bad-token-with-enough-length" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ ok: false, error: "unauthorized" });
    expect(mocks.persistVoiceReviewSnapshot).not.toHaveBeenCalled();
  });
});
