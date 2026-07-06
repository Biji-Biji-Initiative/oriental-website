import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminVoiceSession,
  persistLead,
  persistVoiceReviewSnapshot,
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
      voiceSessionByReviewId: "voiceSessionByReviewId",
      updateLeadWorkflow: "updateLeadWorkflow",
      recordVoiceSession: "recordVoiceSession",
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
    transport: {
      disconnectCount: 1,
      recoveryCount: 1,
      iceRestartCount: 1,
      transitions: [{ state: "disconnected", at: 10 }],
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

  it("persists the transport telemetry when Convex accepts it", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, id: "review_1" });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({ ok: true, id: "review_1" });
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith(
      "recordVoiceSession",
      expect.objectContaining({ snapshot: expect.objectContaining({ transport: expect.any(Object) }) }),
    );
  });

  it("retries without transport when a pre-migration Convex rejects the unknown field", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("ArgumentValidationError: unexpected field `transport`"))
      .mockResolvedValueOnce({ ok: true, id: "review_1" });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({ ok: true, id: "review_1" });
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    const retryArgs = mocks.mutation.mock.calls[1]?.[1] as { snapshot: Record<string, unknown> };
    expect(retryArgs.snapshot).not.toHaveProperty("transport");
    expect(retryArgs.snapshot).toMatchObject({ reviewId: "review_1" });
  });
});
