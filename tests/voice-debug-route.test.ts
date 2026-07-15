import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/debug/route";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";

const mocks = vi.hoisted(() => ({
  persistVoiceReviewSnapshot: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistVoiceReviewSnapshot: mocks.persistVoiceReviewSnapshot,
}));

vi.mock("@/lib/server/logger", () => ({
  logInfo: mocks.logInfo,
  logWarn: mocks.logWarn,
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
        closeReason: "manual",
        prewarmedAt: 1000,
        connectStartedAt: 2000,
        connectedAt: 2600,
        firstEventAt: 3200,
        closedAt: 8000,
        model: "gpt-realtime-2",
        voice: "marin",
        speed: 1.18,
        variant: "kl-polished",
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          message: "AI literacy demos.",
        },
        transcript: [{ role: "user", text: "I can run demos." }],
        usage: {
          responseCount: 1,
          responseTokens: 120,
          responseInputTokens: 80,
          responseOutputTokens: 40,
          responseCachedTokens: 12,
          transcriptionCount: 1,
          transcriptionTokens: 20,
          transcriptionInputTokens: 10,
          transcriptionOutputTokens: 10,
        },
        errors: [],
        rateLimits: [],
        routeRequested: false,
        latency: {
          version: 1,
          activation: { tapToArmCueScheduledMs: 4, tapToLiveMs: 480 },
          turns: [
            {
              sequence: 1,
              inputPolicy: "baseline",
              speechDurationMs: 900,
              stopToResponseCreatedMs: 180,
              stopToFirstOutputEventMs: 420,
              toolDurationMs: 35,
              responseDurationMs: 1700,
              interrupted: false,
              rapidResume: false,
            },
          ],
        },
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
      expect.objectContaining({
        reviewId: expect.any(String),
        variant: "kl-polished",
        latency: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it("logs structured voice session health without captured PII or transcript text", async () => {
    const response = await POST(snapshotRequest());

    expect(response.status).toBe(200);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "voice_review.session_snapshot",
      expect.objectContaining({
        reviewId: expect.any(String),
        sessionId: "sess_123",
        leadId: null,
        segment: "technology",
        status: "idle",
        connectionStatus: "listening",
        closeReason: "manual",
        prewarmedAt: 1000,
        connectStartedAt: 2000,
        connectedAt: 2600,
        firstEventAt: 3200,
        closedAt: 8000,
        model: "gpt-realtime-2",
        voice: "marin",
        speed: 1.18,
        variant: "kl-polished",
        transcriptTurns: 1,
        transcriptRoles: { user: 1, assistant: 0, system: 0 },
        capturedFields: expect.objectContaining({ email: true, message: true }),
        capturedFieldCount: 4,
        routeRequested: false,
        errorCount: 0,
        rateLimitCount: 0,
        usage: expect.objectContaining({ responseCount: 1, transcriptionCount: 1 }),
        latency: {
          sampledTurns: 1,
          firstOutputSamples: 1,
          firstOutputP50Ms: 420,
          firstOutputP95Ms: 420,
          responseCreatedSamples: 1,
          responseCreatedP50Ms: 180,
          responseCreatedP95Ms: 180,
          toolSamples: 1,
          toolP50Ms: 35,
          toolP95Ms: 35,
          interruptedTurns: 0,
          rapidResumeTurns: 0,
        },
      }),
    );

    const healthLog = mocks.logInfo.mock.calls.find(([event]) => event === "voice_review.session_snapshot")?.[1];
    const healthLogJson = JSON.stringify(healthLog);
    expect(healthLogJson).not.toContain("Asha");
    expect(healthLogJson).not.toContain("asha@example.com");
    expect(healthLogJson).not.toContain("Future Lab");
    expect(healthLogJson).not.toContain("AI literacy demos");
    expect(healthLogJson).not.toContain("I can run demos");
  });

  it("rejects unverified production snapshots", async () => {
    const response = await POST(snapshotRequest({ id: crypto.randomUUID(), token: "bad-token-with-enough-length" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ ok: false, error: "unauthorized" });
    expect(mocks.persistVoiceReviewSnapshot).not.toHaveBeenCalled();
  });
});
