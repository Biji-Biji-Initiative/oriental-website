import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/leads/route";
import { createVoiceReviewCredentials } from "@/lib/server/voice-review-token";
import { verifyVoiceSubmissionEvidence } from "@/lib/server/voice-submission-evidence";
import { VOICE_SUBMISSION_EVIDENCE_UTM_KEY } from "@/lib/voice/submission-evidence";

const mocks = vi.hoisted(() => ({
  persistLead: vi.fn(),
  recordLeadNotificationStatus: vi.fn(),
  notifyOwner: vi.fn(),
  notifySlack: vi.fn(),
  notifyClickUp: vi.fn(),
  notifySubmitter: vi.fn(),
}));

vi.mock("@/lib/server/convex", () => ({
  persistLead: mocks.persistLead,
  recordLeadNotificationStatus: mocks.recordLeadNotificationStatus,
}));

vi.mock("@/lib/server/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/notifications")>();
  return {
    ...actual,
    notifyOwner: mocks.notifyOwner,
    notifySlack: mocks.notifySlack,
    notifyClickUp: mocks.notifyClickUp,
    notifySubmitter: mocks.notifySubmitter,
  };
});

const originalEnv = process.env;

function leadBody(overrides: Record<string, unknown> = {}) {
  const review = createVoiceReviewCredentials();
  return {
    source: "voice",
    segment: "technology",
    form: {
      name: "Asha",
      email: "asha@example.com",
      org: "Future Lab",
      phone: "",
      website: "",
      message: "We want to run public AI literacy demos.",
    },
    transcript: [{ role: "user", text: "We want to run public AI literacy demos." }],
    voiceReviewId: review.id,
    voiceReviewToken: review.token,
    voiceSessionId: "sess_123",
    voiceVariant: "kl-polished",
    voiceModel: "gpt-realtime-2",
    voiceModelCell: "candidate",
    voiceReasoningCell: "minimal",
    voiceName: "marin",
    voiceSpeed: 1.22,
    voiceRuntimeProfile: "instant-v1",
    voiceInputPolicy: "fast",
    voiceEmailVerified: true,
    voiceEmailVerificationSource: "speech",
    voiceEmailVerificationUserTurnSequence: 1,
    entryPoint: "hero_primary",
    entryMethod: "voice_button",
    submissionMethod: "voice_command",
    turnstileToken: "local-dev",
    utm: {},
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}, ip = "127.0.0.1") {
  return new Request("http://127.0.0.1/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(leadBody(overrides)),
  }) as never;
}

describe("POST /api/leads", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      IP_HASH_SECRET: "lead-route-test",
    };
    mocks.persistLead.mockResolvedValue({ id: "lead_123", persisted: true });
    mocks.recordLeadNotificationStatus.mockResolvedValue({ ok: true });
    mocks.notifyOwner.mockResolvedValue({ ok: false, skipped: true, reason: "email_unconfigured" });
    mocks.notifySlack.mockResolvedValue({ ok: true, transport: "slack" });
    mocks.notifyClickUp.mockResolvedValue({ ok: false, skipped: true, reason: "clickup_unconfigured" });
    mocks.notifySubmitter.mockResolvedValue({ ok: true, transport: "smtp" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns a successful local response instead of crashing when persistence fails outside production", async () => {
    mocks.persistLead.mockRejectedValue(new Error("convex_failed"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, persisted: false });
    expect(mocks.persistLead).toHaveBeenCalledTimes(1);
    expect(mocks.recordLeadNotificationStatus).not.toHaveBeenCalled();
  });

  it("returns notification delivery details with a successful response", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      persisted: true,
      notifications: {
        email: { ok: false, skipped: true, reason: "email_unconfigured" },
        slack: { ok: true, transport: "slack" },
        clickup: { ok: false, skipped: true, reason: "clickup_unconfigured" },
        confirmation: { ok: true, transport: "smtp" },
      },
    });
    expect(mocks.recordLeadNotificationStatus).toHaveBeenCalledWith(
      "lead_123",
      {
        email: body.notifications.email,
        slack: body.notifications.slack,
        clickup: body.notifications.clickup,
        confirmation: body.notifications.confirmation,
      },
      true,
    );
    expect(mocks.persistLead).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceReviewId: expect.any(String),
        voiceSessionId: "sess_123",
        voiceVariant: "kl-polished",
        voiceModel: "gpt-realtime-2",
        voiceModelCell: "candidate",
        voiceReasoningCell: "minimal",
        voiceName: "marin",
        voiceSpeed: 1.22,
        voiceRuntimeProfile: "instant-v1",
        voiceInputPolicy: "fast",
        entryPoint: "hero_primary",
        entryMethod: "voice_button",
        submissionMethod: "voice_command",
      }),
    );
    expect(mocks.persistLead.mock.calls[0]?.[0]).not.toHaveProperty("voiceReviewToken");
    expect(mocks.persistLead.mock.calls[0]?.[0]).not.toHaveProperty("voiceEmailVerified");
    expect(mocks.persistLead.mock.calls[0]?.[0]).not.toHaveProperty("voiceEmailVerificationSource");
  });

  it("persists ClickUp task references without exposing them to the public submitter response", async () => {
    mocks.notifyClickUp.mockResolvedValue({
      ok: true,
      transport: "clickup",
      externalId: "task_internal_123",
      externalUrl: "https://app.clickup.com/t/task_internal_123",
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notifications.clickup).toEqual({ ok: true, transport: "clickup" });
    expect(body.notifications.clickup).not.toHaveProperty("externalId");
    expect(body.notifications.clickup).not.toHaveProperty("externalUrl");
    expect(mocks.recordLeadNotificationStatus).toHaveBeenCalledWith(
      "lead_123",
      expect.objectContaining({
        clickup: expect.objectContaining({
          externalId: "task_internal_123",
          externalUrl: "https://app.clickup.com/t/task_internal_123",
        }),
      }),
      true,
    );
  });

  it("starts durable persistence and notification fan-out concurrently", async () => {
    let finishPersistence!: (value: { id: string; persisted: true }) => void;
    mocks.persistLead.mockReturnValue(
      new Promise((resolve) => {
        finishPersistence = resolve;
      }),
    );

    const responsePromise = POST(request());
    await vi.waitFor(() => {
      expect(mocks.notifyOwner).toHaveBeenCalledTimes(1);
      expect(mocks.notifySlack).toHaveBeenCalledTimes(1);
      expect(mocks.notifyClickUp).toHaveBeenCalledTimes(1);
      expect(mocks.notifySubmitter).toHaveBeenCalledTimes(1);
    });

    finishPersistence({ id: "lead_123", persisted: true });
    await expect(responsePromise).resolves.toHaveProperty("status", 200);
  });

  it("accepts signed voice leads without a Cloudflare token when Turnstile enforcement is required", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    const review = createVoiceReviewCredentials();
    const fetchMock = vi.fn(async () => Response.json({ success: false }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(
        {
          turnstileToken: undefined,
          voiceReviewId: review.id,
          voiceReviewToken: review.token,
        },
        "203.0.113.10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, acceptedAt: expect.any(Number) });
    expect(fetchMock).not.toHaveBeenCalled();
    const persistedLead = mocks.persistLead.mock.calls[0]?.[0];
    expect(persistedLead).not.toHaveProperty("voiceReviewToken");
    expect(persistedLead).not.toHaveProperty("voiceEmailVerificationUserTurnSequence");
    expect(
      verifyVoiceSubmissionEvidence(
        {
          email: persistedLead.form.email,
          leadId: persistedLead.id,
          transcript: persistedLead.transcript,
          utm: persistedLead.utm,
          voiceReviewId: persistedLead.voiceReviewId,
          voiceSessionId: persistedLead.voiceSessionId,
        },
        "lead-route-test",
      ),
    ).toMatchObject({
      acceptedAt: body.acceptedAt,
      authorityTurnSequence: 1,
      outcome: "none",
      provenance: "v1",
      source: "speech",
    });
    expect(JSON.stringify(body)).not.toMatch(/asha@example\.com|_mereka_voice_submission|[A-Za-z0-9_-]{43}/);
  });

  it("overwrites a client-supplied reserved evidence key", async () => {
    const review = createVoiceReviewCredentials();
    const response = await POST(
      request({
        voiceReviewId: review.id,
        voiceReviewToken: review.token,
        utm: { campaign: "oriental", [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "forged" },
      }),
    );
    expect(response.status).toBe(200);

    const persistedLead = mocks.persistLead.mock.calls[0]?.[0];
    expect(persistedLead.utm.campaign).toBe("oriental");
    expect(persistedLead.utm[VOICE_SUBMISSION_EVIDENCE_UTM_KEY]).not.toBe("forged");
    expect(
      verifyVoiceSubmissionEvidence(
        {
          email: persistedLead.form.email,
          leadId: persistedLead.id,
          transcript: persistedLead.transcript,
          utm: persistedLead.utm,
          voiceReviewId: persistedLead.voiceReviewId,
          voiceSessionId: persistedLead.voiceSessionId,
        },
        "lead-route-test",
      ),
    ).not.toBeNull();
  });

  it("rejects signed voice evidence whose authority sequence exceeds the transcript", async () => {
    const review = createVoiceReviewCredentials();
    const response = await POST(
      request({
        voiceReviewId: review.id,
        voiceReviewToken: review.token,
        voiceEmailVerificationUserTurnSequence: 2,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "voice_submission_attribution_incomplete" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.notifySlack).not.toHaveBeenCalled();
    expect(mocks.notifyClickUp).not.toHaveBeenCalled();
    expect(mocks.notifySubmitter).not.toHaveBeenCalled();
  });

  it("rejects an unconfirmed voice email before persistence or notifications", async () => {
    const response = await POST(request({ voiceEmailVerified: false }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ ok: false, error: "voice_email_unconfirmed" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.notifySubmitter).not.toHaveBeenCalled();
  });

  it("rejects an impossible source and submission-method pair before side effects", async () => {
    const response = await POST(request({ source: "form", submissionMethod: "voice_command" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: "invalid_payload" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(mocks.notifySubmitter).not.toHaveBeenCalled();
  });

  it("rejects a voice command without signed review linkage before side effects", async () => {
    const response = await POST(request({ voiceReviewId: undefined, voiceReviewToken: undefined }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: "invalid_payload" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("rejects a voice-attributed handoff button without signed review linkage", async () => {
    const response = await POST(
      request({
        submissionMethod: "handoff_button",
        voiceReviewId: undefined,
        voiceReviewToken: undefined,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_payload" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("rejects invalid voice-review credentials even when Turnstile could otherwise pass", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

    const response = await POST(
      request(
        {
          voiceReviewToken: "invalid-review-token-that-is-long-enough",
          turnstileToken: "local-dev",
        },
        "203.0.113.10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "voice_review_invalid" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
  });

  it("still requires Turnstile for form leads when enforcement is required", async () => {
    process.env.TURNSTILE_ENFORCEMENT = "required";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";

    const response = await POST(
      request(
        {
          source: "form",
          entryMethod: "form",
          submissionMethod: "handoff_button",
          turnstileToken: undefined,
          voiceReviewId: undefined,
          voiceSessionId: undefined,
          voiceVariant: undefined,
          voiceModel: undefined,
          voiceModelCell: undefined,
          voiceReasoningCell: undefined,
          voiceName: undefined,
          voiceSpeed: undefined,
          voiceRuntimeProfile: undefined,
          voiceInputPolicy: undefined,
        },
        "203.0.113.10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "turnstile_failed" });
    expect(mocks.persistLead).not.toHaveBeenCalled();
  });

  describe("production persistence failure", () => {
    beforeEach(() => {
      process.env = {
        ...process.env,
        NODE_ENV: "production",
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        OWNER_TECHNOLOGY: "gurpreet@example.com",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: true, ok: true })),
      );
      mocks.persistLead.mockRejectedValue(new Error("convex_down"));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("degrades to notification-only delivery instead of dropping the lead", async () => {
      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        ok: true,
        persisted: false,
        notifications: { slack: { ok: true, transport: "slack" } },
      });
      expect(mocks.notifySlack).toHaveBeenCalledTimes(1);
      expect(mocks.notifyClickUp).toHaveBeenCalledTimes(1);
      expect(mocks.recordLeadNotificationStatus).not.toHaveBeenCalled();
    });

    it("returns 502 only when persistence and every notification channel fail", async () => {
      mocks.notifyOwner.mockResolvedValue({ ok: false, error: "smtp_down" });
      mocks.notifySlack.mockResolvedValue({ ok: false, error: "slack_http_error", status: 500 });
      mocks.notifyClickUp.mockResolvedValue({ ok: false, error: "clickup_api_error", status: 500 });

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toMatchObject({ ok: false, error: "persistence_failed", reason: "convex_down" });
    });
  });
});
