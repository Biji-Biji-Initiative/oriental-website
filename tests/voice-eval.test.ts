import { describe, expect, it } from "vitest";
import {
  aggregateEvals,
  aggregateEvalsByExperimentCell,
  aggregateEvalsByRuntimeProfile,
  assessLatencyAutopilotGate,
  buildJudgeUserPrompt,
  buildSessionEval,
  deriveCaptureIntegritySignals,
  deriveConversationStyleSignals,
  deriveEngagementSignals,
  deriveLatencySignals,
  deriveTransportSignals,
  isJudgeable,
  isSyntheticVoiceSession,
  meetsThreshold,
  mergeConversationSessions,
  parseJudgeResponse,
  piiFreeJudgeSummary,
  type VoiceEvalSession,
  validateVoiceExperimentEvidence,
} from "@/lib/eval/voice-eval";

function latencyGateSessions(
  profile: "baseline" | "instant-v1",
  options: { remoteAudioMs?: number; corrected?: boolean; rapidResumes?: number } = {},
): VoiceEvalSession[] {
  return Array.from({ length: 20 }, (_, sessionIndex) =>
    session({
      reviewId: `${profile}-${sessionIndex}`,
      sessionId: `${profile}-session-${sessionIndex}`,
      runtimeProfile: profile,
      transcript: [
        {
          role: "user",
          text: options.corrected ? "Actually, my email is visitor@example.com" : "My email is visitor@example.com",
        },
      ],
      latency: {
        version: 1,
        turns: Array.from({ length: 5 }, (_, turnIndex) => ({
          sequence: turnIndex + 1,
          inputPolicy: profile === "instant-v1" ? "fast" : "baseline",
          stopToRemoteAudioMs: options.remoteAudioMs ?? 500,
          bargeInToResponseDoneMs: 200,
          interrupted: true,
          rapidResume: sessionIndex * 5 + turnIndex < (options.rapidResumes ?? 0),
        })),
      },
    }),
  );
}

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

describe("isSyntheticVoiceSession", () => {
  it("excludes reserved-address intake probes", () => {
    expect(
      isSyntheticVoiceSession(
        session({
          captured: { name: "", email: "qa.nebula@example.test", org: "", message: "" },
        }),
      ),
    ).toBe(true);
  });

  it("excludes the transport smoke prompt without hiding ordinary staging conversations", () => {
    expect(
      isSyntheticVoiceSession(
        session({
          transcript: [{ role: "user", text: "Please pause and tell me briefly about education partnerships." }],
        }),
      ),
    ).toBe(true);
    expect(isSyntheticVoiceSession(session({ deploymentEnvironment: "staging" }))).toBe(false);
  });
});

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
      realtimeBusyRetries: 0,
      remoteTrackReceived: false,
      worstPacketsLostPct: null,
      worstRttMs: null,
    });
  });

  it("flags a mid-utterance page unload as a drop", () => {
    const signals = deriveTransportSignals(
      session({
        closeReason: "page_hidden",
        transport: { disconnectCount: 0, recoveryCount: 0, iceRestartCount: 0, wasSpeakingAtClose: true },
      }),
    );
    expect(signals.droppedMidTurn).toBe(true);
  });
});

describe("mergeConversationSessions", () => {
  it("keeps distinct conversations separate and passes lone rows through", () => {
    const merged = mergeConversationSessions([
      session({ reviewId: "a", conversationId: "conv-1" }),
      session({ reviewId: "b", conversationId: "conv-2" }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.every((entry) => (entry.callReviewIds?.length ?? 1) === 1)).toBe(true);
  });

  it("stitches a dropped-and-resumed call into one conversation", () => {
    const first = session({
      reviewId: "call-1",
      conversationId: "conv-1",
      connectStartedAt: 1_000,
      connectedAt: 1_100,
      closedAt: 2_000,
      closeReason: "disconnected",
      activationAttempted: true,
      transport: { disconnectCount: 1, recoveryCount: 0, iceRestartCount: 1, wasSpeakingAtClose: true },
      latency: {
        version: 1,
        activation: { tapToArmCueScheduledMs: 4, tapToLiveMs: 300, tapToAudibleMs: 1_200 },
        turns: [
          {
            sequence: 1,
            inputPolicy: "baseline",
            stopToFirstOutputEventMs: 600,
            interrupted: true,
            rapidResume: false,
          },
        ],
      },
      transcript: [
        { role: "assistant", text: "Hi, I'm Reka." },
        { role: "user", text: "We build robots." },
      ],
    });
    // Same-dialog reconnect: the runtime transcript accumulates, so the second
    // row is a superset of the first plus new turns.
    const second = session({
      reviewId: "call-2",
      conversationId: "conv-1",
      connectStartedAt: 3_000,
      connectedAt: 3_100,
      closedAt: 4_000,
      submittedAt: 4_500,
      leadId: "lead-9",
      closeReason: "manual",
      activationAttempted: true,
      transport: { disconnectCount: 0, recoveryCount: 0, iceRestartCount: 0, wasSpeakingAtClose: false },
      latency: {
        version: 1,
        turns: [
          {
            sequence: 1,
            inputPolicy: "baseline",
            stopToFirstOutputEventMs: 400,
            interrupted: false,
            rapidResume: true,
          },
        ],
      },
      transcript: [
        { role: "assistant", text: "Hi, I'm Reka." },
        { role: "user", text: "We build robots." },
        { role: "user", text: "Email is a@b.com." },
      ],
    });

    const merged = mergeConversationSessions([first, second]);
    expect(merged).toHaveLength(1);
    const conversation = merged[0];
    expect(conversation?.callReviewIds).toEqual(["call-1", "call-2"]);
    // Deduped union — the repeated opening turns collapse, new turn survives.
    expect(conversation?.transcript.map((turn) => turn.text)).toEqual([
      "Hi, I'm Reka.",
      "We build robots.",
      "Email is a@b.com.",
    ]);
    // Spans both calls: earliest start, latest close, submission preserved.
    expect(conversation?.connectStartedAt).toBe(1_000);
    expect(conversation?.closedAt).toBe(4_000);
    expect(conversation?.submittedAt).toBe(4_500);
    expect(conversation?.leadId).toBe("lead-9");
    // Transport counts sum across segments.
    expect(conversation?.transport?.disconnectCount).toBe(1);
    expect(conversation?.latency?.turns).toHaveLength(2);
    expect(conversation?.latency?.activationAttempts).toHaveLength(2);
    const aggregate = aggregateEvals([buildSessionEval(conversation as VoiceEvalSession, null)]);
    expect(aggregate.activation).toMatchObject({ attempts: 2, usefulStartWithinTwoSeconds: 1, usefulStartRate: 0.5 });
    expect(aggregate.droppedMidTurnCount).toBe(1);
    expect(deriveEngagementSignals(conversation as VoiceEvalSession).submitted).toBe(true);
  });

  it("falls back to reviewId when a row has no conversationId", () => {
    const merged = mergeConversationSessions([
      session({ reviewId: "legacy-1", conversationId: null }),
      session({ reviewId: "legacy-2", conversationId: null }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("preserves an explicit dropped-mid-turn signal across a later clean segment", () => {
    const merged = mergeConversationSessions([
      session({
        reviewId: "explicit-drop",
        conversationId: "conv-drop",
        connectStartedAt: 1,
        closeReason: "manual",
        transport: {
          droppedMidTurn: true,
          disconnectCount: 1,
          recoveryCount: 0,
          iceRestartCount: 0,
          wasSpeakingAtClose: false,
        },
      }),
      session({
        reviewId: "clean-finish",
        conversationId: "conv-drop",
        connectStartedAt: 2,
        closeReason: "manual",
        transport: { disconnectCount: 0, recoveryCount: 0, iceRestartCount: 0, wasSpeakingAtClose: false },
      }),
    ]);

    expect(deriveTransportSignals(merged[0] as VoiceEvalSession).droppedMidTurn).toBe(true);
  });
});

describe("deriveLatencySignals", () => {
  it("summarizes first-output and response-created timings without calling them audible latency", () => {
    const signals = deriveLatencySignals(
      session({
        latency: {
          version: 1,
          turns: [
            {
              sequence: 1,
              inputPolicy: "baseline",
              stopToResponseCreatedMs: 120,
              stopToFirstOutputEventMs: 300,
              toolDurationMs: 20,
              interrupted: false,
              rapidResume: false,
            },
            {
              sequence: 2,
              inputPolicy: "baseline",
              stopToResponseCreatedMs: 200,
              stopToFirstOutputEventMs: 900,
              toolDurationMs: 80,
              interrupted: true,
              rapidResume: true,
            },
          ],
        },
      }),
    );

    expect(signals).toEqual({
      activationSamples: [],
      activationAttempts: [],
      sampledTurns: 2,
      firstOutputSamples: 2,
      firstOutputP50Ms: 300,
      firstOutputP95Ms: 900,
      responseCreatedSamples: 2,
      responseCreatedP50Ms: 120,
      responseCreatedP95Ms: 200,
      remoteAudioSamples: 0,
      remoteAudioP50Ms: null,
      remoteAudioP95Ms: null,
      endpointP50Ms: null,
      endpointP95Ms: null,
      playoutP50Ms: null,
      playoutP95Ms: null,
      toolP50Ms: 20,
      toolP95Ms: 80,
      bargeInP95Ms: null,
      tapToArmCueMs: null,
      tapToLiveMs: null,
      tapToAudibleMs: null,
      interruptedTurns: 1,
      rapidResumeTurns: 1,
      toolCalls: [],
    });
  });

  it("aggregates canonical clear_fields telemetry without folding it into clear_field", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          latency: {
            version: 1,
            turns: [],
            toolCalls: [
              {
                sequence: 1,
                name: "clear_fields",
                outcome: "success",
                executionMs: 8,
                responseCreatedToCallMs: 21,
                responseCreatedToResultMs: 29,
              },
              {
                sequence: 2,
                name: "clear_field",
                outcome: "rejected",
                executionMs: 4,
              },
            ],
          },
        }),
        null,
      ),
    ]);

    expect(aggregate.toolLatency.overall).toMatchObject({ samples: 2 });
    expect(aggregate.toolLatency.byName.clear_fields).toMatchObject({
      samples: 1,
      outcomes: { success: 1, rejected: 0, failed: 0, dispatch_failed: 0 },
      executionP50Ms: 8,
      responseCreatedToResultP50Ms: 29,
    });
    expect(aggregate.toolLatency.byName.clear_field).toMatchObject({
      samples: 1,
      outcomes: { success: 0, rejected: 1, failed: 0, dispatch_failed: 0 },
      executionP50Ms: 4,
    });
  });
});

describe("assessLatencyAutopilotGate", () => {
  it("refuses promotion while measurement evidence is sparse", () => {
    const gate = assessLatencyAutopilotGate([
      session({
        runtimeProfile: "instant-v1",
        latency: { version: 1, turns: [] },
      }),
    ]);

    expect(gate.status).toBe("insufficient_data");
    expect(gate.eligibleForAutomaticPromotion).toBe(false);
    expect(gate.missingEvidence.length).toBeGreaterThan(0);
  });

  it("passes only with enough good remote-audio, endpoint, barge-in, and correction evidence", () => {
    const gate = assessLatencyAutopilotGate([
      ...latencyGateSessions("baseline", { corrected: true }),
      ...latencyGateSessions("instant-v1", { rapidResumes: 1 }),
    ]);

    expect(gate.status).toBe("pass");
    expect(gate.eligibleForAutomaticPromotion).toBe(true);
    expect(gate.candidate.possibleFalseEndpointRate).toBe(0.01);
    expect(gate.candidate.contactCorrectionRate).toBe(0);
    expect(gate.control.contactCorrectionRate).toBe(1);
  });

  it("excludes model and reasoning candidates from the runtime promotion cohorts", () => {
    const modelCandidates = latencyGateSessions("baseline", { corrected: true }).map((entry, index) => ({
      ...entry,
      reviewId: `model-candidate-${index}`,
      modelCell: "candidate" as const,
    }));
    const reasoningCandidates = latencyGateSessions("instant-v1", { corrected: true }).map((entry, index) => ({
      ...entry,
      reviewId: `reasoning-candidate-${index}`,
      reasoningCell: "minimal" as const,
    }));
    const gate = assessLatencyAutopilotGate([
      ...latencyGateSessions("baseline"),
      ...latencyGateSessions("instant-v1"),
      ...modelCandidates,
      ...reasoningCandidates,
    ]);

    expect(gate.control.sessions).toBe(20);
    expect(gate.candidate.sessions).toBe(20);
  });

  it("fails a fully sampled candidate that misses latency or correction quality", () => {
    const gate = assessLatencyAutopilotGate([
      ...latencyGateSessions("baseline"),
      ...latencyGateSessions("instant-v1", { corrected: true, remoteAudioMs: 1_100, rapidResumes: 3 }),
    ]);

    expect(gate.status).toBe("fail");
    expect(gate.eligibleForAutomaticPromotion).toBe(false);
    expect(gate.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("remote audio p50"),
        expect.stringContaining("remote audio p95"),
        expect.stringContaining("false-endpoint proxy"),
        expect.stringContaining("contact correction rate"),
      ]),
    );
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

describe("deriveCaptureIntegritySignals", () => {
  it("counts rejected captures and unconfirmed-email failures independently", () => {
    const signals = deriveCaptureIntegritySignals(
      session({
        errors: [
          { code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:email" },
          { code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:name" },
          { code: "voice_email_unconfirmed", message: "route_to_team:unconfirmed_required_fields" },
          { code: "conversation_already_has_active_response", message: "benign response race" },
        ],
      }),
    );

    expect(signals).toEqual({
      rejectedCaptures: 2,
      rejectedEmailCaptures: 1,
      unconfirmedEmailFailures: 1,
      staleEmailSubmissions: 0,
      totalFailures: 3,
      failed: true,
    });
  });

  it("flags a submitted stale prefill after a rejected literal email correction", () => {
    const signals = deriveCaptureIntegritySignals(
      session({
        submittedAt: 100,
        captured: { name: "", email: "old@example.com", org: "", message: "" },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, my email is new@example.com." },
        ],
        errors: [{ code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:email" }],
      }),
    );

    expect(signals).toMatchObject({
      rejectedEmailCaptures: 1,
      staleEmailSubmissions: 1,
      totalFailures: 2,
      failed: true,
    });
  });

  it("does not call a successfully replaced submitted address stale", () => {
    const signals = deriveCaptureIntegritySignals(
      session({
        submittedAt: 100,
        captured: { name: "", email: "new@example.com", org: "", message: "" },
        transcript: [{ role: "user", text: "Actually, my email is new@example.com." }],
        errors: [{ code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:email" }],
      }),
    );

    expect(signals.staleEmailSubmissions).toBe(0);
  });
});

describe("deriveConversationStyleSignals", () => {
  it("counts the known tic only in assistant turns", () => {
    const signals = deriveConversationStyleSignals(
      session({
        transcript: [
          { role: "assistant", text: "Quick one: what is your email?" },
          { role: "user", text: "Why do you keep saying quick one?" },
          { role: "assistant", text: "QUICK   ONE — what is your organisation?" },
        ],
      }),
    );

    expect(signals).toEqual({ bannedPhraseOccurrences: 2, failed: true });
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
  it("includes transcript, final captured handoff, runtime issues, and outcome but not raw token usage", () => {
    const prompt = buildJudgeUserPrompt(
      session({
        segment: "cultural",
        submittedAt: 5,
        captured: {
          name: "Jay",
          email: "g@g.com",
          org: "Manufacturers",
          message: "A partnership question.",
        },
        errors: [{ code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:email" }],
      }),
    );
    expect(prompt).toContain("Intended segment: cultural");
    expect(prompt).toContain("lead submitted");
    expect(prompt).toContain("Email: g@g.com");
    expect(prompt).toContain("voice_capture_rejected");
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

describe("piiFreeJudgeSummary", () => {
  it("projects only numeric scores even when provider prose echoes captured PII", () => {
    const summary = piiFreeJudgeSummary({
      routingCorrect: 4,
      captureCompleteness: 3,
      conversationQuality: 5,
      frustration: 1,
      summary: "Jay at Manufacturers uses g@g.com.",
    });

    expect(summary).toBe("Routing 4/5 · Capture 3/5 · Conversation 5/5 · Frustration 1/5.");
    expect(summary).not.toMatch(/Jay|Manufacturers|g@g\.com/i);
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
    expect(aggregate.activation.tapToLiveSamples).toBe(0);
    expect(aggregate.activation.usefulStartRate).toBeNull();
    const reasons = aggregate.worstSessions.map((entry) => entry.reason);
    expect(reasons).toContain("dropped mid-utterance");
    expect(reasons).toContain("high visitor frustration");
  });

  it("surfaces capture-integrity failures deterministically and gates them", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          reviewId: "capture-failed",
          errors: [
            { code: "voice_capture_rejected", message: "capture_fields:ungrounded_identity_capture:email" },
            { code: "voice_email_unconfirmed", message: "route_to_team:unconfirmed_required_fields" },
          ],
        }),
        null,
      ),
      buildSessionEval(session({ reviewId: "capture-clean" }), null),
    ]);

    expect(aggregate.captureIntegrity).toEqual({
      failedSessions: 1,
      rejectedCaptures: 1,
      rejectedEmailCaptures: 1,
      unconfirmedEmailFailures: 1,
      staleEmailSubmissions: 0,
      totalFailures: 2,
    });
    expect(aggregate.worstSessions).toContainEqual({
      reviewId: "capture-failed",
      reason: "2 capture-integrity failures",
    });
    expect(meetsThreshold(aggregate, { maxCaptureIntegrityFailures: 0 })).toEqual({
      ok: false,
      failures: ["captureIntegrityFailures 2 > 0"],
    });
  });

  it("surfaces and gates banned conversation tics deterministically", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          reviewId: "tic-failed",
          transcript: [{ role: "assistant", text: "Quick one. Quick one." }],
        }),
        null,
      ),
    ]);

    expect(aggregate.conversationStyle).toEqual({ failedSessions: 1, bannedPhraseOccurrences: 2 });
    expect(aggregate.worstSessions).toContainEqual({
      reviewId: "tic-failed",
      reason: "2 banned style-tic occurrences",
    });
    expect(meetsThreshold(aggregate, { maxStyleTicOccurrences: 0 })).toEqual({
      ok: false,
      failures: ["styleTicOccurrences 2 > 0"],
    });
  });

  it("reports exact tap-to-live percentiles for profile and model-cell comparisons", () => {
    const evalsWithActivation = [120, 480, 700].map((tapToLiveMs, index) =>
      buildSessionEval(
        session({
          reviewId: `activation-${index}`,
          runtimeProfile: index === 0 ? "baseline" : "instant-v1",
          activationAttempted: true,
          modelCell: index === 2 ? "candidate" : "control",
          latency: {
            version: 1,
            activation: {
              tapToArmCueScheduledMs: 4 + index,
              tapToLiveMs,
              tapToAudibleMs: [1_200, 1_900, 2_300][index],
            },
            turns: [],
          },
        }),
        null,
      ),
    );

    const aggregate = aggregateEvals(evalsWithActivation);
    expect(aggregate.activation).toEqual({
      attempts: 3,
      tapToLiveSamples: 3,
      tapToLiveP50Ms: 480,
      tapToLiveP95Ms: 700,
      tapToAudibleSamples: 3,
      tapToAudibleP50Ms: 1_900,
      tapToAudibleP95Ms: 2_300,
      usefulStartWithinTwoSeconds: 2,
      usefulStartRate: 0.67,
      armCueSamples: 3,
      armCueP95Ms: 6,
    });
    expect(aggregateEvalsByRuntimeProfile(evalsWithActivation)["instant-v1"]?.activation.tapToLiveP50Ms).toBe(480);
    expect(
      aggregateEvalsByExperimentCell(evalsWithActivation)[
        "instant-v1/candidate/low/env-default/unknown-voice/unknown-speed"
      ]?.activation.tapToLiveP50Ms,
    ).toBe(700);
  });

  it("counts each post-mint activation once when legacy telemetry is partial", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          reviewId: "cue-only",
          activationAttempted: true,
          latency: {
            version: 1,
            activation: { tapToArmCueScheduledMs: 4 },
            turns: [],
          },
        }),
        null,
      ),
      buildSessionEval(
        session({
          reviewId: "audible-without-cue",
          activationAttempted: true,
          latency: {
            version: 1,
            activation: { tapToAudibleMs: 1_500 },
            turns: [],
          },
        }),
        null,
      ),
      buildSessionEval(
        session({
          reviewId: "explicit-failed-attempt",
          activationAttempted: true,
          latency: null,
        }),
        null,
      ),
      buildSessionEval(
        session({
          reviewId: "no-activation",
          latency: { version: 1, turns: [] },
        }),
        null,
      ),
    ]);

    expect(aggregate.activation.attempts).toBe(3);
    expect(aggregate.activation.usefulStartWithinTwoSeconds).toBe(1);
    expect(aggregate.activation.usefulStartRate).toBe(0.33);
    expect(aggregate.activation.armCueSamples).toBe(1);
    expect(aggregate.activation.tapToAudibleSamples).toBe(1);
  });

  it("keeps legacy activation telemetry visible without inventing an attempt denominator", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          reviewId: "legacy-activation",
          activationAttempted: null,
          latency: {
            version: 1,
            activation: { tapToArmCueScheduledMs: 8, tapToLiveMs: 600 },
            turns: [],
          },
        }),
        null,
      ),
    ]);

    expect(aggregate.activation).toMatchObject({
      attempts: 0,
      usefulStartRate: null,
      armCueSamples: 1,
      tapToLiveSamples: 1,
      tapToLiveP50Ms: 600,
    });
  });

  it("separates capacity, WebRTC, retry, and remote-track-without-audio failures", () => {
    const aggregate = aggregateEvals([
      buildSessionEval(
        session({
          reviewId: "busy",
          closeReason: "realtime_busy",
          transport: {
            realtimeBusyRetryCount: 1,
            disconnectCount: 0,
            recoveryCount: 0,
            iceRestartCount: 0,
          },
        }),
        null,
      ),
      buildSessionEval(
        session({
          reviewId: "no-audio",
          closeReason: "webrtc_failed",
          transport: {
            disconnectCount: 0,
            recoveryCount: 0,
            iceRestartCount: 0,
            remoteTrackReceivedAt: 1_000,
          },
        }),
        null,
      ),
    ]);

    expect(aggregate.availability).toEqual({
      realtimeBusySessions: 1,
      webrtcFailedSessions: 1,
      retrySessions: 1,
      remoteTrackWithoutAudioSessions: 1,
      quotaFailures: 0,
      capacityFailures: 1,
      transportFailures: 1,
      totalFailures: 2,
    });
  });

  it("fails the gate when a threshold is breached", () => {
    const aggregate = aggregateEvals(evals);
    const gate = meetsThreshold(aggregate, { minConversationQuality: 3.5, maxDroppedMidTurn: 0 });
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((message) => message.includes("conversationQuality"))).toBe(true);
    expect(gate.failures.some((message) => message.includes("droppedMidTurn"))).toBe(true);
  });

  it("retains quota failures across stitched calls and fails the availability gate", () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const stitched = mergeConversationSessions([
      session({
        reviewId: "quota-call",
        sessionId: "quota-session",
        conversationId,
        closeReason: "realtime_quota_exhausted",
        connectStartedAt: 1_000,
        transcript: [],
      }),
      session({
        reviewId: "recovered-call",
        sessionId: "recovered-session",
        conversationId,
        closeReason: "manual",
        connectStartedAt: 2_000,
      }),
    ]);
    const aggregate = aggregateEvals(stitched.map((entry) => buildSessionEval(entry, null)));

    expect(aggregate.availability).toEqual({
      realtimeBusySessions: 0,
      webrtcFailedSessions: 0,
      retrySessions: 0,
      remoteTrackWithoutAudioSessions: 0,
      quotaFailures: 1,
      capacityFailures: 0,
      transportFailures: 0,
      totalFailures: 1,
    });
    expect(meetsThreshold(aggregate, { maxQuotaFailures: 0 })).toEqual({
      ok: false,
      failures: ["quotaFailures 1 > 0"],
    });
  });

  it("passes the gate when thresholds are met", () => {
    const aggregate = aggregateEvals([evals[0] as (typeof evals)[number]]);
    const gate = meetsThreshold(aggregate, { minRoutingCorrect: 3, maxFrustration: 3 });
    expect(gate.ok).toBe(true);
  });

  it("fails score thresholds closed when there are no scored conversations", () => {
    const aggregate = aggregateEvals([buildSessionEval(session(), null)]);
    const gate = meetsThreshold(aggregate, {
      minConversationQuality: 3,
      minRoutingCorrect: 3,
      maxFrustration: 3,
    });
    expect(gate.ok).toBe(false);
    expect(gate.failures).toEqual([
      "conversationQuality unavailable (0 scored conversations)",
      "routingCorrect unavailable (0 scored conversations)",
      "frustration unavailable (0 scored conversations)",
    ]);
  });

  it("keeps runtime-profile comparisons separate from voice variants", () => {
    const grouped = aggregateEvalsByRuntimeProfile([
      buildSessionEval(session({ reviewId: "baseline", runtimeProfile: "baseline" }), null),
      buildSessionEval(session({ reviewId: "instant", runtimeProfile: "instant-v1", submittedAt: 1 }), null),
    ]);
    expect(grouped.baseline?.sessionCount).toBe(1);
    expect(grouped["instant-v1"]?.sessionCount).toBe(1);
    expect(grouped["instant-v1"]?.submitRate).toBe(1);
  });

  it("compares controlled model and reasoning cells independently", () => {
    const grouped = aggregateEvalsByExperimentCell([
      buildSessionEval(session({ reviewId: "control", modelCell: "control", reasoningCell: "low" }), null),
      buildSessionEval(
        session({ reviewId: "candidate", modelCell: "candidate", reasoningCell: "minimal", submittedAt: 1 }),
        null,
      ),
    ]);
    expect(grouped["baseline/control/low/env-default/unknown-voice/unknown-speed"]?.sessionCount).toBe(1);
    expect(grouped["baseline/candidate/minimal/env-default/unknown-voice/unknown-speed"]?.submitRate).toBe(1);
  });

  it("rejects evidence rows that confound multiple experiment dimensions", () => {
    const valid = buildSessionEval(
      session({ reviewId: "runtime-only", runtimeProfile: "instant-v1", modelCell: "control", reasoningCell: "low" }),
      null,
    );
    const confounded = buildSessionEval(
      session({
        reviewId: "confounded",
        runtimeProfile: "instant-v1",
        modelCell: "candidate",
        reasoningCell: "minimal",
      }),
      null,
    );

    expect(validateVoiceExperimentEvidence([valid])).toEqual({ ok: true, failures: [] });
    const validation = validateVoiceExperimentEvidence([valid, confounded]);
    expect(validation.ok).toBe(false);
    expect(validation.failures[0]).toContain("runtime, model, reasoning");
  });

  it("rejects candidate-model evidence that also changes the voice variant", () => {
    const audition = buildSessionEval(
      session({
        reviewId: "candidate-audition",
        modelCell: "candidate",
        voice: "marin",
        speed: 1.22,
        variant: "kl-polished",
      }),
      null,
    );

    const validation = validateVoiceExperimentEvidence([audition]);
    expect(validation.ok).toBe(false);
    expect(validation.failures[0]).toContain("model, voice variant");
  });
});
