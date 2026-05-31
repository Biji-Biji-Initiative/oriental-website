import { describe, expect, it, vi } from "vitest";
import { emptyCapturedLead, type VoiceRuntimeState } from "@/lib/voice/realtime-events";
import { buildVoiceReviewSnapshot, postVoiceReviewSnapshot } from "@/lib/voice/review-snapshot";

const review = {
  id: "5a8c25b1-cd50-4e47-89bf-84947c805add",
  token: "review-token-that-is-long-enough",
  sessionId: "sess_123",
  model: "gpt-realtime-2",
  voice: "marin",
  speed: 1.18,
};

function state(overrides: Partial<VoiceRuntimeState> = {}): VoiceRuntimeState {
  return {
    segment: "ai",
    captured: { ...emptyCapturedLead, name: "Asha" },
    transcript: [{ role: "user", text: "I want to run an AI literacy demo." }],
    ...overrides,
  };
}

describe("voice review snapshots", () => {
  it("builds a persisted review snapshot from runtime state", () => {
    expect(
      buildVoiceReviewSnapshot(review, state({ routeRequested: true }), "listening", {
        leadId: "lead_123",
        submittedAt: 1234,
      }),
    ).toMatchObject({
      sessionId: "sess_123",
      leadId: "lead_123",
      segment: "ai",
      status: "submitted",
      connectionStatus: "listening",
      model: "gpt-realtime-2",
      voice: "marin",
      speed: 1.18,
      captured: { name: "Asha" },
      transcript: [{ role: "user", text: "I want to run an AI literacy demo." }],
      routeRequested: true,
      submittedAt: 1234,
    });
  });

  it("posts only the signed review credentials with the snapshot", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = buildVoiceReviewSnapshot(review, state(), "idle");
    await postVoiceReviewSnapshot(review, snapshot);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/debug",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      review: { id: review.id, token: review.token },
      snapshot,
    });
  });
});
