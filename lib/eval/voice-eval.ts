/**
 * Pure evaluation logic for the voice-session corpus.
 *
 * Every Reka session persists a transcript, outcome, close reason, token usage,
 * errors, and (now) WebRTC transport telemetry to Convex. This module turns that
 * corpus into scored evals so each issue feeds a measurable improvement loop:
 *
 *  - Deterministic signals derived from the data alone (no model): whether the
 *    call dropped mid-utterance, disconnect/recovery counts, packet loss, RTT,
 *    engagement, submission.
 *  - An LLM-judge rubric over the transcript for the qualities you can't compute
 *    (routing correctness, capture completeness, conversation quality,
 *    frustration).
 *  - Aggregation + a threshold gate so the harness can run in CI.
 *
 * Everything here is pure and unit-tested. The network side (Convex fetch, LLM
 * call, report writing) lives in `scripts/eval-voice.ts`.
 */

import { z } from "zod";

export type EvalTranscriptTurn = { role: string; text: string };

export type EvalTransport = {
  disconnectCount: number;
  recoveryCount: number;
  iceRestartCount: number;
  wasSpeakingAtClose?: boolean | null;
  worstStats?: { packetsLostPct?: number; maxJitterMs?: number; maxRttMs?: number } | null;
} | null;

export type VoiceEvalSession = {
  reviewId: string;
  sessionId: string;
  segment: string;
  status: string;
  connectionStatus: string;
  closeReason?: string | null;
  leadId?: string | null;
  connectStartedAt?: number | null;
  connectedAt?: number | null;
  firstEventAt?: number | null;
  closedAt?: number | null;
  transcript: EvalTranscriptTurn[];
  errors: Array<{ code?: string; message: string }>;
  transport?: EvalTransport;
  routeRequested: boolean;
  submittedAt?: number | null;
};

// ---------------------------------------------------------------------------
// Deterministic signals (no LLM)
// ---------------------------------------------------------------------------

export type TransportSignals = {
  /** The call dropped while the visitor was speaking — the "can't happen" failure. */
  droppedMidTurn: boolean;
  hadDisconnect: boolean;
  recoveredAfterDisconnect: boolean;
  worstPacketsLostPct: number | null;
  worstRttMs: number | null;
};

export function deriveTransportSignals(session: VoiceEvalSession): TransportSignals {
  const transport = session.transport ?? null;
  const disconnects = transport?.disconnectCount ?? 0;
  const recoveries = transport?.recoveryCount ?? 0;
  return {
    droppedMidTurn: session.closeReason === "disconnected" && transport?.wasSpeakingAtClose === true,
    hadDisconnect: disconnects > 0,
    recoveredAfterDisconnect: disconnects > 0 && recoveries >= disconnects,
    worstPacketsLostPct: transport?.worstStats?.packetsLostPct ?? null,
    worstRttMs: transport?.worstStats?.maxRttMs ?? null,
  };
}

export type EngagementSignals = {
  turnCount: number;
  userTurns: number;
  assistantTurns: number;
  submitted: boolean;
  timeToFirstEventMs: number | null;
  durationMs: number | null;
};

export function deriveEngagementSignals(session: VoiceEvalSession): EngagementSignals {
  const userTurns = session.transcript.filter((turn) => turn.role === "user").length;
  const assistantTurns = session.transcript.filter((turn) => turn.role === "assistant").length;
  const timeToFirstEventMs =
    typeof session.connectStartedAt === "number" && typeof session.firstEventAt === "number"
      ? Math.max(0, session.firstEventAt - session.connectStartedAt)
      : null;
  const durationMs =
    typeof session.connectedAt === "number" && typeof session.closedAt === "number"
      ? Math.max(0, session.closedAt - session.connectedAt)
      : null;
  return {
    turnCount: session.transcript.length,
    userTurns,
    assistantTurns,
    submitted: Boolean(session.submittedAt) || Boolean(session.leadId),
    timeToFirstEventMs,
    durationMs,
  };
}

/** A session is worth judging only if there was a real exchange to score. */
export function isJudgeable(session: VoiceEvalSession): boolean {
  return session.transcript.some((turn) => turn.role === "user" && turn.text.trim().length > 0);
}

// ---------------------------------------------------------------------------
// LLM-judge rubric
// ---------------------------------------------------------------------------

export const judgeScoreSchema = z.object({
  routingCorrect: z.number().min(0).max(5),
  captureCompleteness: z.number().min(0).max(5),
  conversationQuality: z.number().min(0).max(5),
  frustration: z.number().min(0).max(5),
  summary: z.string().max(600),
});

export type JudgeScore = z.infer<typeof judgeScoreSchema>;

export const JUDGE_SYSTEM_PROMPT = [
  "You are a strict QA evaluator for Reka, a Malaysian voice concierge that qualifies partner leads for the Oriental Building and routes them to the right team.",
  "Score one transcript on a 0-5 integer scale per dimension. Be critical; reserve 5 for excellent.",
  "Dimensions:",
  "- routingCorrect: did Reka steer the visitor toward the correct partner segment and capture intent accurately?",
  "- captureCompleteness: were the useful lead details (name, org, email, need) gathered without nagging?",
  "- conversationQuality: natural, concise, on-brand, no hallucinated facts or dead ends.",
  "- frustration: signals the VISITOR was frustrated/confused (0 = none, 5 = clearly frustrated).",
  'Respond with ONLY a JSON object: {"routingCorrect":int,"captureCompleteness":int,"conversationQuality":int,"frustration":int,"summary":"one sentence"}.',
].join("\n");

export function buildJudgeUserPrompt(session: VoiceEvalSession): string {
  const transcript = session.transcript.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`).join("\n");
  const outcome = session.submittedAt || session.leadId ? "lead submitted" : "no lead submitted";
  return [
    `Intended segment: ${session.segment}`,
    `Close reason: ${session.closeReason ?? "n/a"}`,
    `Outcome: ${outcome}`,
    "",
    "Transcript:",
    transcript.length > 0 ? transcript : "(empty)",
  ].join("\n");
}

/** Parse a judge model reply into a validated score, tolerating code fences. */
export function parseJudgeResponse(raw: string): JudgeScore | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  const result = judgeScoreSchema.safeParse(coerceIntegers(parsed));
  return result.success ? result.data : null;
}

function coerceIntegers(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    out[key] = typeof entry === "string" && entry.trim() !== "" && !Number.isNaN(Number(entry)) ? Number(entry) : entry;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-session eval + aggregation
// ---------------------------------------------------------------------------

export type SessionEval = {
  reviewId: string;
  segment: string;
  closeReason: string | null;
  transport: TransportSignals;
  engagement: EngagementSignals;
  score: JudgeScore | null;
};

export function buildSessionEval(session: VoiceEvalSession, score: JudgeScore | null): SessionEval {
  return {
    reviewId: session.reviewId,
    segment: session.segment,
    closeReason: session.closeReason ?? null,
    transport: deriveTransportSignals(session),
    engagement: deriveEngagementSignals(session),
    score,
  };
}

export type EvalAggregate = {
  sessionCount: number;
  scoredCount: number;
  droppedMidTurnCount: number;
  disconnectSessions: number;
  cleanRecoveries: number;
  submitRate: number;
  averages: {
    routingCorrect: number | null;
    captureCompleteness: number | null;
    conversationQuality: number | null;
    frustration: number | null;
  };
  worstSessions: Array<{ reviewId: string; reason: string }>;
};

const round = (value: number) => Math.round(value * 100) / 100;

export function aggregateEvals(evals: SessionEval[]): EvalAggregate {
  const scored = evals.filter((entry) => entry.score !== null);
  const average = (pick: (score: JudgeScore) => number): number | null =>
    scored.length === 0
      ? null
      : round(scored.reduce((sum, entry) => sum + pick(entry.score as JudgeScore), 0) / scored.length);

  const droppedMidTurn = evals.filter((entry) => entry.transport.droppedMidTurn);
  const worstSessions = [
    ...droppedMidTurn.map((entry) => ({ reviewId: entry.reviewId, reason: "dropped mid-utterance" })),
    ...scored
      .filter((entry) => (entry.score as JudgeScore).frustration >= 4)
      .map((entry) => ({ reviewId: entry.reviewId, reason: "high visitor frustration" })),
    ...scored
      .filter((entry) => (entry.score as JudgeScore).conversationQuality <= 2)
      .map((entry) => ({ reviewId: entry.reviewId, reason: "low conversation quality" })),
  ].slice(0, 20);

  return {
    sessionCount: evals.length,
    scoredCount: scored.length,
    droppedMidTurnCount: droppedMidTurn.length,
    disconnectSessions: evals.filter((entry) => entry.transport.hadDisconnect).length,
    cleanRecoveries: evals.filter((entry) => entry.transport.recoveredAfterDisconnect).length,
    submitRate:
      evals.length === 0 ? 0 : round(evals.filter((entry) => entry.engagement.submitted).length / evals.length),
    averages: {
      routingCorrect: average((score) => score.routingCorrect),
      captureCompleteness: average((score) => score.captureCompleteness),
      conversationQuality: average((score) => score.conversationQuality),
      frustration: average((score) => score.frustration),
    },
    worstSessions,
  };
}

export type EvalThresholds = {
  minConversationQuality?: number;
  minRoutingCorrect?: number;
  maxFrustration?: number;
  maxDroppedMidTurn?: number;
};

/** Gate an aggregate against thresholds — used for a CI regression check. */
export function meetsThreshold(
  aggregate: EvalAggregate,
  thresholds: EvalThresholds,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const { averages } = aggregate;
  if (
    typeof thresholds.minConversationQuality === "number" &&
    averages.conversationQuality !== null &&
    averages.conversationQuality < thresholds.minConversationQuality
  ) {
    failures.push(`conversationQuality ${averages.conversationQuality} < ${thresholds.minConversationQuality}`);
  }
  if (
    typeof thresholds.minRoutingCorrect === "number" &&
    averages.routingCorrect !== null &&
    averages.routingCorrect < thresholds.minRoutingCorrect
  ) {
    failures.push(`routingCorrect ${averages.routingCorrect} < ${thresholds.minRoutingCorrect}`);
  }
  if (
    typeof thresholds.maxFrustration === "number" &&
    averages.frustration !== null &&
    averages.frustration > thresholds.maxFrustration
  ) {
    failures.push(`frustration ${averages.frustration} > ${thresholds.maxFrustration}`);
  }
  if (
    typeof thresholds.maxDroppedMidTurn === "number" &&
    aggregate.droppedMidTurnCount > thresholds.maxDroppedMidTurn
  ) {
    failures.push(`droppedMidTurn ${aggregate.droppedMidTurnCount} > ${thresholds.maxDroppedMidTurn}`);
  }
  return { ok: failures.length === 0, failures };
}
