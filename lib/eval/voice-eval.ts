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

export type EvalLatency = {
  version: 1;
  activation?: { tapToArmCueScheduledMs?: number };
  turns: Array<{
    sequence: number;
    inputPolicy: "baseline" | "fast" | "patient";
    speechDurationMs?: number;
    stopToResponseCreatedMs?: number;
    stopToFirstOutputEventMs?: number;
    localSpeechEndToSpeechStoppedMs?: number;
    stopToRemoteAudioMs?: number;
    firstOutputEventToRemoteAudioMs?: number;
    toolDurationMs?: number;
    bargeInToResponseDoneMs?: number;
    responseDurationMs?: number;
    interrupted: boolean;
    rapidResume: boolean;
  }>;
} | null;

export type VoiceEvalSession = {
  reviewId: string;
  sessionId: string;
  conversationId?: string | null;
  segment: string;
  status: string;
  connectionStatus: string;
  closeReason?: string | null;
  leadId?: string | null;
  connectStartedAt?: number | null;
  connectedAt?: number | null;
  firstEventAt?: number | null;
  closedAt?: number | null;
  runtimeProfile?: "baseline" | "instant-v1" | null;
  inputPolicy?: "baseline" | "fast" | "patient" | null;
  modelCell?: "control" | "candidate" | null;
  reasoningCell?: "low" | "minimal" | null;
  transcript: EvalTranscriptTurn[];
  errors: Array<{ code?: string; message: string }>;
  transport?: EvalTransport;
  latency?: EvalLatency;
  routeRequested: boolean;
  submittedAt?: number | null;
  /** Review ids of the call segments folded into this conversation (if merged). */
  callReviewIds?: string[];
};

// ---------------------------------------------------------------------------
// Conversation stitching — collapse many call rows into one conversation
// ---------------------------------------------------------------------------

/** Abnormal closes that indicate the visitor did not end the call cleanly. */
const ABNORMAL_CLOSE_REASONS = new Set(["disconnected", "webrtc_failed", "error", "page_hidden"]);

function callStartAt(session: VoiceEvalSession): number {
  return session.connectStartedAt ?? session.connectedAt ?? session.firstEventAt ?? 0;
}

/**
 * Union the transcripts of a conversation's call segments in chronological
 * order, dropping exact duplicate turns. Same-dialog reconnects accumulate the
 * full transcript on each row (later rows are supersets); reopen-after-close
 * rows are disjoint. Order-preserving dedup yields the correct single thread in
 * both cases.
 */
export function mergeConversationTranscripts(ordered: VoiceEvalSession[]): EvalTranscriptTurn[] {
  const seen = new Set<string>();
  const merged: EvalTranscriptTurn[] = [];
  for (const session of ordered) {
    for (const turn of session.transcript) {
      const key = `${turn.role}::${turn.text.trim()}`;
      if (turn.text.trim().length > 0 && seen.has(key)) continue;
      if (turn.text.trim().length > 0) seen.add(key);
      merged.push(turn);
    }
  }
  return merged;
}

/**
 * Group call rows by `conversationId` (falling back to `reviewId` for legacy
 * rows without one) and fold each group into a single logical conversation, so
 * a dropped-and-resumed intake reads as one conversation rather than many.
 */
export function mergeConversationSessions(sessions: VoiceEvalSession[]): VoiceEvalSession[] {
  const groups = new Map<string, VoiceEvalSession[]>();
  for (const session of sessions) {
    const key = session.conversationId ?? session.reviewId;
    const existing = groups.get(key);
    if (existing) existing.push(session);
    else groups.set(key, [session]);
  }

  const merged: VoiceEvalSession[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0] as VoiceEvalSession);
      continue;
    }
    const ordered = [...group].sort((a, b) => callStartAt(a) - callStartAt(b));
    const head = ordered[ordered.length - 1] as VoiceEvalSession;
    const submitted = ordered.find((s) => Boolean(s.submittedAt) || Boolean(s.leadId));
    const transport = ordered.reduce<EvalTransport>((acc, s) => foldEvalTransport(acc, s.transport ?? null), null);
    const latency = foldEvalLatency(ordered.map((session) => session.latency ?? null));
    merged.push({
      ...head,
      // The latest call row heads the conversation, but timings and outcome span
      // every segment.
      conversationId: head.conversationId ?? head.reviewId,
      connectStartedAt: min(ordered.map(callStartAt)),
      connectedAt: min(ordered.map((s) => s.connectedAt).filter(isNumber)),
      firstEventAt: min(ordered.map((s) => s.firstEventAt).filter(isNumber)),
      closedAt: max(ordered.map((s) => s.closedAt).filter(isNumber)),
      submittedAt: submitted?.submittedAt ?? head.submittedAt ?? null,
      leadId: submitted?.leadId ?? head.leadId ?? null,
      transcript: mergeConversationTranscripts(ordered),
      errors: ordered.flatMap((s) => s.errors),
      transport,
      latency,
      routeRequested: ordered.some((s) => s.routeRequested),
      callReviewIds: ordered.map((s) => s.reviewId),
    });
  }
  return merged;
}

function foldEvalLatency(latencies: EvalLatency[]): EvalLatency {
  const turns = latencies.flatMap((latency) => latency?.turns ?? []);
  const activation = latencies.find((latency) => latency?.activation)?.activation;
  return turns.length > 0 || activation ? { version: 1, ...(activation ? { activation } : {}), turns } : null;
}

function foldEvalTransport(acc: EvalTransport, next: EvalTransport): EvalTransport {
  if (!next) return acc;
  if (!acc) return next;
  return {
    disconnectCount: acc.disconnectCount + next.disconnectCount,
    recoveryCount: acc.recoveryCount + next.recoveryCount,
    iceRestartCount: acc.iceRestartCount + next.iceRestartCount,
    wasSpeakingAtClose: next.wasSpeakingAtClose ?? acc.wasSpeakingAtClose,
    worstStats: {
      packetsLostPct: maxOrNull(acc.worstStats?.packetsLostPct, next.worstStats?.packetsLostPct),
      maxJitterMs: maxOrNull(acc.worstStats?.maxJitterMs, next.worstStats?.maxJitterMs),
      maxRttMs: maxOrNull(acc.worstStats?.maxRttMs, next.worstStats?.maxRttMs),
    },
  };
}

const isNumber = (value: number | null | undefined): value is number => typeof value === "number";
const min = (values: number[]): number | null => (values.length === 0 ? null : Math.min(...values));
const max = (values: number[]): number | null => (values.length === 0 ? null : Math.max(...values));
const maxOrNull = (a: number | undefined, b: number | undefined): number | undefined => {
  if (typeof a !== "number") return b;
  if (typeof b !== "number") return a;
  return Math.max(a, b);
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
    droppedMidTurn: ABNORMAL_CLOSE_REASONS.has(session.closeReason ?? "") && transport?.wasSpeakingAtClose === true,
    hadDisconnect: disconnects > 0,
    recoveredAfterDisconnect: disconnects > 0 && recoveries >= disconnects,
    worstPacketsLostPct: transport?.worstStats?.packetsLostPct ?? null,
    worstRttMs: transport?.worstStats?.maxRttMs ?? null,
  };
}

export type LatencySignals = {
  sampledTurns: number;
  firstOutputSamples: number;
  firstOutputP50Ms: number | null;
  firstOutputP95Ms: number | null;
  responseCreatedSamples: number;
  responseCreatedP50Ms: number | null;
  responseCreatedP95Ms: number | null;
  remoteAudioSamples: number;
  remoteAudioP50Ms: number | null;
  remoteAudioP95Ms: number | null;
  endpointP50Ms: number | null;
  endpointP95Ms: number | null;
  playoutP50Ms: number | null;
  playoutP95Ms: number | null;
  toolP50Ms: number | null;
  toolP95Ms: number | null;
  bargeInP95Ms: number | null;
  tapToArmCueMs: number | null;
  interruptedTurns: number;
  rapidResumeTurns: number;
};

export function deriveLatencySignals(session: VoiceEvalSession): LatencySignals {
  const turns = session.latency?.turns ?? [];
  const firstOutput = turns.flatMap((turn) =>
    typeof turn.stopToFirstOutputEventMs === "number" ? [turn.stopToFirstOutputEventMs] : [],
  );
  const responseCreated = turns.flatMap((turn) =>
    typeof turn.stopToResponseCreatedMs === "number" ? [turn.stopToResponseCreatedMs] : [],
  );
  const remoteAudio = turns.flatMap((turn) =>
    typeof turn.stopToRemoteAudioMs === "number" ? [turn.stopToRemoteAudioMs] : [],
  );
  const endpoint = turns.flatMap((turn) =>
    typeof turn.localSpeechEndToSpeechStoppedMs === "number" ? [turn.localSpeechEndToSpeechStoppedMs] : [],
  );
  const playout = turns.flatMap((turn) =>
    typeof turn.firstOutputEventToRemoteAudioMs === "number" ? [turn.firstOutputEventToRemoteAudioMs] : [],
  );
  const bargeIn = turns.flatMap((turn) =>
    typeof turn.bargeInToResponseDoneMs === "number" ? [turn.bargeInToResponseDoneMs] : [],
  );
  const tool = turns.flatMap((turn) => (typeof turn.toolDurationMs === "number" ? [turn.toolDurationMs] : []));
  return {
    sampledTurns: turns.length,
    firstOutputSamples: firstOutput.length,
    firstOutputP50Ms: percentile(firstOutput, 0.5),
    firstOutputP95Ms: percentile(firstOutput, 0.95),
    responseCreatedSamples: responseCreated.length,
    responseCreatedP50Ms: percentile(responseCreated, 0.5),
    responseCreatedP95Ms: percentile(responseCreated, 0.95),
    remoteAudioSamples: remoteAudio.length,
    remoteAudioP50Ms: percentile(remoteAudio, 0.5),
    remoteAudioP95Ms: percentile(remoteAudio, 0.95),
    endpointP50Ms: percentile(endpoint, 0.5),
    endpointP95Ms: percentile(endpoint, 0.95),
    playoutP50Ms: percentile(playout, 0.5),
    playoutP95Ms: percentile(playout, 0.95),
    toolP50Ms: percentile(tool, 0.5),
    toolP95Ms: percentile(tool, 0.95),
    bargeInP95Ms: percentile(bargeIn, 0.95),
    tapToArmCueMs: session.latency?.activation?.tapToArmCueScheduledMs ?? null,
    interruptedTurns: turns.filter((turn) => turn.interrupted).length,
    rapidResumeTurns: turns.filter((turn) => turn.rapidResume).length,
  };
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(Math.max(Math.ceil(sorted.length * quantile) - 1, 0), sorted.length - 1);
  return Math.round(sorted[index] ?? 0);
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
  conversationId: string | null;
  callCount: number;
  segment: string;
  closeReason: string | null;
  runtimeProfile: "baseline" | "instant-v1";
  inputPolicy: "baseline" | "fast" | "patient";
  modelCell: "control" | "candidate";
  reasoningCell: "low" | "minimal";
  transport: TransportSignals;
  latency: LatencySignals;
  engagement: EngagementSignals;
  score: JudgeScore | null;
};

export function buildSessionEval(session: VoiceEvalSession, score: JudgeScore | null): SessionEval {
  return {
    reviewId: session.reviewId,
    conversationId: session.conversationId ?? null,
    callCount: session.callReviewIds?.length ?? 1,
    segment: session.segment,
    closeReason: session.closeReason ?? null,
    runtimeProfile: session.runtimeProfile ?? "baseline",
    inputPolicy: session.inputPolicy ?? "baseline",
    modelCell: session.modelCell ?? "control",
    reasoningCell: session.reasoningCell ?? "low",
    transport: deriveTransportSignals(session),
    latency: deriveLatencySignals(session),
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

export function aggregateEvalsByRuntimeProfile(evals: SessionEval[]): Record<string, EvalAggregate> {
  const groups = new Map<string, SessionEval[]>();
  for (const entry of evals) {
    const group = groups.get(entry.runtimeProfile);
    if (group) group.push(entry);
    else groups.set(entry.runtimeProfile, [entry]);
  }
  return Object.fromEntries([...groups.entries()].map(([profile, entries]) => [profile, aggregateEvals(entries)]));
}

export function aggregateEvalsByExperimentCell(evals: SessionEval[]): Record<string, EvalAggregate> {
  const groups = new Map<string, SessionEval[]>();
  for (const entry of evals) {
    const key = `${entry.modelCell}/${entry.reasoningCell}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return Object.fromEntries([...groups.entries()].map(([cell, entries]) => [cell, aggregateEvals(entries)]));
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
