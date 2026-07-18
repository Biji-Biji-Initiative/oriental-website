import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/voice/debug/route";
import { resetRateLimitBucketsForTest } from "@/lib/server/rate-limit";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";
import { VOICE_SMOKE_SYNTHETIC_EMAIL } from "@/lib/server/voice-smoke-proof";

const mocks = vi.hoisted(() => ({
  persistVoiceReviewSnapshot: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  sendOpsAlert: vi.fn(),
  runAdminVoiceEvals: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistVoiceReviewSnapshot: mocks.persistVoiceReviewSnapshot,
}));

vi.mock("@/lib/server/logger", () => ({
  logInfo: mocks.logInfo,
  logWarn: mocks.logWarn,
}));

vi.mock("@/lib/server/ops-alerts", () => ({
  sendOpsAlert: mocks.sendOpsAlert,
}));

vi.mock("@/lib/server/voice-evals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/voice-evals")>();
  return { ...actual, runAdminVoiceEvals: mocks.runAdminVoiceEvals };
});

const originalEnv = process.env;

function snapshotRequest(
  review: { id: string; token: string } = createVoiceReviewCredentials(),
  overrides: Record<string, unknown> = {},
) {
  return new Request("http://127.0.0.1/api/voice/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      review: { id: review.id, token: review.token },
      snapshot: {
        sessionId: "sess_123",
        snapshotSequence: 1,
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
        modelCell: "candidate",
        reasoningCell: "low",
        voice: "marin",
        speed: 1.18,
        variant: "kl-polished",
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          message: "AI literacy demos.",
        },
        emailVerification: {
          source: "speech",
          status: "pending",
          matchesCaptured: true,
          confidence: "medium",
        },
        emailCaptureMode: "adaptive",
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
          toolCalls: [
            {
              sequence: 1,
              name: "lookup_oriental",
              outcome: "success",
              executionMs: 12,
              responseCreatedToCallMs: 140,
              responseCreatedToResultMs: 152,
            },
          ],
        },
        ...overrides,
      },
    }),
  });
}

describe("POST /api/voice/debug", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      EVAL_AUTO_ON_CLOSE: "false",
      IP_HASH_SECRET: "voice-review-secret",
    };
    mocks.persistVoiceReviewSnapshot.mockResolvedValue({
      ok: true,
      id: "review_123",
      applied: true,
      autoEvalQueued: false,
    });
    mocks.sendOpsAlert.mockResolvedValue({ ok: true, transport: "slack" });
    mocks.runAdminVoiceEvals.mockResolvedValue({ ok: false, reason: "no_sessions" });
    resetRateLimitBucketsForTest();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetRateLimitBucketsForTest();
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

  it("persists the server-authenticated smoke marker on a pre-audio terminal snapshot", async () => {
    const syntheticReview = createVoiceReviewCredentials(Date.now(), { synthetic: true });
    const response = await POST(
      snapshotRequest(syntheticReview, {
        connectionStatus: "connecting",
        closeReason: "realtime_quota_exhausted",
        transcript: [],
        captured: { name: "", email: "", org: "", phone: "", website: "", message: "" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.persistVoiceReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        captured: expect.objectContaining({ email: VOICE_SMOKE_SYNTHETIC_EMAIL }),
        closeReason: "realtime_quota_exhausted",
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
        modelCell: "candidate",
        reasoningCell: "low",
        voice: "marin",
        speed: 1.18,
        variant: "kl-polished",
        transcriptTurns: 1,
        transcriptRoles: { user: 1, assistant: 0, system: 0 },
        capturedFields: expect.objectContaining({ email: true, message: true }),
        capturedFieldCount: 4,
        emailCaptureMode: "adaptive",
        emailVerification: { source: "speech", status: "pending", matchesCaptured: true, confidence: "medium" },
        routeRequested: false,
        errorCount: 0,
        benignErrorCount: 0,
        rateLimitCount: 0,
        usage: expect.objectContaining({ responseCount: 1, transcriptionCount: 1 }),
        latency: {
          tapToLiveMs: 480,
          tapToAudibleMs: null,
          usefulStartWithinTwoSeconds: null,
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
          toolCallSamples: 1,
          toolCallsByName: {
            lookup_oriental: {
              samples: 1,
              executionP50Ms: 12,
              executionP95Ms: 12,
              responseCreatedToCallP50Ms: 140,
              responseCreatedToCallP95Ms: 140,
              responseCreatedToResultP50Ms: 152,
              responseCreatedToResultP95Ms: 152,
              rejected: 0,
              failed: 0,
            },
          },
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

  it("keeps expected cancellation races out of actionable error warnings", async () => {
    const request = await snapshotRequest();
    const body = (await request.json()) as { snapshot: { errors: Array<{ code: string; message: string }> } };
    body.snapshot.errors = [
      { code: "response_cancel_not_active", message: "Cancellation failed: no active response found" },
    ];

    const response = await POST(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "voice_review.session_snapshot",
      expect.objectContaining({ errorCount: 0, benignErrorCount: 1 }),
    );
    expect(mocks.logWarn).not.toHaveBeenCalledWith("voice_review.session_errors", expect.anything());
  });

  it("logs only PII-free issue paths for invalid snapshots", async () => {
    const base = (await snapshotRequest().json()) as {
      snapshot: { connectionStatus: string; captured: { email: string } };
    };
    base.snapshot.connectionStatus = "not-a-state";
    base.snapshot.captured.email = "private@example.com";
    const response = await POST(
      new Request("http://127.0.0.1/api/voice/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(base),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.logWarn).toHaveBeenCalledWith("voice_review.invalid_payload", {
      issues: expect.arrayContaining([{ path: "snapshot.connectionStatus", code: "invalid_value" }]),
    });
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("private@example.com");
  });

  it("alerts only after three distinct exhausted-quota signals without captured PII", async () => {
    for (let signal = 0; signal < 3; signal += 1) {
      const response = await POST(
        snapshotRequest(createVoiceReviewCredentials(), {
          connectionStatus: "connecting",
          closeReason: "realtime_quota_exhausted",
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(mocks.logWarn).toHaveBeenCalledWith(
      "voice_review.availability_failed",
      expect.objectContaining({ closeReason: "realtime_quota_exhausted", connected: true }),
    );
    expect(mocks.sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "voice_review.realtime_quota_exhausted",
        severity: "critical",
        fingerprint: "realtime_quota_exhausted",
        meta: { signalCount: 3, windowMinutes: 10 },
      }),
    );
    expect(mocks.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.sendOpsAlert.mock.calls)).not.toContain("asha@example.com");
  });

  it("does not count replayed quota snapshots from one review as distinct alert signals", async () => {
    const review = createVoiceReviewCredentials();
    for (let replay = 0; replay < 4; replay += 1) {
      const response = await POST(
        snapshotRequest(review, {
          connectionStatus: "connecting",
          closeReason: "realtime_quota_exhausted",
        }),
      );
      expect(response.status).toBe(200);
    }

    expect(mocks.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("redacts untrusted provider prose before persistence and structured logs", async () => {
    const privateText = "Failed for visitor@example.com with private words";
    const response = await POST(
      snapshotRequest(createVoiceReviewCredentials(), {
        errors: [{ eventId: "visitor@example.com", code: "provider_error", message: privateText }],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.persistVoiceReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: [{ code: "provider_error", message: "Realtime error (provider_error)" }],
      }),
    );
    expect(JSON.stringify(mocks.persistVoiceReviewSnapshot.mock.calls)).not.toContain(privateText);
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain(privateText);
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain(privateText);
    expect(JSON.stringify(mocks.persistVoiceReviewSnapshot.mock.calls)).not.toContain("visitor@example.com");
  });

  it("maps client-invented error codes to a fixed diagnostic category", async () => {
    const response = await POST(
      snapshotRequest(createVoiceReviewCredentials(), {
        errors: [{ code: "asha-private-lab", message: "visitor@example.com" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.persistVoiceReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ errors: [{ code: "realtime_error", message: "Realtime error (realtime_error)" }] }),
    );
    expect(JSON.stringify(mocks.persistVoiceReviewSnapshot.mock.calls)).not.toMatch(
      /asha-private-lab|visitor@example\.com/,
    );
  });

  it("auto-evaluates a closed conversation once without forcing targeted rescoring", async () => {
    process.env.EVAL_AUTO_ON_CLOSE = "true";
    const review = createVoiceReviewCredentials();
    mocks.persistVoiceReviewSnapshot
      .mockResolvedValueOnce({ ok: true, id: review.id, applied: true, autoEvalQueued: true })
      .mockResolvedValueOnce({ ok: true, id: review.id, applied: false, autoEvalQueued: false });

    await POST(snapshotRequest(review));
    await POST(snapshotRequest(review));

    await vi.waitFor(() => {
      expect(mocks.runAdminVoiceEvals).toHaveBeenCalledTimes(1);
    });
    expect(mocks.runAdminVoiceEvals).toHaveBeenCalledWith({
      limit: 1,
      reviewIds: [review.id],
      rescoreTargeted: false,
    });
  });

  it("rejects arbitrary nested rate-limit payloads", async () => {
    const response = await POST(
      snapshotRequest(createVoiceReviewCredentials(), {
        rateLimits: [{ name: "requests", limit: 100, remaining: 90, reset_seconds: 5, arbitrary: { email: "x@y.z" } }],
      }),
    );

    // Zod strips unknown object keys but retains only the bounded fixed shape.
    expect(response.status).toBe(200);
    expect(mocks.persistVoiceReviewSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimits: [{ name: "requests", limit: 100, remaining: 90, reset_seconds: 5 }],
      }),
    );
    expect(JSON.stringify(mocks.persistVoiceReviewSnapshot.mock.calls)).not.toContain("x@y.z");
  });
});
