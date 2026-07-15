import { describe, expect, it } from "vitest";
import {
  createVoiceLatencyState,
  MAX_VOICE_LATENCY_TURNS,
  RAPID_RESUME_WINDOW_MS,
  reduceVoiceLatency,
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
