import { describe, expect, it } from "vitest";
import {
  isEngagedVoiceCaptureSession,
  summarizeVoiceCaptureFunnel,
  type VoiceCaptureSession,
} from "@/lib/voice-capture-analytics";

const emptyCaptured = { name: "", email: "", org: "", phone: "", website: "", message: "" };

function session(overrides: Partial<VoiceCaptureSession> = {}): VoiceCaptureSession {
  return {
    reviewId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    status: "idle",
    routeRequested: false,
    captured: { ...emptyCaptured },
    transcript: [],
    errors: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("voice capture funnel analytics", () => {
  it("excludes unused prewarms but keeps failed activations and typed fallback activity", () => {
    const prewarm = session();
    const failedActivation = session({ activationAttempted: true });
    const typedFallback = session({
      captured: { ...emptyCaptured, message: "Interested in a workshop" },
      fieldProvenance: { message: { method: "chat", correctionCount: 0, clearCount: 0 } },
    });

    expect(isEngagedVoiceCaptureSession(prewarm)).toBe(false);
    expect(isEngagedVoiceCaptureSession(failedActivation)).toBe(true);
    expect(isEngagedVoiceCaptureSession(typedFallback)).toBe(true);

    const funnel = summarizeVoiceCaptureFunnel([prewarm, failedActivation, typedFallback], 100);
    expect(funnel.cohort).toMatchObject({
      loadedSessionRows: 3,
      engagedSessionRows: 2,
      logicalConversations: 2,
      unstitchedConversations: 2,
      foldedReconnectRows: 0,
      windowMayBeTruncated: false,
    });
    expect(funnel.fields.message).toMatchObject({
      completedConversations: 1,
      missingConversations: 1,
      methodCounts: { chat: 1 },
    });
  });

  it("folds reconnect snapshots and uses the final fields with maximum observed edit counters", () => {
    const conversationId = crypto.randomUUID();
    const firstCall = session({
      conversationId,
      activationAttempted: true,
      entryPoint: "hero_primary",
      entryMethod: "voice_button",
      captured: { ...emptyCaptured, email: "first@example.test", message: "A workshop" },
      fieldProvenance: {
        email: { method: "voice", correctionCount: 1, clearCount: 0 },
        message: { method: "voice", correctionCount: 0, clearCount: 0 },
      },
      emailVerification: { status: "pending", matchesCaptured: true },
      errors: [{ code: "voice_capture_rejected_email", message: "Realtime error (voice_capture_rejected_email)" }],
      closedAt: 150,
      updatedAt: 150,
    });
    const resumedCall = session({
      conversationId,
      activationAttempted: true,
      entryPoint: "hero_primary",
      entryMethod: "voice_button",
      captured: { ...emptyCaptured, email: "corrected@example.test", message: "A workshop" },
      fieldProvenance: {
        email: { method: "mixed", correctionCount: 2, clearCount: 1 },
        message: { method: "voice", correctionCount: 0, clearCount: 0 },
      },
      emailVerification: { status: "confirmed", matchesCaptured: true },
      closedAt: 250,
      updatedAt: 250,
    });

    const funnel = summarizeVoiceCaptureFunnel([resumedCall, firstCall], 100);

    expect(funnel.cohort).toMatchObject({
      engagedSessionRows: 2,
      logicalConversations: 1,
      stitchedConversations: 1,
      foldedReconnectRows: 1,
    });
    expect(funnel.entryMethodCounts).toEqual({ voice_button: 1 });
    expect(funnel.email.outcomes).toEqual({ confirmed: 1, pending: 0, unverified: 0, missing: 0 });
    expect(funnel.email.signals).toMatchObject({ rejectedCapture: 1, recoverableConfirmed: 1 });
    expect(funnel.fields.email).toEqual({
      completedConversations: 1,
      missingConversations: 0,
      methodCounts: { mixed: 1 },
      correctedConversations: 1,
      correctionActions: 2,
      clearedConversations: 1,
      clearActions: 1,
    });
  });

  it("separates submitted leads, pending recovery, and closed abandonment without exposing field values", () => {
    const submitted = session({
      conversationId: crypto.randomUUID(),
      leadId: "lead_1",
      status: "submitted",
      submittedAt: 300,
      submissionMethod: "voice_command",
      captured: { ...emptyCaptured, email: "submitted@example.test" },
      fieldProvenance: { email: { method: "voice", correctionCount: 0, clearCount: 0 } },
      emailVerification: { status: "confirmed", matchesCaptured: true },
      closedAt: 310,
      updatedAt: 310,
    });
    const needsCheck = session({
      conversationId: crypto.randomUUID(),
      activationAttempted: true,
      captured: { ...emptyCaptured, email: "draft@example.test" },
      fieldProvenance: { email: { method: "voice", correctionCount: 1, clearCount: 0 } },
      emailVerification: { status: "pending", matchesCaptured: true },
      errors: [
        { code: "voice_capture_rejected", message: "capture_fields:invalid_email:email" },
        { code: "voice_email_unconfirmed", message: "Realtime error (voice_email_unconfirmed)" },
      ],
      closedAt: 400,
      updatedAt: 400,
    });
    const abandoned = session({ activationAttempted: true, closedAt: 500, updatedAt: 500 });
    const stillOpen = session({ activationAttempted: true, updatedAt: 600 });

    const funnel = summarizeVoiceCaptureFunnel([submitted, needsCheck, abandoned, stillOpen], 4);

    expect(funnel.submissionMethodCounts).toEqual({ voice_command: 1 });
    expect(funnel.outcome).toEqual({
      submitted: 1,
      closedUnsubmitted: 2,
      openUnsubmitted: 1,
      abandonedBeforeEmail: 1,
      closedWithEmailUnsent: 1,
    });
    expect(funnel.email.outcomes).toEqual({ confirmed: 1, pending: 1, unverified: 0, missing: 2 });
    expect(funnel.email.signals).toEqual({
      rejectedCapture: 1,
      submitBlockedUnconfirmed: 1,
      recoverableConfirmed: 0,
      needsCheckBeforeFollowUp: 1,
    });
    expect(funnel.cohort.windowMayBeTruncated).toBe(true);
    expect(JSON.stringify(funnel)).not.toContain("@example.test");
  });
});
