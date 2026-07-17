import { createHmac, timingSafeEqual } from "node:crypto";
import { readEnv } from "../env";
import { type EvalTranscriptTurn, resolveLatestEmailCorrection } from "../eval/voice-eval";
import {
  type VerifiedVoiceSubmissionEvidence,
  VOICE_SUBMISSION_EVIDENCE_UTM_KEY,
  type VoiceSubmissionEvidenceOutcome,
  type VoiceSubmissionEvidenceSource,
} from "../voice/submission-evidence";

type SubmissionEvidenceInput = {
  acceptedAt: number;
  authorityTurnSequence: number;
  email: string;
  leadId: string;
  reviewId: string;
  sessionId: string;
  source: VoiceSubmissionEvidenceSource;
  transcript: EvalTranscriptTurn[];
};

export type ImmutableVoiceLeadEvidenceSource = {
  createdAt?: unknown;
  email?: unknown;
  leadId?: unknown;
  transcript?: unknown;
  utm?: unknown;
  voiceReviewId?: unknown;
  voiceSessionId?: unknown;
};

type WireEnvelope = { v: 1; a: number; s: "p" | "s" | "t"; t: number; c: "n" | "m" | "x" | "a"; h: string };

const SOURCE_TO_WIRE = { prefill: "p", speech: "s", typed: "t" } as const;
const WIRE_TO_SOURCE = { p: "prefill", s: "speech", t: "typed" } as const;
const OUTCOME_TO_WIRE = { none: "n", matched: "m", mismatched: "x", ambiguous: "a" } as const;
const WIRE_TO_OUTCOME = { n: "none", m: "matched", x: "mismatched", a: "ambiguous" } as const;

export function createVoiceSubmissionEvidence(
  input: SubmissionEvidenceInput,
  secret = voiceSubmissionEvidenceSecret(),
): string | null {
  if (!secret || !isValidEvidenceInput(input)) return null;
  const outcome = deriveSubmissionOutcome(input.transcript, input.email, input.authorityTurnSequence);
  const envelopeWithoutSignature = {
    v: 1 as const,
    a: input.acceptedAt,
    s: SOURCE_TO_WIRE[input.source],
    t: input.authorityTurnSequence,
    c: OUTCOME_TO_WIRE[outcome],
  };
  const h = signEvidence(input, outcome, secret);
  return JSON.stringify({ ...envelopeWithoutSignature, h } satisfies WireEnvelope);
}

export function verifyVoiceSubmissionEvidence(
  lead: ImmutableVoiceLeadEvidenceSource,
  secret = voiceSubmissionEvidenceSecret(),
): VerifiedVoiceSubmissionEvidence | null {
  if (!secret || !isRecord(lead.utm)) return null;
  const raw = lead.utm[VOICE_SUBMISSION_EVIDENCE_UTM_KEY];
  if (typeof raw !== "string") return null;
  const envelope = parseWireEnvelope(raw);
  const transcript = parseTranscript(lead.transcript);
  if (
    !envelope ||
    !transcript ||
    typeof lead.leadId !== "string" ||
    typeof lead.voiceReviewId !== "string" ||
    typeof lead.voiceSessionId !== "string" ||
    typeof lead.email !== "string"
  ) {
    return null;
  }
  const source = WIRE_TO_SOURCE[envelope.s];
  const claimedOutcome = WIRE_TO_OUTCOME[envelope.c];
  const input: SubmissionEvidenceInput = {
    acceptedAt: envelope.a,
    authorityTurnSequence: envelope.t,
    email: lead.email,
    leadId: lead.leadId,
    reviewId: lead.voiceReviewId,
    sessionId: lead.voiceSessionId,
    source,
    transcript,
  };
  if (!isValidEvidenceInput(input)) return null;
  const actualOutcome = deriveSubmissionOutcome(transcript, lead.email, envelope.t);
  if (actualOutcome !== claimedOutcome) return null;
  const expected = signEvidence(input, actualOutcome, secret);
  if (!safeEqual(envelope.h, expected)) return null;
  return {
    acceptedAt: envelope.a,
    authorityTurnSequence: envelope.t,
    outcome: actualOutcome,
    provenance: "v1",
    source,
  };
}

export function deriveLegacyVoiceSubmissionEvidence(
  lead: ImmutableVoiceLeadEvidenceSource,
): VerifiedVoiceSubmissionEvidence | null {
  const transcript = parseTranscript(lead.transcript);
  if (!transcript || typeof lead.email !== "string" || typeof lead.createdAt !== "number") return null;
  return {
    acceptedAt: lead.createdAt,
    authorityTurnSequence: transcript.filter((turn) => turn.role === "user").length,
    outcome: deriveSubmissionOutcome(transcript, lead.email, 0),
    provenance: "legacy-lead-snapshot",
  };
}

export function hasVoiceSubmissionEvidenceEnvelope(lead: ImmutableVoiceLeadEvidenceSource) {
  return isRecord(lead.utm) && typeof lead.utm[VOICE_SUBMISSION_EVIDENCE_UTM_KEY] === "string";
}

function deriveSubmissionOutcome(
  transcript: EvalTranscriptTurn[],
  email: string,
  authorityTurnSequence: number,
): VoiceSubmissionEvidenceOutcome {
  // Authority sequence N means the field became authoritative after N user
  // turns. Only later user turns can supersede it; earlier corrections are
  // already incorporated in the typed/prefill/speech value being submitted.
  const laterUserTurns = transcript.filter((turn) => turn.role === "user").slice(authorityTurnSequence);
  const correction = resolveLatestEmailCorrection(laterUserTurns);
  if (correction.kind === "none") return "none";
  if (correction.kind === "ambiguous") return "ambiguous";
  return correction.email === normalizeEmail(email) ? "matched" : "mismatched";
}

function signEvidence(input: SubmissionEvidenceInput, outcome: VoiceSubmissionEvidenceOutcome, secret: string) {
  const payload = JSON.stringify({
    domain: "mereka.voice.submission.v1",
    acceptedAt: input.acceptedAt,
    authorityTurnSequence: input.authorityTurnSequence,
    email: normalizeEmail(input.email),
    leadId: input.leadId,
    outcome,
    reviewId: input.reviewId,
    sessionId: input.sessionId,
    source: input.source,
    transcript: input.transcript.map((turn) => ({ role: turn.role, text: turn.text })),
  });
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isValidEvidenceInput(input: SubmissionEvidenceInput) {
  const userTurns = input.transcript.filter((turn) => turn.role === "user").length;
  return (
    Number.isSafeInteger(input.acceptedAt) &&
    input.acceptedAt > 0 &&
    Number.isSafeInteger(input.authorityTurnSequence) &&
    input.authorityTurnSequence >= 0 &&
    input.authorityTurnSequence <= userTurns &&
    input.leadId.length > 0 &&
    input.reviewId.length > 0 &&
    input.sessionId.length > 0 &&
    normalizeEmail(input.email).length > 0
  );
}

function parseWireEnvelope(raw: string): WireEnvelope | null {
  try {
    const value = JSON.parse(raw) as Partial<WireEnvelope>;
    if (
      value.v !== 1 ||
      !Number.isSafeInteger(value.a) ||
      (value.a ?? 0) <= 0 ||
      (value.s !== "p" && value.s !== "s" && value.s !== "t") ||
      !Number.isSafeInteger(value.t) ||
      (value.t ?? -1) < 0 ||
      (value.c !== "n" && value.c !== "m" && value.c !== "x" && value.c !== "a") ||
      typeof value.h !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.h)
    ) {
      return null;
    }
    return value as WireEnvelope;
  } catch {
    return null;
  }
}

function parseTranscript(value: unknown): EvalTranscriptTurn[] | null {
  if (!Array.isArray(value)) return null;
  const transcript: EvalTranscriptTurn[] = [];
  for (const turn of value) {
    if (!isRecord(turn) || (turn.role !== "user" && turn.role !== "assistant" && turn.role !== "system")) return null;
    if (typeof turn.text !== "string" || !turn.text.trim()) return null;
    transcript.push({ role: turn.role, text: turn.text });
  }
  return transcript;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function voiceSubmissionEvidenceSecret() {
  return readEnv("IP_HASH_SECRET") ?? readEnv("ADMIN_REVIEW_TOKEN");
}
