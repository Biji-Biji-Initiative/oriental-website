import { describe, expect, it } from "vitest";
import {
  createVoiceSubmissionEvidence,
  deriveLegacyVoiceSubmissionEvidence,
  verifyVoiceSubmissionEvidence,
} from "@/lib/server/voice-submission-evidence";
import { publicLeadUtm, VOICE_SUBMISSION_EVIDENCE_UTM_KEY } from "@/lib/voice/submission-evidence";

const secret = "submission-evidence-test-secret";
const input = {
  acceptedAt: 1_784_280_000_000,
  authorityTurnSequence: 1,
  email: "new@example.com",
  leadId: "lead-1",
  reviewId: "review-1",
  sessionId: "session-1",
  source: "typed" as const,
  transcript: [
    { role: "user", text: "My email was old@example.com." },
    { role: "user", text: "Actually use new@example.com." },
  ],
};

function immutableLead(envelope: string, overrides: Record<string, unknown> = {}) {
  return {
    leadId: input.leadId,
    voiceReviewId: input.reviewId,
    voiceSessionId: input.sessionId,
    email: input.email,
    transcript: input.transcript,
    createdAt: input.acceptedAt,
    utm: { campaign: "oriental", [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: envelope },
    ...overrides,
  };
}

describe("voice submission evidence", () => {
  it("creates a compact deterministic envelope and verifies only PII-free provenance", () => {
    const first = createVoiceSubmissionEvidence(input, secret);
    const second = createVoiceSubmissionEvidence(input, secret);
    expect(first).toBe(second);
    expect(first?.length).toBeLessThan(180);

    const verified = verifyVoiceSubmissionEvidence(immutableLead(first as string), secret);
    expect(verified).toEqual({
      acceptedAt: input.acceptedAt,
      authorityTurnSequence: 1,
      outcome: "matched",
      provenance: "v1",
      source: "typed",
    });
    expect(JSON.stringify(verified)).not.toContain(input.email);
  });

  it.each([
    ["email", { email: "old@example.com" }],
    ["transcript", { transcript: [{ role: "user", text: "Actually use other@example.com." }] }],
    ["review", { voiceReviewId: "review-2" }],
    ["session", { voiceSessionId: "session-2" }],
  ])("rejects a tampered %s", (_label, overrides) => {
    const envelope = createVoiceSubmissionEvidence(input, secret) as string;
    expect(verifyVoiceSubmissionEvidence(immutableLead(envelope, overrides), secret)).toBeNull();
  });

  it("rejects malformed and unknown envelopes instead of falling back to legacy", () => {
    expect(
      verifyVoiceSubmissionEvidence(
        immutableLead(JSON.stringify({ v: 2, a: input.acceptedAt, s: "t", t: 1, c: "m", h: "x".repeat(43) })),
        secret,
      ),
    ).toBeNull();
  });

  it("records direct typed-field authority even without a transcript correction", () => {
    const direct = { ...input, authorityTurnSequence: 0, transcript: [] };
    const envelope = createVoiceSubmissionEvidence(direct, secret) as string;
    expect(verifyVoiceSubmissionEvidence(immutableLead(envelope, { transcript: [] }), secret)).toMatchObject({
      outcome: "none",
      source: "typed",
      authorityTurnSequence: 0,
    });
  });

  it("ignores corrections already incorporated by a later typed-field edit", () => {
    const typedAfterCorrection = {
      ...input,
      authorityTurnSequence: 1,
      email: "typed@example.com",
      transcript: [{ role: "user", text: "Actually use spoken@example.com." }],
    };
    const envelope = createVoiceSubmissionEvidence(typedAfterCorrection, secret) as string;
    expect(
      verifyVoiceSubmissionEvidence(
        immutableLead(envelope, {
          email: typedAfterCorrection.email,
          transcript: typedAfterCorrection.transcript,
        }),
        secret,
      ),
    ).toMatchObject({
      outcome: "none",
      source: "typed",
      authorityTurnSequence: 1,
    });
  });

  it("retains an immutable legacy lead snapshot without pretending it is v1", () => {
    expect(
      deriveLegacyVoiceSubmissionEvidence({
        email: "old@example.com",
        transcript: [{ role: "user", text: "Actually use new@example.com." }],
        createdAt: 123,
      }),
    ).toEqual({
      acceptedAt: 123,
      authorityTurnSequence: 1,
      outcome: "mismatched",
      provenance: "legacy-lead-snapshot",
    });
  });

  it("removes the reserved envelope from acquisition metadata", () => {
    expect(publicLeadUtm({ campaign: "oriental", [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "private-envelope" })).toEqual({
      campaign: "oriental",
    });
  });
});
