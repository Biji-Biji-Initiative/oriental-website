import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminReviewDashboard,
  getAdminVoiceSession,
  persistLead,
  persistVoiceReviewSnapshot,
  recordLeadNotificationStatus,
  updateAdminLeadWorkflow,
} from "@/lib/server/convex";
import type { StoredLead } from "@/lib/server/notifications";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mocks.mutation;
    query = mocks.query;

    constructor(url: string) {
      mocks.client(url);
    }
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    leads: {
      createLead: "createLead",
      recordLeadNotification: "recordLeadNotification",
      voiceSessionByReviewId: "voiceSessionByReviewId",
      updateLeadWorkflow: "updateLeadWorkflow",
      recordVoiceSession: "recordVoiceSession",
      reviewDashboard: "reviewDashboard",
    },
  },
}));

const originalEnv = process.env;

function lead(): StoredLead {
  return {
    id: "lead_123",
    source: "voice",
    segment: "technology",
    routedTo: "Gurpreet",
    routedToEmail: "gurpreet@example.com",
    form: {
      name: "Asha",
      email: "asha@example.com",
      org: "Future Lab",
      phone: "",
      website: "",
      message: "We want to run public AI literacy demos.",
    },
    transcript: [],
    turnstileToken: "local-dev",
    utm: {},
  };
}

describe("persistLead", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "'https://convex.example'",
      CONVEX_INGEST_SECRET: "'ingest-secret'",
    };
    mocks.mutation.mockResolvedValue({ id: "lead_123" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("sanitizes quoted Infisical values before creating the Convex client", async () => {
    await expect(persistLead(lead())).resolves.toEqual({ id: "lead_123", persisted: true });

    expect(mocks.client).toHaveBeenCalledWith("https://convex.example");
    expect(mocks.mutation).toHaveBeenCalledWith("createLead", {
      lead: expect.objectContaining({ id: "lead_123" }),
      ingestSecret: "ingest-secret",
    });
  });

  it("retries profiled leads against a pre-profile Convex deployment", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("ArgumentValidationError: unexpected field `voiceRuntimeProfile`"))
      .mockResolvedValueOnce({ id: "lead_123" });

    await expect(
      persistLead({
        ...lead(),
        voiceRuntimeProfile: "instant-v1",
        voiceInputPolicy: "fast",
        voiceModelCell: "candidate",
        voiceReasoningCell: "minimal",
      }),
    ).resolves.toEqual({ id: "lead_123", persisted: true });

    const retryArgs = mocks.mutation.mock.calls[1]?.[1] as { lead: Record<string, unknown> };
    expect(retryArgs.lead).not.toHaveProperty("voiceRuntimeProfile");
    expect(retryArgs.lead).not.toHaveProperty("voiceInputPolicy");
    expect(retryArgs.lead).not.toHaveProperty("voiceModelCell");
    expect(retryArgs.lead).not.toHaveProperty("voiceReasoningCell");
  });

  it("applies admin workflow mutations through Convex", async () => {
    mocks.mutation.mockResolvedValue({ ok: true });

    await expect(
      updateAdminLeadWorkflow("lead_123", {
        status: "qualified",
        priority: "urgent",
        owner: "Gurpreet",
        note: "Ready for direct follow-up.",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.mutation).toHaveBeenCalledWith("updateLeadWorkflow", {
      ingestSecret: "ingest-secret",
      leadId: "lead_123",
      status: "qualified",
      priority: "urgent",
      owner: "Gurpreet",
      note: "Ready for direct follow-up.",
    });
  });
});

describe("getAdminVoiceSession", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "https://convex.example",
      CONVEX_INGEST_SECRET: "ingest-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("loads one full voice session by review id", async () => {
    mocks.query.mockResolvedValue({ reviewId: "review_1", transcript: [{ role: "user", text: "hello" }] });

    await expect(getAdminVoiceSession("review_1")).resolves.toEqual({
      ok: true,
      session: { reviewId: "review_1", transcript: [{ role: "user", text: "hello" }] },
    });
    expect(mocks.query).toHaveBeenCalledWith("voiceSessionByReviewId", {
      ingestSecret: "ingest-secret",
      reviewId: "review_1",
    });
  });

  it("reports not_found when the review id does not exist", async () => {
    mocks.query.mockResolvedValue(null);

    await expect(getAdminVoiceSession("missing")).resolves.toEqual({ ok: false, reason: "not_found" });
  });
});

describe("getAdminReviewDashboard", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "https://convex.example",
      CONVEX_INGEST_SECRET: "ingest-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("counts availability close reasons as session errors even when the Realtime server sent no error event", async () => {
    mocks.query.mockResolvedValue({
      metrics: { sessionsWithErrors: 0 },
      analytics: { voice: { withErrors: 0 } },
      voiceSessions: [
        { reviewId: "quota", closeReason: "realtime_quota_exhausted", errors: [] },
        { reviewId: "protocol", closeReason: "manual", errors: [{ message: "bad event" }] },
        { reviewId: "clean", closeReason: "manual", errors: [] },
      ],
    });

    const result = await getAdminReviewDashboard(75);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metrics.sessionsWithErrors).toBe(2);
      expect(result.data.analytics.voice.withErrors).toBe(2);
    }
    expect(mocks.query).toHaveBeenCalledWith("reviewDashboard", { ingestSecret: "ingest-secret", limit: 75 });
  });
});

describe("recordLeadNotificationStatus", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "https://convex.example",
      CONVEX_INGEST_SECRET: "ingest-secret",
    };
    mocks.mutation.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("persists channel-specific notification outcomes including ClickUp", async () => {
    await expect(
      recordLeadNotificationStatus(
        "lead_123",
        {
          email: { ok: false, error: "smtp_down" },
          slack: { ok: true, transport: "slack" },
          clickup: { ok: true, transport: "clickup" },
          confirmation: { ok: true, transport: "smtp" },
        },
        true,
      ),
    ).resolves.toEqual({ ok: true });

    expect(mocks.mutation).toHaveBeenCalledWith("recordLeadNotification", {
      ingestSecret: "ingest-secret",
      leadId: "lead_123",
      notificationDelivered: true,
      emailOk: false,
      slackOk: true,
      clickupOk: true,
      confirmationOk: true,
      summary: "email=smtp_down slack=slack clickup=clickup confirmation=smtp",
    });
  });
});

describe("persistVoiceReviewSnapshot", () => {
  const snapshot = {
    reviewId: "review_1",
    sessionId: "session_1",
    segment: "technology" as const,
    status: "idle" as const,
    connectionStatus: "listening" as const,
    captured: { name: "", email: "", org: "", phone: "", website: "", message: "" },
    transcript: [],
    errors: [],
    rateLimits: [],
    routeRequested: false,
    runtimeProfile: "instant-v1" as const,
    inputPolicy: "fast" as const,
    modelCell: "candidate" as const,
    reasoningCell: "minimal" as const,
    deviceProfile: "desktop" as const,
    deploymentEnvironment: "staging" as const,
    activationAttempted: true,
    emailVerification: {
      source: "speech" as const,
      status: "pending" as const,
      matchesCaptured: true,
    },
    transport: {
      realtimeBusyRetryCount: 0,
      disconnectCount: 1,
      recoveryCount: 1,
      iceRestartCount: 1,
      transitions: [{ state: "disconnected", at: 10 }],
    },
    latency: {
      version: 1 as const,
      turns: [
        {
          sequence: 1,
          inputPolicy: "baseline" as const,
          stopToResponseCreatedMs: 180,
          stopToFirstOutputEventMs: 420,
          interrupted: false,
          rapidResume: false,
        },
      ],
    },
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "https://convex.example",
      CONVEX_INGEST_SECRET: "ingest-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("persists transport and latency telemetry when Convex accepts them", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, id: "review_1" });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({ ok: true, id: "review_1" });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "recordVoiceSession",
      expect.objectContaining({
        snapshot: expect.objectContaining({
          transport: expect.any(Object),
          latency: expect.objectContaining({ version: 1 }),
        }),
      }),
    );
    const mutationSnapshot = mocks.mutation.mock.calls[0]?.[1]?.snapshot;
    expect(mutationSnapshot).not.toHaveProperty("emailVerification");
  });

  it("retries without telemetry when a pre-migration Convex rejects an unknown field", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("ArgumentValidationError: unexpected field `transport`"))
      .mockResolvedValueOnce({ ok: true, id: "review_1" });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({ ok: true, id: "review_1" });
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    const retryArgs = mocks.mutation.mock.calls[1]?.[1] as { snapshot: Record<string, unknown> };
    expect(retryArgs.snapshot).not.toHaveProperty("transport");
    expect(retryArgs.snapshot).not.toHaveProperty("latency");
    expect(retryArgs.snapshot).not.toHaveProperty("runtimeProfile");
    expect(retryArgs.snapshot).not.toHaveProperty("inputPolicy");
    expect(retryArgs.snapshot).not.toHaveProperty("modelCell");
    expect(retryArgs.snapshot).not.toHaveProperty("reasoningCell");
    expect(retryArgs.snapshot).not.toHaveProperty("deviceProfile");
    expect(retryArgs.snapshot).not.toHaveProperty("deploymentEnvironment");
    expect(retryArgs.snapshot).not.toHaveProperty("activationAttempted");
    expect(retryArgs.snapshot).toMatchObject({ reviewId: "review_1" });
  });
});
