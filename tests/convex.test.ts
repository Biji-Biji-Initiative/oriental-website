import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLead, recordVoiceSession } from "@/convex/leads";
import { summarizeIntakeAttribution } from "@/lib/intake-attribution-analytics";
import {
  archiveAdminLeads,
  backfillVoiceSessionLifecycle,
  bulkAssignAdminLeads,
  deletePersonalData,
  getAdminLeadSlaSnapshot,
  getAdminLeadTable,
  getAdminOrphanedVoiceSessions,
  getAdminReviewDashboard,
  getAdminVoiceSession,
  getPrivacyDeletionPlan,
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
      adminLeadCounts: "adminLeadCounts",
      adminLeadSlaSnapshot: "adminLeadSlaSnapshot",
      adminLeadTable: "adminLeadTable",
      adminOrphanedVoiceSessionsSweep: "adminOrphanedVoiceSessionsSweep",
      archiveLeads: "archiveLeads",
      backfillVoiceSessionLifecycle: "backfillVoiceSessionLifecycle",
      createLead: "createLead",
      deletePersonalData: "deletePersonalData",
      bulkAssignLeads: "bulkAssignLeads",
      recordLeadNotification: "recordLeadNotification",
      normalizeLegacyPrivacyEmails: "normalizeLegacyPrivacyEmails",
      privacyDeletionPlanByEmail: "privacyDeletionPlanByEmail",
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

describe("intake attribution aggregates", () => {
  const unknownField = { method: "unknown", correctionCount: 0, clearCount: 0 };

  it("keeps legacy rows visible while aggregating new and newsletter provenance", () => {
    const analytics = summarizeIntakeAttribution([
      {},
      {
        entryPoint: "hero_primary",
        entryMethod: "voice_button",
        submissionMethod: "voice_command",
        fieldProvenance: {
          name: { method: "voice", correctionCount: 0, clearCount: 0 },
          email: { method: "voice", correctionCount: 1, clearCount: 1 },
          org: unknownField,
          phone: unknownField,
          website: unknownField,
          message: { method: "mixed", correctionCount: 2, clearCount: 0 },
        },
      },
      {
        entryPoint: "hero_updates",
        entryMethod: "email_capture",
        submissionMethod: "email_capture_button",
        fieldProvenance: {
          name: unknownField,
          email: { method: "form", correctionCount: 0, clearCount: 0 },
          org: unknownField,
          phone: unknownField,
          website: unknownField,
          message: unknownField,
        },
      },
    ]);

    expect(analytics.entryMethodCounts).toEqual({ unknown: 1, voice_button: 1, email_capture: 1 });
    expect(analytics.entryPointSubmissionMatrix).toEqual({
      unknown: { unknown: 1 },
      hero_primary: { voice_command: 1 },
      hero_updates: { email_capture_button: 1 },
    });
    expect(analytics.entryMethodSubmissionMatrix).toEqual({
      unknown: { unknown: 1 },
      voice_button: { voice_command: 1 },
      email_capture: { email_capture_button: 1 },
    });
    expect(analytics.attributionCoverage).toEqual({
      total: 3,
      complete: 2,
      partial: 0,
      legacy: 1,
      completePercent: 66.7,
    });
    expect(analytics.fieldCompletionCounts.email).toEqual({ unknown: 1, voice: 1, form: 1 });
    expect(analytics.fieldCorrectionCounts).toMatchObject({ email: 1, message: 2 });
    expect(analytics.fieldClearCounts).toMatchObject({ email: 1, message: 0 });
  });

  it("distinguishes partially attributed rows from untouched legacy rows", () => {
    const analytics = summarizeIntakeAttribution([{ entryPoint: "nav_mobile" }, {}]);

    expect(analytics.attributionCoverage).toEqual({
      total: 2,
      complete: 0,
      partial: 1,
      legacy: 1,
      completePercent: 0,
    });
  });
});

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

  it("strips new intake attribution only for a Convex forward-field validation error", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("ArgumentValidationError: unexpected field `entryPoint`"))
      .mockResolvedValueOnce({ id: "lead_123" });

    await expect(
      persistLead({
        ...lead(),
        entryPoint: "hero_primary",
        entryMethod: "voice_button",
        submissionMethod: "handoff_button",
        fieldProvenance: undefined,
      }),
    ).resolves.toEqual({ id: "lead_123", persisted: true });

    const retryArgs = mocks.mutation.mock.calls[1]?.[1] as { lead: Record<string, unknown> };
    expect(retryArgs.lead).not.toHaveProperty("entryPoint");
    expect(retryArgs.lead).not.toHaveProperty("entryMethod");
    expect(retryArgs.lead).not.toHaveProperty("submissionMethod");
    expect(retryArgs.lead).toHaveProperty("id", "lead_123");
  });

  it("does not retry a validator failure that is unrelated to forward fields", async () => {
    mocks.mutation.mockRejectedValue(new Error("ArgumentValidationError: source must be a valid literal"));

    await expect(persistLead({ ...lead(), entryPoint: "hero_primary", entryMethod: "voice_button" })).rejects.toThrow(
      "source must be a valid literal",
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  it("does not retry an attributed lead after an ambiguous non-validation failure", async () => {
    mocks.mutation.mockRejectedValue(new Error("network response lost"));

    await expect(
      persistLead({ ...lead(), entryPoint: "hero_primary", submissionMethod: "handoff_button" }),
    ).rejects.toThrow("network response lost");
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  it("does not infer a Convex validator failure from generic unknown-field wording", async () => {
    mocks.mutation.mockRejectedValue(new Error("upstream proxy returned unknown field state"));

    await expect(persistLead({ ...lead(), entryPoint: "hero_primary", entryMethod: "voice_button" })).rejects.toThrow(
      "unknown field state",
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  it("applies admin workflow mutations through Convex", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, changed: true, revision: 4 });

    await expect(
      updateAdminLeadWorkflow(
        "lead_123",
        {
          status: "qualified",
          priority: "urgent",
          owner: "Gurpreet",
          note: "Ready for direct follow-up.",
          nextActionAt: null,
          nextActionNote: "",
          outcomeReason: "Qualified for a scoped partnership call.",
          expectedRevision: 3,
          reason: "Qualification review complete.",
        },
        {
          actor: "Gurpreet",
          requestId: "request_123",
        },
      ),
    ).resolves.toEqual({ ok: true, changed: true, revision: 4 });

    expect(mocks.mutation).toHaveBeenCalledWith("updateLeadWorkflow", {
      ingestSecret: "ingest-secret",
      leadId: "lead_123",
      status: "qualified",
      priority: "urgent",
      owner: "Gurpreet",
      note: "Ready for direct follow-up.",
      nextActionAt: null,
      nextActionNote: "",
      outcomeReason: "Qualified for a scoped partnership call.",
      expectedRevision: 3,
      reason: "Qualification review complete.",
      actor: "Gurpreet",
      requestId: "request_123",
    });
  });

  it("applies atomic bulk assignments through Convex", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, count: 2 });

    await expect(
      bulkAssignAdminLeads(
        {
          leads: [
            { leadId: "lead_1", expectedRevision: 0 },
            { leadId: "lead_2", expectedRevision: 2 },
          ],
          owner: "Nadia",
          nextActionAt: 1_800_000_000_000,
          nextActionNote: "Send tailored introductions",
          reason: "Morning intake allocation",
        },
        { actor: "Gurpreet", requestId: "request_bulk_1" },
      ),
    ).resolves.toEqual({ ok: true, count: 2 });

    expect(mocks.mutation).toHaveBeenCalledWith("bulkAssignLeads", {
      ingestSecret: "ingest-secret",
      leads: [
        { leadId: "lead_1", expectedRevision: 0 },
        { leadId: "lead_2", expectedRevision: 2 },
      ],
      owner: "Nadia",
      nextActionAt: 1_800_000_000_000,
      nextActionNote: "Send tailored introductions",
      reason: "Morning intake allocation",
      actor: "Gurpreet",
      requestId: "request_bulk_1",
    });
  });

  it("applies atomic reversible archives through Convex", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, count: 2 });

    await expect(
      archiveAdminLeads(
        {
          action: "archive",
          leads: [
            { leadId: "lead_1", expectedRevision: 1 },
            { leadId: "lead_2", expectedRevision: 4 },
          ],
          reason: "Duplicate submissions",
        },
        { actor: "Nadia", requestId: "request_archive_1" },
      ),
    ).resolves.toEqual({ ok: true, count: 2 });

    expect(mocks.mutation).toHaveBeenCalledWith("archiveLeads", {
      ingestSecret: "ingest-secret",
      action: "archive",
      leads: [
        { leadId: "lead_1", expectedRevision: 1 },
        { leadId: "lead_2", expectedRevision: 4 },
      ],
      reason: "Duplicate submissions",
      actor: "Nadia",
      requestId: "request_archive_1",
    });
  });
});

describe("createLead idempotency", () => {
  it("returns the existing application lead ID without inserting duplicate rows or events", async () => {
    const first = vi.fn().mockResolvedValue({ leadId: "lead_123" });
    const withIndex = vi.fn().mockReturnValue({ first });
    const query = vi.fn().mockReturnValue({ withIndex });
    const insert = vi.fn();
    const handler = (
      createLead as unknown as {
        _handler: (ctx: unknown, args: { lead: StoredLead; ingestSecret: string }) => Promise<{ id: string }>;
      }
    )._handler;
    const previousSecret = process.env.CONVEX_INGEST_SECRET;
    process.env.CONVEX_INGEST_SECRET = "ingest-secret";

    try {
      await expect(
        handler({ db: { query, insert } }, { lead: lead(), ingestSecret: "ingest-secret" }),
      ).resolves.toEqual({ id: "lead_123" });
      expect(query).toHaveBeenCalledWith("leads");
      expect(withIndex).toHaveBeenCalledWith("by_lead_id", expect.any(Function));
      expect(insert).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.CONVEX_INGEST_SECRET;
      else process.env.CONVEX_INGEST_SECRET = previousSecret;
    }
  });

  it("normalizes new lead identity and bounds the duplicated lead transcript", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const withIndex = vi.fn().mockReturnValue({ first });
    const query = vi.fn().mockReturnValue({ withIndex });
    const insert = vi.fn().mockResolvedValue("row_1");
    const handler = (
      createLead as unknown as {
        _handler: (ctx: unknown, args: { lead: StoredLead; ingestSecret: string }) => Promise<{ id: string }>;
      }
    )._handler;
    const previousSecret = process.env.CONVEX_INGEST_SECRET;
    process.env.CONVEX_INGEST_SECRET = "ingest-secret";

    try {
      await handler(
        { db: { query, insert } },
        {
          lead: {
            ...lead(),
            form: { ...lead().form, email: " Visitor@Example.COM " },
            transcript: [
              { role: "user", text: "a".repeat(4_000) },
              { role: "assistant", text: "b".repeat(4_000) },
              { role: "user", text: "c".repeat(4_000) },
            ],
          },
          ingestSecret: "ingest-secret",
        },
      );

      expect(insert).toHaveBeenNthCalledWith(
        1,
        "leads",
        expect.objectContaining({
          email: "visitor@example.com",
          emailNormalized: "visitor@example.com",
          payloadSafe: true,
          hasRetainedTranscript: true,
          transcript: [
            { role: "assistant", text: "b".repeat(4_000) },
            { role: "user", text: "c".repeat(4_000) },
          ],
        }),
      );
    } finally {
      if (previousSecret === undefined) delete process.env.CONVEX_INGEST_SECRET;
      else process.env.CONVEX_INGEST_SECRET = previousSecret;
    }
  });
});

describe("recordVoiceSession monotonic persistence", () => {
  const incoming = {
    reviewId: "review_1",
    sessionId: "session_1",
    snapshotSequence: 6,
    segment: "technology",
    status: "idle",
    connectionStatus: "idle",
    closeReason: "manual",
    closedAt: 10_000,
    captured: { name: "", email: " Visitor@Example.COM ", org: "", phone: "", website: "", message: "" },
    transcript: [{ role: "user", text: "x".repeat(9_000) }],
    errors: [],
    rateLimits: [],
    routeRequested: false,
  };
  const handler = (
    recordVoiceSession as unknown as {
      _handler: (
        ctx: unknown,
        args: { snapshot: typeof incoming; ingestSecret: string },
      ) => Promise<{
        ok: boolean;
        id: string;
        applied: boolean;
        autoEvalQueued: boolean;
      }>;
    }
  )._handler;

  it("ignores stale or replayed sequences before they can erase submission linkage", async () => {
    const existing = {
      _id: "voice_1",
      reviewId: "review_1",
      snapshotSequence: 6,
      leadId: "lead_123",
      status: "submitted",
    };
    const unique = vi.fn().mockResolvedValue(existing);
    const patch = vi.fn();
    const previousSecret = process.env.CONVEX_INGEST_SECRET;
    process.env.CONVEX_INGEST_SECRET = "ingest-secret";
    try {
      await expect(
        handler(
          { db: { query: () => ({ withIndex: () => ({ unique }) }), patch } },
          { ingestSecret: "ingest-secret", snapshot: incoming },
        ),
      ).resolves.toEqual({ ok: true, id: "review_1", applied: false, autoEvalQueued: false });
      expect(patch).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) delete process.env.CONVEX_INGEST_SECRET;
      else process.env.CONVEX_INGEST_SECRET = previousSecret;
    }
  });

  it("keeps submitted fields monotonic and atomically queues only the first close evaluation", async () => {
    const existing = {
      _id: "voice_1",
      reviewId: "review_1",
      sessionId: "session_1",
      snapshotSequence: 5,
      leadId: "lead_123",
      status: "submitted",
      submittedAt: 9_000,
      createdAt: 1_000,
    };
    const unique = vi.fn().mockResolvedValue(existing);
    const patch = vi.fn();
    const previousSecret = process.env.CONVEX_INGEST_SECRET;
    process.env.CONVEX_INGEST_SECRET = "ingest-secret";
    try {
      await expect(
        handler(
          { db: { query: () => ({ withIndex: () => ({ unique }) }), patch } },
          { ingestSecret: "ingest-secret", snapshot: incoming },
        ),
      ).resolves.toMatchObject({ ok: true, id: "review_1", applied: true, autoEvalQueued: true });
      expect(patch).toHaveBeenCalledWith(
        "voice_1",
        expect.objectContaining({
          snapshotSequence: 6,
          leadId: "lead_123",
          status: "submitted",
          submittedAt: 9_000,
          autoEvalQueuedAt: expect.any(Number),
          payloadSafe: true,
          capturedEmailNormalized: "visitor@example.com",
          transcript: [{ role: "user", text: "x".repeat(8_000) }],
        }),
      );
    } finally {
      if (previousSecret === undefined) delete process.env.CONVEX_INGEST_SECRET;
      else process.env.CONVEX_INGEST_SECRET = previousSecret;
    }
  });
});

describe("getAdminLeadTable", () => {
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

  it("keeps the separately bounded count summary independent of the visible row window", async () => {
    const rows = [{ leadId: "lead_1" }, { leadId: "lead_2" }];
    const counts = {
      total: 720,
      active: 611,
      archived: 40,
      qualified: 69,
      unassignedActive: 83,
      highPriorityActive: 27,
      clickUpGaps: 14,
      newToday: 9,
      truncated: false,
    };
    mocks.query.mockImplementation((query) => Promise.resolve(query === "adminLeadTable" ? rows : counts));

    await expect(getAdminLeadTable(500)).resolves.toEqual({ ok: true, leads: rows, counts });
    expect(mocks.query).toHaveBeenCalledWith("adminLeadTable", {
      ingestSecret: "ingest-secret",
      limit: 500,
    });
    expect(mocks.query).toHaveBeenCalledWith("adminLeadCounts", {
      ingestSecret: "ingest-secret",
    });
  });

  it("caps oversized lead table requests without changing the count-query contract", async () => {
    mocks.query.mockImplementation((query) => Promise.resolve(query === "adminLeadTable" ? [] : { total: 2_400 }));

    await getAdminLeadTable(10_000);

    expect(mocks.query).toHaveBeenCalledWith("adminLeadTable", {
      ingestSecret: "ingest-secret",
      limit: 500,
    });
    expect(mocks.query).toHaveBeenCalledWith("adminLeadCounts", {
      ingestSecret: "ingest-secret",
    });
  });
});

describe("getAdminLeadSlaSnapshot", () => {
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

  it("uses the dedicated PII-free SLA aggregate instead of a recent dashboard window", async () => {
    const data = {
      generatedAt: 1_800_000_000_000,
      activeLeads: { count: 420, truncated: true },
      unownedBreaches: { count: 17, truncated: false, oldestCreatedAt: 1_799_900_000_000 },
      failedNotifications: { count: 2, truncated: false },
    };
    mocks.query.mockResolvedValue(data);

    await expect(getAdminLeadSlaSnapshot(4 * 60 * 60 * 1000)).resolves.toEqual({ ok: true, data });
    expect(mocks.query).toHaveBeenCalledWith("adminLeadSlaSnapshot", {
      ingestSecret: "ingest-secret",
      maxUnownedMs: 4 * 60 * 60 * 1000,
    });
    expect(mocks.query).not.toHaveBeenCalledWith("reviewDashboard", expect.anything());
  });
});

describe("orphan-session lifecycle operations", () => {
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

  it("queries the dedicated orphan aggregate with the requested stale boundary", async () => {
    const data = {
      generatedAt: 1_800_000_000_000,
      migrationPending: false,
      orphaned: { count: 2, truncated: false, rows: [] },
    };
    mocks.query.mockResolvedValue(data);

    await expect(getAdminOrphanedVoiceSessions(35 * 60_000)).resolves.toEqual({ ok: true, data });
    expect(mocks.query).toHaveBeenCalledWith("adminOrphanedVoiceSessionsSweep", {
      ingestSecret: "ingest-secret",
      maxStaleMs: 35 * 60_000,
    });
  });

  it("runs the bounded non-destructive lifecycle migration through the secret-owning adapter", async () => {
    mocks.mutation.mockResolvedValue({ updated: 25, hasMore: true });

    await expect(backfillVoiceSessionLifecycle(25)).resolves.toEqual({ ok: true, updated: 25, hasMore: true });
    expect(mocks.mutation).toHaveBeenCalledWith("backfillVoiceSessionLifecycle", {
      ingestSecret: "ingest-secret",
      limit: 25,
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
          slack: { ok: true, transport: "slack", externalId: "C123:1712345.678" },
          clickup: {
            ok: true,
            transport: "clickup",
            externalId: "task_123",
            externalUrl: "https://app.clickup.com/t/task_123",
          },
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
      slackMessageId: "C123:1712345.678",
      clickupOk: true,
      clickupTaskId: "task_123",
      clickupTaskUrl: "https://app.clickup.com/t/task_123",
      confirmationOk: true,
      summary: "email=smtp_down slack=slack clickup=clickup confirmation=smtp",
    });
  });
});

describe("persistVoiceReviewSnapshot", () => {
  const snapshot = {
    reviewId: "review_1",
    sessionId: "session_1",
    snapshotSequence: 1,
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
    entryPoint: "hero_primary" as const,
    entryMethod: "voice_button" as const,
    submissionMethod: "voice_command" as const,
    emailVerification: {
      source: "speech" as const,
      status: "pending" as const,
      matchesCaptured: true,
    },
    emailCaptureMode: "adaptive" as const,
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

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({
      ok: true,
      id: "review_1",
      applied: true,
      autoEvalQueued: false,
    });
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
    expect(mutationSnapshot).toHaveProperty("emailVerification", {
      source: "speech",
      status: "pending",
      matchesCaptured: true,
    });
    expect(mutationSnapshot).toHaveProperty("emailCaptureMode", "adaptive");
  });

  it("persists the canonical clear_fields label without a lossy clear_field alias", async () => {
    mocks.mutation.mockResolvedValue({ ok: true, id: "review_1" });
    const clearAllSnapshot = {
      ...snapshot,
      latency: {
        ...snapshot.latency,
        toolCalls: [
          {
            sequence: 2,
            name: "clear_fields" as const,
            outcome: "success" as const,
            executionMs: 7,
            responseCreatedToCallMs: 13,
            responseCreatedToResultMs: 20,
          },
        ],
      },
    };

    await expect(persistVoiceReviewSnapshot(clearAllSnapshot)).resolves.toEqual({
      ok: true,
      id: "review_1",
      applied: true,
      autoEvalQueued: false,
    });
    const mutationSnapshot = mocks.mutation.mock.calls[0]?.[1]?.snapshot;
    expect(mutationSnapshot.latency.toolCalls).toEqual(clearAllSnapshot.latency.toolCalls);
    expect(mutationSnapshot.latency.toolCalls[0]?.name).toBe("clear_fields");
  });

  it("retries without telemetry when a pre-migration Convex rejects an unknown field", async () => {
    mocks.mutation
      .mockRejectedValueOnce(new Error("ArgumentValidationError: unexpected field `transport`"))
      .mockResolvedValueOnce({ ok: true, id: "review_1" });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({
      ok: true,
      id: "review_1",
      applied: true,
      autoEvalQueued: false,
    });
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    const retryArgs = mocks.mutation.mock.calls[1]?.[1] as { snapshot: Record<string, unknown> };
    expect(retryArgs.snapshot).not.toHaveProperty("transport");
    expect(retryArgs.snapshot).not.toHaveProperty("latency");
    expect(retryArgs.snapshot).not.toHaveProperty("runtimeProfile");
    expect(retryArgs.snapshot).not.toHaveProperty("inputPolicy");
    expect(retryArgs.snapshot).not.toHaveProperty("emailVerification");
    expect(retryArgs.snapshot).not.toHaveProperty("emailCaptureMode");
    expect(retryArgs.snapshot).not.toHaveProperty("modelCell");
    expect(retryArgs.snapshot).not.toHaveProperty("reasoningCell");
    expect(retryArgs.snapshot).not.toHaveProperty("deviceProfile");
    expect(retryArgs.snapshot).not.toHaveProperty("deploymentEnvironment");
    expect(retryArgs.snapshot).not.toHaveProperty("activationAttempted");
    expect(retryArgs.snapshot).not.toHaveProperty("entryPoint");
    expect(retryArgs.snapshot).not.toHaveProperty("entryMethod");
    expect(retryArgs.snapshot).not.toHaveProperty("submissionMethod");
    expect(retryArgs.snapshot).not.toHaveProperty("snapshotSequence");
    expect(retryArgs.snapshot).toMatchObject({ reviewId: "review_1" });
  });

  it("does not hide non-validation voice snapshot failures behind the compatibility retry", async () => {
    mocks.mutation.mockRejectedValue(new Error("convex transport unavailable"));

    await expect(persistVoiceReviewSnapshot(snapshot)).rejects.toThrow("convex transport unavailable");
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
  });

  it("returns the atomic apply and auto-eval transition from Convex", async () => {
    mocks.mutation.mockResolvedValue({
      ok: true,
      id: "review_1",
      applied: true,
      autoEvalQueued: true,
    });

    await expect(persistVoiceReviewSnapshot(snapshot)).resolves.toEqual({
      ok: true,
      id: "review_1",
      applied: true,
      autoEvalQueued: true,
    });
  });
});

describe("privacy deletion data plane", () => {
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

  it("advances legacy normalization before returning a PII-free downstream plan", async () => {
    const plan = {
      leads: [
        {
          leadId: "lead_123",
          notificationEmailOk: true,
          notificationConfirmationOk: false,
          notificationSlackOk: true,
          notificationSlackMessageId: "C123:1712345.678",
          notificationClickUpOk: true,
          notificationClickUpTaskId: "task_123",
        },
      ],
      complete: true,
    };
    mocks.mutation.mockResolvedValue({ complete: true });
    mocks.query.mockResolvedValue(plan);

    await expect(getPrivacyDeletionPlan("visitor@example.com")).resolves.toEqual({ ok: true, ...plan });
    expect(mocks.mutation).toHaveBeenCalledWith("normalizeLegacyPrivacyEmails", {
      ingestSecret: "ingest-secret",
    });
    expect(mocks.query).toHaveBeenCalledWith("privacyDeletionPlanByEmail", {
      ingestSecret: "ingest-secret",
      email: "visitor@example.com",
    });
    expect(JSON.stringify(plan)).not.toContain("visitor@example.com");
  });

  it("fails closed unless downstream cleanup is explicitly complete", async () => {
    mocks.mutation.mockResolvedValue({
      deleted: { leads: 0, leadEvents: 0, voiceSessions: 0 },
      complete: false,
    });

    await deletePersonalData({
      email: "visitor@example.com",
      reason: "data_subject_request",
      requestId: "78584c0d-406a-41b5-ae9f-f2eb23650a0a",
      actor: "Oriental admin",
    });

    expect(mocks.mutation).toHaveBeenCalledWith(
      "deletePersonalData",
      expect.objectContaining({ downstreamCleanupComplete: false }),
    );
  });
});
