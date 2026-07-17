import { describe, expect, it, vi } from "vitest";
import { emptyCapturedLead, type VoiceRuntimeState } from "@/lib/voice/realtime-events";
import {
  buildVoiceReviewSnapshot,
  postVoiceReviewSnapshot,
  resolveVoiceReviewPageLifecycleAction,
} from "@/lib/voice/review-snapshot";

const review = {
  id: "5a8c25b1-cd50-4e47-89bf-84947c805add",
  token: "review-token-that-is-long-enough",
  sessionId: "sess_123",
  model: "gpt-realtime-2",
  modelCell: "candidate" as const,
  reasoningCell: "minimal" as const,
  voice: "marin",
  speed: 1.18,
  deviceProfile: "desktop" as const,
  deploymentEnvironment: "staging" as const,
  activationAttempted: true,
  variant: "kl-polished",
  runtimeProfile: "instant-v1" as const,
  inputPolicy: "fast" as const,
  prewarmedAt: 1000,
  connectStartedAt: 2000,
  connectedAt: 2400,
  firstEventAt: 3100,
  latency: {
    version: 1 as const,
    activation: { tapToArmCueScheduledMs: 4, tapToLiveMs: 480 },
    turns: [
      {
        sequence: 1,
        inputPolicy: "baseline" as const,
        speechDurationMs: 900,
        stopToResponseCreatedMs: 180,
        stopToFirstOutputEventMs: 420,
        responseDurationMs: 1700,
        interrupted: false,
        rapidResume: false,
      },
    ],
  },
};

function state(overrides: Partial<VoiceRuntimeState> = {}): VoiceRuntimeState {
  return {
    segment: "technology",
    captured: { ...emptyCapturedLead, name: "Asha" },
    transcript: [{ role: "user", text: "I want to run an AI literacy demo." }],
    ...overrides,
  };
}

describe("voice review snapshots", () => {
  it("keeps tab hiding non-terminal and makes a real page exit one-shot", () => {
    expect(
      resolveVoiceReviewPageLifecycleAction({
        event: "visibilitychange",
        connectionStatus: "listening",
        visibilityState: "hidden",
        terminalSnapshotSent: false,
      }),
    ).toBe("heartbeat");
    expect(
      resolveVoiceReviewPageLifecycleAction({
        event: "pagehide",
        connectionStatus: "listening",
        pagePersisted: true,
        terminalSnapshotSent: false,
      }),
    ).toBe("heartbeat");
    expect(
      resolveVoiceReviewPageLifecycleAction({
        event: "pagehide",
        connectionStatus: "listening",
        pagePersisted: false,
        terminalSnapshotSent: false,
      }),
    ).toBe("terminal");
    expect(
      resolveVoiceReviewPageLifecycleAction({
        event: "pagehide",
        connectionStatus: "listening",
        pagePersisted: false,
        terminalSnapshotSent: true,
      }),
    ).toBe("none");
    expect(
      resolveVoiceReviewPageLifecycleAction({
        event: "visibilitychange",
        connectionStatus: "idle",
        visibilityState: "hidden",
        terminalSnapshotSent: false,
      }),
    ).toBe("none");
  });

  it("builds a persisted review snapshot from runtime state", () => {
    expect(
      buildVoiceReviewSnapshot(review, state({ routeRequested: true }), "listening", {
        leadId: "lead_123",
        submittedAt: 1234,
        closeReason: "manual",
        closedAt: 4500,
      }),
    ).toMatchObject({
      sessionId: "sess_123",
      leadId: "lead_123",
      segment: "technology",
      status: "submitted",
      connectionStatus: "listening",
      closeReason: "manual",
      prewarmedAt: 1000,
      connectStartedAt: 2000,
      connectedAt: 2400,
      firstEventAt: 3100,
      closedAt: 4500,
      model: "gpt-realtime-2",
      modelCell: "candidate",
      reasoningCell: "minimal",
      voice: "marin",
      speed: 1.18,
      deviceProfile: "desktop",
      deploymentEnvironment: "staging",
      activationAttempted: true,
      variant: "kl-polished",
      runtimeProfile: "instant-v1",
      inputPolicy: "fast",
      latency: review.latency,
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

  it("omits an unassigned conversation id from prewarm snapshots", () => {
    const snapshot = buildVoiceReviewSnapshot({ ...review, conversationId: "" }, state(), "idle");
    expect(snapshot).not.toHaveProperty("conversationId");
  });

  it("records PII-free pending speech verification provenance", () => {
    const snapshot = buildVoiceReviewSnapshot(
      review,
      state({
        captured: { ...emptyCapturedLead, email: "asha@example.com" },
        emailVerification: {
          value: "asha@example.com",
          source: "speech",
          status: "pending",
        },
      }),
      "listening",
    );

    expect(snapshot.emailVerification).toEqual({
      source: "speech",
      status: "pending",
      matchesCaptured: true,
    });
  });

  it("records adaptive confidence without persisting the address in provenance", () => {
    const snapshot = buildVoiceReviewSnapshot(
      review,
      state({
        captured: { ...emptyCapturedLead, email: "asha@example.com" },
        emailCaptureMode: "adaptive",
        emailVerification: {
          value: "asha@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "medium",
        },
      }),
      "listening",
    );

    expect(snapshot.emailCaptureMode).toBe("adaptive");
    expect(snapshot.emailVerification).toEqual({
      source: "speech",
      status: "confirmed",
      confidence: "medium",
      matchesCaptured: true,
    });
    expect(JSON.stringify(snapshot.emailVerification)).not.toContain("asha@example.com");
  });
});
