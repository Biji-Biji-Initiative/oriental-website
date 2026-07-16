import { describe, expect, it } from "vitest";
import {
  createVoiceLatencyState,
  MAX_VOICE_TOOL_SAMPLES,
  MAX_VOICE_LATENCY_TURNS,
  RAPID_RESUME_WINDOW_MS,
  reduceVoiceLatency,
  shouldEmitVoiceLatencyMetadata,
  type VoiceLatencySignal,
  type VoiceLatencyState,
} from "@/lib/voice/latency";

function reduce(signals: VoiceLatencySignal[], initial = createVoiceLatencyState()): VoiceLatencyState {
  return signals.reduce(reduceVoiceLatency, initial);
}

describe("voice latency telemetry", () => {
  it("records a normal turn and moves through orthogonal turn phases", () => {
    let state = createVoiceLatencyState();
    state = reduceVoiceLatency(state, { type: "speech_started", at: 100 });
    expect(state.phase).toBe("user_speaking");
    state = reduceVoiceLatency(state, { type: "speech_stopped", at: 500 });
    expect(state.phase).toBe("waiting_for_response");
    state = reduceVoiceLatency(state, { type: "response_created", at: 620 });
    state = reduceVoiceLatency(state, { type: "first_output", at: 810 });
    expect(state.phase).toBe("assistant_speaking");
    state = reduceVoiceLatency(state, { type: "response_done", at: 1_200 });

    expect(state.phase).toBe("quiet");
    expect(state.telemetry.turns).toEqual([
      {
        sequence: 1,
        inputPolicy: "baseline",
        speechDurationMs: 400,
        stopToResponseCreatedMs: 120,
        stopToFirstOutputEventMs: 310,
        responseDurationMs: 580,
        interrupted: false,
        rapidResume: false,
      },
    ]);
  });

  it("marks the response interrupted when the visitor barges in", () => {
    const state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 300 },
      { type: "response_created", at: 400 },
      { type: "first_output", at: 500 },
      { type: "speech_started", at: 650 },
    ]);

    expect(state.phase).toBe("user_speaking");
    expect(state.telemetry.turns[0]).toMatchObject({ interrupted: true, responseDurationMs: 250 });
    expect(state.current?.sequence).toBe(2);
  });

  it("folds a rapid speech resume into one turn and resets the false endpoint timing", () => {
    const state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 300 },
      { type: "response_created", at: 380 },
      { type: "speech_started", at: 300 + RAPID_RESUME_WINDOW_MS },
      { type: "speech_stopped", at: 2_000 },
      { type: "response_created", at: 2_100 },
      { type: "first_output", at: 2_300 },
      { type: "response_done", at: 2_500 },
    ]);

    expect(state.telemetry.turns).toEqual([
      expect.objectContaining({
        sequence: 1,
        speechDurationMs: 400,
        stopToResponseCreatedMs: 100,
        stopToFirstOutputEventMs: 300,
        rapidResume: true,
      }),
    ]);
  });

  it("keeps the first-output metric absent when a response completes silently", () => {
    const state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 200 },
      { type: "response_created", at: 300 },
      { type: "response_done", at: 600 },
    ]);

    expect(state.telemetry.turns[0]).toMatchObject({ stopToResponseCreatedMs: 100, responseDurationMs: 300 });
    expect(state.telemetry.turns[0]).not.toHaveProperty("stopToFirstOutputEventMs");
  });

  it("measures endpoint, remote-audio, playout, and arm-cue durations", () => {
    const state = reduce(
      [
        { type: "speech_started", at: 100 },
        { type: "local_speech_ended", at: 420 },
        { type: "speech_stopped", at: 500 },
        { type: "response_created", at: 620 },
        { type: "tool_completed", at: 667.4, durationMs: 37.4, name: "lookup_oriental", outcome: "success" },
        { type: "first_output", at: 760 },
        { type: "remote_audio_started", at: 820 },
        { type: "response_done", at: 1_200 },
      ],
      createVoiceLatencyState("fast", { tapToArmCueScheduledMs: 4 }, 50),
    );

    expect(state.telemetry.activation).toEqual({ tapToArmCueScheduledMs: 4, tapToAudibleMs: 770 });
    expect(state.telemetry.turns[0]).toMatchObject({
      inputPolicy: "fast",
      localSpeechEndToSpeechStoppedMs: 80,
      stopToRemoteAudioMs: 320,
      firstOutputEventToRemoteAudioMs: 60,
      toolDurationMs: 37,
    });
    expect(state.telemetry.toolCalls).toEqual([
      {
        sequence: 1,
        name: "lookup_oriental",
        outcome: "success",
        executionMs: 37,
        responseCreatedToCallMs: 10,
        responseCreatedToResultMs: 47,
      },
    ]);
  });

  it("records opener audio as tap-to-audible before the visitor speaks", () => {
    const state = reduce(
      [{ type: "remote_audio_started", at: 1_450 }],
      createVoiceLatencyState("baseline", { tapToArmCueScheduledMs: 3, tapToLiveMs: 480 }, 100),
    );

    expect(state.telemetry.activation).toEqual({
      tapToArmCueScheduledMs: 3,
      tapToLiveMs: 480,
      tapToAudibleMs: 1_350,
    });
    expect(state.telemetry.turns).toEqual([]);
  });

  it("accumulates and bounds browser-side tool execution within one response chain", () => {
    const state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 200 },
      { type: "response_created", at: 300 },
      { type: "tool_completed", at: 350.4, durationMs: 40.4, name: "capture_fields", outcome: "success" },
      { type: "tool_completed", at: 480, durationMs: 130_000, name: "route_to_team", outcome: "failed" },
      { type: "response_done", at: 500 },
    ]);

    expect(state.telemetry.turns[0]?.toolDurationMs).toBe(120_000);
    expect(state.telemetry.toolCalls).toHaveLength(2);
    expect(state.telemetry.toolCalls?.[1]).toMatchObject({
      name: "route_to_team",
      outcome: "failed",
      executionMs: 120_000,
    });
  });

  it("emits review metadata immediately when a tool sample is added", () => {
    const previous = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 200 },
      { type: "response_created", at: 300 },
    ]);
    const signal = {
      type: "tool_completed" as const,
      at: 345,
      durationMs: 15,
      name: "wait_for_user" as const,
      outcome: "success" as const,
    };
    const next = reduceVoiceLatency(previous, signal);

    expect(shouldEmitVoiceLatencyMetadata(previous, next, signal)).toBe(true);
    expect(next.telemetry.toolCalls).toHaveLength(1);
  });

  it("emits the newest tool sample when the bounded buffer is already full", () => {
    let previous = createVoiceLatencyState();
    for (let index = 0; index < MAX_VOICE_TOOL_SAMPLES; index += 1) {
      previous = reduceVoiceLatency(previous, {
        type: "tool_completed",
        at: index + 1,
        durationMs: 1,
        name: "wait_for_user",
        outcome: "success",
      });
    }
    const signal = {
      type: "tool_completed" as const,
      at: MAX_VOICE_TOOL_SAMPLES + 1,
      durationMs: 1,
      name: "end_call" as const,
      outcome: "success" as const,
    };
    const next = reduceVoiceLatency(previous, signal);

    expect(previous.telemetry.toolCalls).toHaveLength(MAX_VOICE_TOOL_SAMPLES);
    expect(next.telemetry.toolCalls).toHaveLength(MAX_VOICE_TOOL_SAMPLES);
    expect(next.telemetry.toolCalls).not.toBe(previous.telemetry.toolCalls);
    expect(next.telemetry.toolCalls?.at(-1)?.name).toBe("end_call");
    expect(shouldEmitVoiceLatencyMetadata(previous, next, signal)).toBe(true);
  });

  it("measures interruption clearing without losing the new user turn", () => {
    let state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 300 },
      { type: "response_created", at: 400 },
      { type: "first_output", at: 500 },
      { type: "speech_started", at: 650 },
    ]);
    expect(state.current?.sequence).toBe(2);
    const previous = state;
    const signal = { type: "interruption_cleared" as const, at: 820 };
    state = reduceVoiceLatency(state, signal);
    expect(state.telemetry.turns[0]).toMatchObject({ interrupted: true, bargeInToResponseDoneMs: 170 });
    expect(state.current?.sequence).toBe(2);
    expect(shouldEmitVoiceLatencyMetadata(previous, state, signal)).toBe(true);
  });

  it("applies input-policy changes only to subsequent turns", () => {
    let state = createVoiceLatencyState("fast");
    state = reduceVoiceLatency(state, { type: "input_policy_changed", inputPolicy: "patient" });
    state = reduce(
      [
        { type: "speech_started", at: 100 },
        { type: "speech_stopped", at: 200 },
        { type: "response_created", at: 300 },
        { type: "response_done", at: 400 },
      ],
      state,
    );
    expect(state.telemetry.turns[0]?.inputPolicy).toBe("patient");
  });

  it("flushes a partial turn when the session closes", () => {
    const state = reduce([
      { type: "speech_started", at: 100 },
      { type: "speech_stopped", at: 450 },
      { type: "session_closed", at: 700 },
    ]);

    expect(state.phase).toBe("quiet");
    expect(state.telemetry.turns[0]).toEqual({
      sequence: 1,
      inputPolicy: "baseline",
      speechDurationMs: 350,
      interrupted: false,
      rapidResume: false,
    });
  });

  it("bounds retained samples to the newest turns", () => {
    let state = createVoiceLatencyState();
    for (let sequence = 0; sequence < MAX_VOICE_LATENCY_TURNS + 5; sequence += 1) {
      const at = sequence * 1_000;
      state = reduce(
        [
          { type: "speech_started", at },
          { type: "speech_stopped", at: at + 100 },
          { type: "response_created", at: at + 200 },
          { type: "response_done", at: at + 300 },
        ],
        state,
      );
    }

    expect(state.telemetry.turns).toHaveLength(MAX_VOICE_LATENCY_TURNS);
    expect(state.telemetry.turns[0]?.sequence).toBe(6);
    expect(state.telemetry.turns.at(-1)?.sequence).toBe(MAX_VOICE_LATENCY_TURNS + 5);
  });
});
