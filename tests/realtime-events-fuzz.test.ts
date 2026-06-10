import { describe, expect, it } from "vitest";
import {
  emptyCapturedLead,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";

/**
 * The reducer sits on a trust boundary: every event arrives from a remote
 * data channel. This fuzz suite proves it never throws and never corrupts
 * its invariants, no matter what shape arrives.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENT_TYPES = [
  "response.created",
  "response.done",
  "response.output_audio_transcript.delta",
  "response.output_audio_transcript.done",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_started",
  "rate_limits.updated",
  "error",
  "session.updated",
  "unknown.future.event",
];

const TOOL_NAMES = [
  "capture_field",
  "clear_field",
  "set_partner_type",
  "summarise_lead",
  "route_to_team",
  "wait_for_user",
  "end_call",
  "hallucinated_tool",
];

function buildFuzzEvent(random: () => number, index: number): RealtimeServerEvent {
  const junk = (): unknown => {
    const pick = random();
    if (pick < 0.2) return undefined;
    if (pick < 0.35) return null;
    if (pick < 0.5) return Math.floor(random() * 1000);
    if (pick < 0.65) return { nested: { object: true } };
    if (pick < 0.75) return [1, "two", null];
    if (pick < 0.85) return random() < 0.5;
    return `text-${Math.floor(random() * 50)}`;
  };

  const type = EVENT_TYPES[Math.floor(random() * EVENT_TYPES.length)];
  const event: Record<string, unknown> = { type };
  if (random() < 0.7) event.transcript = junk();
  if (random() < 0.7) event.delta = junk();
  if (random() < 0.5) event.error = random() < 0.5 ? junk() : { message: junk(), code: junk(), event_id: junk() };
  if (random() < 0.5) event.rate_limits = junk();
  if (random() < 0.5) event.usage = random() < 0.5 ? junk() : { total_tokens: junk(), input_tokens: junk() };
  if (random() < 0.6) {
    const item = (): unknown =>
      random() < 0.3
        ? junk()
        : {
            type: random() < 0.6 ? "function_call" : junk(),
            name: random() < 0.7 ? TOOL_NAMES[Math.floor(random() * TOOL_NAMES.length)] : junk(),
            call_id: random() < 0.7 ? `call_${index}_${Math.floor(random() * 5)}` : junk(),
            arguments:
              random() < 0.6
                ? JSON.stringify({
                    key: ["name", "email", "org", "message", "bogus"][Math.floor(random() * 5)],
                    value: `value ${Math.floor(random() * 20)}`,
                    evidence: random() < 0.5 ? `value ${Math.floor(random() * 20)}` : junk(),
                    segment: random() < 0.5 ? "technology" : junk(),
                    mode: random() < 0.5 ? "append" : junk(),
                  })
                : (junk() as string),
            content: random() < 0.5 ? [{ transcript: junk(), text: junk() }] : junk(),
          };
    event.item = item();
    event.response = random() < 0.5 ? junk() : { output: random() < 0.7 ? [item(), item()] : junk(), usage: junk() };
  }
  return event as RealtimeServerEvent;
}

function assertInvariants(state: VoiceRuntimeState) {
  for (const entry of state.transcript) {
    expect(entry.role === "user" || entry.role === "assistant").toBe(true);
    expect(typeof entry.text).toBe("string");
    expect(entry.text.length).toBeGreaterThan(0);
  }
  expect(Object.keys(state.captured).sort()).toEqual(["email", "message", "name", "org"]);
  for (const value of Object.values(state.captured)) expect(typeof value).toBe("string");
  const callIds = state.handledCallIds ?? [];
  expect(new Set(callIds).size).toBe(callIds.length);
  expect(state.pendingUserTranscripts ?? 0).toBeGreaterThanOrEqual(0);
  for (const error of state.errors ?? []) {
    expect(typeof error.message).toBe("string");
    if (error.code !== undefined) expect(typeof error.code).toBe("string");
  }
  if (state.assistantDraft !== undefined) expect(typeof state.assistantDraft).toBe("string");
}

describe("reduceRealtimeServerEvent fuzzing", () => {
  it("survives known malformed wire shapes", () => {
    const attacks = [
      { type: "conversation.item.input_audio_transcription.completed", transcript: 123 },
      { type: "response.done", response: { output: { not: "an array" } } },
      { type: "response.output_audio_transcript.done", item: { content: { bad: true } } },
      { type: "response.output_audio_transcript.delta", delta: { obj: 1 } },
      { type: "error", error: { message: { nested: "obj" } } },
      { type: "rate_limits.updated", rate_limits: "not-array" },
      {
        type: "response.done",
        response: { output: [null, 7, "string", { type: "function_call", name: 9, call_id: {} }] },
      },
      {},
      { type: 42 },
    ] as RealtimeServerEvent[];

    let state: VoiceRuntimeState = { segment: "other", captured: emptyCapturedLead, transcript: [] };
    for (const attack of attacks) {
      const result = reduceRealtimeServerEvent(attack, state);
      state = result.state;
      assertInvariants(state);
    }
  });

  it("holds its invariants across 3000 randomized events", () => {
    const random = mulberry32(20260610);
    let state: VoiceRuntimeState = { segment: "other", captured: emptyCapturedLead, transcript: [] };
    for (let index = 0; index < 3000; index += 1) {
      const result = reduceRealtimeServerEvent(buildFuzzEvent(random, index), state);
      state = result.state;
      for (const command of result.commands) {
        expect(["function_result", "submit_voice", "end_voice"]).toContain(command.type);
      }
    }
    assertInvariants(state);
  });
});
