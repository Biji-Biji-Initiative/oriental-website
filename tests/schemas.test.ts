import { describe, expect, it } from "vitest";
import {
  adminLeadArchiveSchema,
  adminLeadBulkAssignmentSchema,
  adminLeadWorkflowSchema,
  adminLoginSchema,
  leadRequestSchema,
  voiceReviewSnapshotSchema,
} from "@/lib/schemas";

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
      voiceEmailVerified: true,
      voiceEmailVerificationSource: "speech",
      entryPoint: "hero_primary",
      entryMethod: "voice_button",
      submissionMethod: "voice_command",
      fieldProvenance: Object.fromEntries(
        ["name", "email", "org", "phone", "website", "message"].map((field) => [
          field,
          {
            method: field === "email" ? "voice" : "unknown",
            lastInput: field === "email" ? "voice" : undefined,
            editCount: field === "email" ? 1 : 0,
            correctionCount: 0,
            clearCount: 0,
          },
        ]),
      ),
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

  it("rejects unbounded intake attribution categories and counters", () => {
    const base = {
      source: "form",
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "",
        phone: "",
        website: "",
        message: "",
      },
    };
    expect(leadRequestSchema.safeParse({ ...base, entryPoint: "free-form-page-copy" }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, entryMethod: "free-form-method" }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, submissionMethod: "mystery" }).success).toBe(false);
  });

  it("rejects source and submission-method combinations that cannot occur", () => {
    const base = {
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "",
        phone: "",
        website: "",
        message: "",
      },
    };

    expect(leadRequestSchema.safeParse({ ...base, source: "form", submissionMethod: "voice_command" }).success).toBe(
      false,
    );
    expect(
      leadRequestSchema.safeParse({ ...base, source: "voice", submissionMethod: "email_capture_button" }).success,
    ).toBe(false);
    expect(
      leadRequestSchema.safeParse({ ...base, source: "form", submissionMethod: "email_capture_button" }).success,
    ).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, source: "form", submissionMethod: "handoff_button" }).success).toBe(
      true,
    );
    expect(
      leadRequestSchema.safeParse({
        ...base,
        source: "voice",
        submissionMethod: "voice_command",
        voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
        voiceReviewToken: "signed-review-linkage-token",
      }).success,
    ).toBe(true);
  });

  it("rejects a voice command without both review credentials", () => {
    const base = {
      source: "voice",
      submissionMethod: "voice_command",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "",
        phone: "",
        website: "",
        message: "",
      },
    };

    expect(leadRequestSchema.safeParse(base).success).toBe(false);
    expect(
      leadRequestSchema.safeParse({
        ...base,
        voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
      }).success,
    ).toBe(false);
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
  it("accepts the minimum governed token length", () => {
    expect(adminLoginSchema.safeParse({ token: "token-1234" }).success).toBe(true);
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
      nextActionAt: Date.now() + 60 * 60 * 1000,
      nextActionNote: "  Confirm the programme brief.  ",
      expectedRevision: 0,
      reason: "  Assigned during intake review.  ",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.owner).toBe("Gurpreet");
      expect(parsed.data.note).toBe("WhatsApp intro sent.");
      expect(parsed.data.nextActionNote).toBe("Confirm the programme brief.");
      expect(parsed.data.reason).toBe("Assigned during intake review.");
    }
  });

  it("rejects unknown workflow states", () => {
    expect(
      adminLeadWorkflowSchema.safeParse({
        status: "done",
        priority: "normal",
        owner: "Gurpreet",
        nextActionAt: Date.now() + 60_000,
        nextActionNote: "Call back",
        expectedRevision: 0,
        reason: "Pipeline update",
      }).success,
    ).toBe(false);
  });

  it("requires ownership and a concrete dated action for active enquiries", () => {
    const parsed = adminLeadWorkflowSchema.safeParse({
      status: "reviewing",
      priority: "normal",
      owner: "",
      nextActionAt: null,
      nextActionNote: "",
      expectedRevision: 0,
      reason: "Intake review",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.owner).toContain("Active enquiries need one accountable owner.");
      expect(parsed.error.flatten().fieldErrors.nextActionAt).toContain("Active enquiries need a dated next action.");
      expect(parsed.error.flatten().fieldErrors.nextActionNote).toContain(
        "Describe the next action so the owner knows what to do.",
      );
    }
  });

  it("rejects archive transitions from the ordinary workflow endpoint", () => {
    expect(
      adminLeadWorkflowSchema.safeParse({
        status: "archived",
        priority: "normal",
        owner: "Gurpreet",
        nextActionAt: null,
        nextActionNote: "",
        outcomeReason: "Duplicate",
        expectedRevision: 2,
        reason: "Close duplicate",
      }).success,
    ).toBe(false);
  });

  it("requires an outcome reason when qualifying an enquiry", () => {
    const parsed = adminLeadWorkflowSchema.safeParse({
      status: "qualified",
      priority: "normal",
      owner: "Gurpreet",
      nextActionAt: null,
      nextActionNote: "",
      outcomeReason: "",
      expectedRevision: 2,
      reason: "Qualified after review",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.outcomeReason).toContain(
        "Qualified and archived enquiries need an outcome reason.",
      );
    }
  });
});

describe("admin lead archive schema", () => {
  it("accepts a revision-checked restore with an audit reason", () => {
    expect(
      adminLeadArchiveSchema.safeParse({
        action: "restore",
        leads: [
          { leadId: "lead_1", expectedRevision: 2 },
          { leadId: "lead_2", expectedRevision: 7 },
        ],
        reason: "New customer context received",
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate records and missing reasons", () => {
    const duplicateLeads = [
      { leadId: "lead_1", expectedRevision: 2 },
      { leadId: "lead_1", expectedRevision: 2 },
    ];
    expect(
      adminLeadArchiveSchema.safeParse({ action: "archive", leads: duplicateLeads, reason: "Duplicate" }).success,
    ).toBe(false);
    expect(
      adminLeadArchiveSchema.safeParse({
        action: "archive",
        leads: [{ leadId: "lead_1", expectedRevision: 2 }],
        reason: "",
      }).success,
    ).toBe(false);
  });
});

describe("admin bulk assignment schema", () => {
  it("accepts a bounded, deduplicated assignment batch", () => {
    expect(
      adminLeadBulkAssignmentSchema.safeParse({
        leads: [
          { leadId: "lead_1", expectedRevision: 0 },
          { leadId: "lead_2", expectedRevision: 2 },
        ],
        owner: "Nadia",
        nextActionAt: Date.now() + 60 * 60 * 1000,
        nextActionNote: "Send tailored introductions",
        reason: "Morning intake allocation",
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate records and unknown owners", () => {
    expect(
      adminLeadBulkAssignmentSchema.safeParse({
        leads: [
          { leadId: "lead_1", expectedRevision: 0 },
          { leadId: "lead_1", expectedRevision: 0 },
        ],
        owner: "Anyone",
        nextActionAt: Date.now() + 60 * 60 * 1000,
        nextActionNote: "Send tailored introductions",
        reason: "Morning intake allocation",
      }).success,
    ).toBe(false);
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
        },
      }).success,
    ).toBe(true);
  });

  it("accepts canonical clear_fields telemetry and rejects invented aliases", () => {
    const snapshot = (name: string) => ({
      ...request,
      snapshot: {
        ...request.snapshot,
        latency: {
          version: 1,
          turns: [turn],
          toolCalls: [{ name, outcome: "success", executionMs: 7 }],
        },
      },
    });

    expect(voiceReviewSnapshotSchema.safeParse(snapshot("clear_fields")).success).toBe(true);
    expect(voiceReviewSnapshotSchema.safeParse(snapshot("clear_all")).success).toBe(false);
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
    expect(
      voiceReviewSnapshotSchema.safeParse({
        ...request,
        snapshot: {
          ...request.snapshot,
          latency: {
            version: 1,
            turns: [turn],
            toolCalls: [{ name: "lookup_oriental", outcome: "success", executionMs: 120_001 }],
          },
        },
      }).success,
    ).toBe(false);
  });
});
