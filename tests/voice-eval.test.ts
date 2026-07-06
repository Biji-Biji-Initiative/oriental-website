import { describe, expect, it } from "vitest";
import {
  aggregateEvals,
  buildJudgeUserPrompt,
  buildSessionEval,
  deriveEngagementSignals,
  deriveTransportSignals,
  isJudgeable,
  meetsThreshold,
  parseJudgeResponse,
  type VoiceEvalSession,
} from "@/lib/eval/voice-eval";

function session(overrides: Partial<VoiceEvalSession> = {}): VoiceEvalSession {
  return {
    reviewId: "r1",
    sessionId: "s1",
    segment: "technology",
    status: "idle",
    connectionStatus: "idle",
    closeReason: "manual",
    transcript: [
      { role: "assistant", text: "Hi, I'm Reka." },
      { role: "user", text: "We build robots." },
    ],
    errors: [],
    routeRequested: false,
    ...overrides,
  };
}

describe("deriveTransportSignals", () => {
  it("flags a drop that happened while the visitor was speaking", () => {
    const signals = deriveTransportSignals(
      session({
        closeReason: "disconnected",
        transport: { disconnectCount: 1, recoveryCount: 0, iceRestartCount: 1, wasSpeakingAtClose: true },
      }),
    );
    expect(signals.droppedMidTurn).toBe(true);
    expect(signals.hadDisconnect).toBe(true);
    expect(signals.recoveredAfterDisconnect).toBe(false);
  });

  it("does not flag a disconnect that recovered", () => {
    const signals = deriveTransportSignals(
      session({
        closeReason: "manual",
        transport: {
          disconnectCount: 2,
          recoveryCount: 2,
          iceRestartCount: 2,
          wasSpeakingAtClose: false,
          worstStats: { packetsLostPct: 4.2, maxRttMs: 120 },
        },
      }),
    );
    expect(signals.droppedMidTurn).toBe(false);
    expect(signals.recoveredAfterDisconnect).toBe(true);
    expect(signals.worstPacketsLostPct).toBe(4.2);
    expect(signals.worstRttMs).toBe(120);
  });

  it("handles sessions with no transport telemetry", () => {
    const signals = deriveTransportSignals(session({ transport: null }));
    expect(signals).toEqual({
      droppedMidTurn: false,
      hadDisconnect: false,
      recoveredAfterDisconnect: false,
      worstPacketsLostPct: null,
      worstRttMs: null,
    });
  });
});

describe("deriveEngagementSignals", () => {
  it("counts turns, submission, and timing", () => {
    const signals = deriveEngagementSignals(
      session({
        submittedAt: 100,
        connectStartedAt: 1000,
        firstEventAt: 1600,
        connectedAt: 1500,
        closedAt: 8000,
      }),
    );
    expect(signals.turnCount).toBe(2);
    expect(signals.userTurns).toBe(1);
    expect(signals.assistantTurns).toBe(1);
    expect(signals.submitted).toBe(true);
    expect(signals.timeToFirstEventMs).toBe(600);
    expect(signals.durationMs).toBe(6500);
  });
});

describe("isJudgeable", () => {
  it("requires a non-empty user turn", () => {
    expect(isJudgeable(session())).toBe(true);
    expect(isJudgeable(session({ transcript: [{ role: "assistant", text: "Hello?" }] }))).toBe(false);
    expect(isJudgeable(session({ transcript: [{ role: "user", text: "   " }] }))).toBe(false);
  });
});

describe("buildJudgeUserPrompt", () => {
  it("includes transcript, segment, and outcome but not raw token usage", () => {
    const prompt = buildJudgeUserPrompt(session({ segment: "cultural", submittedAt: 5 }));
    expect(prompt).toContain("Intended segment: cultural");
    expect(prompt).toContain("lead submitted");
    expect(prompt).toContain("USER: We build robots.");
  });
});

describe("parseJudgeResponse", () => {
  it("parses a clean JSON object", () => {
    const score = parseJudgeResponse(
      '{"routingCorrect":4,"captureCompleteness":3,"conversationQuality":5,"frustration":1,"summary":"good"}',
    );
    expect(score).toEqual({
      routingCorrect: 4,
      captureCompleteness: 3,
      conversationQuality: 5,
      frustration: 1,
      summary: "good",
    });
  });

  it("tolerates code fences and stringified integers", () => {
    const score = parseJudgeResponse(
      '```json\n{"routingCorrect":"4","captureCompleteness":"3","conversationQuality":"4","frustration":"2","summary":"ok"}\n```',
    );
    expect(score?.routingCorrect).toBe(4);
    expect(score?.frustration).toBe(2);
  });

  it("returns null on malformed or out-of-range output", () => {
    expect(parseJudgeResponse("not json")).toBeNull();
    expect(
      parseJudgeResponse(
        '{"routingCorrect":9,"captureCompleteness":3,"conversationQuality":5,"frustration":1,"summary":"x"}',
      ),
    ).toBeNull();
  });
});

describe("aggregateEvals + meetsThreshold", () => {
  const evals = [
    buildSessionEval(
      session({
        reviewId: "a",
        closeReason: "disconnected",
        transport: { disconnectCount: 1, recoveryCount: 0, iceRestartCount: 1, wasSpeakingAtClose: true },
      }),
      { routingCorrect: 4, captureCompleteness: 4, conversationQuality: 4, frustration: 1, summary: "" },
    ),
    buildSessionEval(session({ reviewId: "b", submittedAt: 1 }), {
      routingCorrect: 2,
      captureCompleteness: 2,
      conversationQuality: 2,
      frustration: 5,
      summary: "",
    }),
    buildSessionEval(session({ reviewId: "c" }), null),
  ];

  it("aggregates counts, averages over scored sessions only, and surfaces worst sessions", () => {
    const aggregate = aggregateEvals(evals);
    expect(aggregate.sessionCount).toBe(3);
    expect(aggregate.scoredCount).toBe(2);
    expect(aggregate.droppedMidTurnCount).toBe(1);
    expect(aggregate.averages.conversationQuality).toBe(3); // (4 + 2) / 2
    expect(aggregate.submitRate).toBeCloseTo(0.33, 2);
    const reasons = aggregate.worstSessions.map((entry) => entry.reason);
    expect(reasons).toContain("dropped mid-utterance");
    expect(reasons).toContain("high visitor frustration");
  });

  it("fails the gate when a threshold is breached", () => {
    const aggregate = aggregateEvals(evals);
    const gate = meetsThreshold(aggregate, { minConversationQuality: 3.5, maxDroppedMidTurn: 0 });
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((message) => message.includes("conversationQuality"))).toBe(true);
    expect(gate.failures.some((message) => message.includes("droppedMidTurn"))).toBe(true);
  });

  it("passes the gate when thresholds are met", () => {
    const aggregate = aggregateEvals([evals[0] as (typeof evals)[number]]);
    const gate = meetsThreshold(aggregate, { minRoutingCorrect: 3, maxFrustration: 3 });
    expect(gate.ok).toBe(true);
  });
});
