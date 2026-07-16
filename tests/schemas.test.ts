import { describe, expect, it } from "vitest";
import { adminLeadWorkflowSchema, adminLoginSchema, leadRequestSchema, voiceReviewSnapshotSchema } from "@/lib/schemas";

describe("lead request schema", () => {
  it("accepts a complete form lead", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "form",
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "We want to run public AI literacy demos with community groups.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts voice review linkage metadata on submitted voice leads", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "voice",
      segment: "technology",
      voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
      voiceReviewToken: "5a8c25b1-cd50-4e47-89bf-84947c805add.1799999999999.signature",
      voiceSessionId: "sess_123",
      voiceVariant: "kl-polished",
      voiceModel: "gpt-realtime-2",
      voiceModelCell: "candidate",
      voiceReasoningCell: "minimal",
      voiceName: "marin",
      voiceSpeed: 1.22,
      voiceRuntimeProfile: "instant-v1",
      voiceInputPolicy: "fast",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "We want to run public AI literacy demos.",
      },
      transcript: [{ role: "user", text: "hello" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects transcripts beyond the 200-entry cap", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "voice",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "AI literacy demos.",
      },
      transcript: Array.from({ length: 201 }, () => ({ role: "user", text: "hello" })),
    });
    expect(parsed.success).toBe(false);
  });

  it("bounds utm key count and value lengths", () => {
    const base = {
      source: "form",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "AI literacy demos.",
      },
    };

    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, "v"]));
    expect(leadRequestSchema.safeParse({ ...base, utm: tooMany }).success).toBe(false);

    expect(leadRequestSchema.safeParse({ ...base, utm: { source: "x".repeat(301) } }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, utm: { utm_source: "newsletter" } }).success).toBe(true);
  });
});

describe("admin login schema", () => {
  it("accepts the shared admin password length", () => {
    expect(adminLoginSchema.safeParse({ token: "Cr3ativity" }).success).toBe(true);
  });

  it("accepts long generated admin review tokens", () => {
    expect(adminLoginSchema.safeParse({ token: `admin-${"x".repeat(600)}` }).success).toBe(true);
  });

  it("rejects very short admin tokens", () => {
    expect(adminLoginSchema.safeParse({ token: "short" }).success).toBe(false);
  });
});

describe("admin lead workflow schema", () => {
  it("accepts trimmed workflow updates", () => {
    const parsed = adminLeadWorkflowSchema.safeParse({
      status: "contacted",
      priority: "high",
      owner: "  Gurpreet  ",
      note: "  WhatsApp intro sent.  ",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.owner).toBe("Gurpreet");
      expect(parsed.data.note).toBe("WhatsApp intro sent.");
    }
  });

  it("rejects unknown workflow states", () => {
    expect(adminLeadWorkflowSchema.safeParse({ status: "done", priority: "normal", owner: "", note: "" }).success).toBe(
      false,
    );
  });
});

describe("voice review latency schema", () => {
  const request = {
    review: {
      id: "5a8c25b1-cd50-4e47-89bf-84947c805add",
      token: "review-token-that-is-long-enough",
    },
    snapshot: {
      sessionId: "sess_123",
      segment: "technology",
      status: "idle",
      connectionStatus: "listening",
      captured: { name: "", email: "", org: "", phone: "", website: "", message: "" },
      transcript: [],
      errors: [],
      rateLimits: [],
      routeRequested: false,
    },
  };
  const turn = {
    sequence: 1,
    inputPolicy: "baseline",
    stopToFirstOutputEventMs: 420,
    localSpeechEndToSpeechStoppedMs: 180,
    stopToRemoteAudioMs: 510,
    firstOutputEventToRemoteAudioMs: 90,
    toolDurationMs: 35,
    bargeInToResponseDoneMs: 120,
    interrupted: false,
    rapidResume: false,
  };

  it("accepts a distinct exhausted-quota close reason", () => {
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: { ...request.snapshot, connectionStatus: "connecting", closeReason: "realtime_quota_exhausted" },
      }).success,
    ).toBe(true);
  });

  it("accepts bounded first-output telemetry", () => {
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          runtimeProfile: "instant-v1",
          inputPolicy: "fast",
          modelCell: "candidate",
          reasoningCell: "minimal",
          activationAttempted: true,
          latency: {
            version: 1,
            activation: { tapToArmCueScheduledMs: 4, tapToLiveMs: 480 },
            turns: [turn],
          },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unbounded turn arrays and timing values", () => {
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          latency: { version: 1, turns: Array.from({ length: 81 }, (_, sequence) => ({ ...turn, sequence })) },
        },
      }).success,
    ).toBe(false);
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          latency: { version: 1, turns: [{ ...turn, stopToFirstOutputEventMs: 120_001 }] },
        },
      }).success,
    ).toBe(false);
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          latency: { version: 1, turns: [{ ...turn, stopToRemoteAudioMs: 120_001 }] },
        },
      }).success,
    ).toBe(false);
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          latency: { version: 1, turns: [{ ...turn, toolDurationMs: 120_001 }] },
        },
      }).success,
    ).toBe(false);
  });
});
