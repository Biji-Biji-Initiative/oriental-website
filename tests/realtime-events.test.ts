import { describe, expect, it } from "vitest";
import { emptyCapturedLead, reduceRealtimeServerEvent, type VoiceRuntimeState } from "@/lib/voice/realtime-events";

function state(overrides: Partial<VoiceRuntimeState> = {}): VoiceRuntimeState {
  return {
    segment: "other",
    captured: emptyCapturedLead,
    transcript: [],
    ...overrides,
  };
}

describe("reduceRealtimeServerEvent", () => {
  it("captures function call fields from response.done output items", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_1",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com", evidence: "asha@example.com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("asha@example.com");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_1",
        createResponse: true,
        output: {
          ok: true,
          key: "email",
          mode: "replace",
          captured: { ...emptyCapturedLead, email: "asha@example.com" },
        },
      },
    ]);
  });

  it("waits for response.done before executing function calls", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "capture_field",
          call_id: "call_too_early",
          arguments: JSON.stringify({ key: "name", value: "Asha", evidence: "Asha" }),
        },
      },
      state({ transcript: [{ role: "user", text: "I am Asha." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands).toHaveLength(0);
  });

  it("routes only through known segments and asks the UI to submit", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_2",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          message: "We want to run public AI literacy demos.",
        },
      }),
    );

    expect(result.state.segment).toBe("technology");
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([{ type: "submit_voice", callId: "call_2", segment: "technology" }]);
  });

  it("does not submit twice after a route was already requested", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_3",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        routeRequested: true,
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          message: "We want to run public AI literacy demos.",
        },
      }),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_3",
        createResponse: true,
        output: { ok: false, error: "route_already_requested", segment: "technology" },
      },
    ]);
  });

  it("does not route incomplete leads", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_incomplete",
              arguments: JSON.stringify({ segment: "education" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Asha" } }),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_incomplete",
        createResponse: true,
        output: { ok: false, ready: false, segment: "education", missingFields: ["email", "org", "message"] },
      },
    ]);
  });

  it("does not apply the same function call twice", () => {
    const event = {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "capture_field",
            call_id: "call_repeat",
            arguments: JSON.stringify({ key: "name", value: "Asha", evidence: "Asha" }),
          },
        ],
      },
    };

    const first = reduceRealtimeServerEvent(event, state({ transcript: [{ role: "user", text: "I am Asha." }] }));
    const second = reduceRealtimeServerEvent(event, first.state);

    expect(first.commands).toHaveLength(1);
    expect(second.commands).toHaveLength(0);
    expect(second.state.captured.name).toBe("Asha");
  });

  it("stores assistant transcript text without duplicating identical final messages", () => {
    const first = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hello there." },
      state(),
    ).state;
    const second = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hello there." },
      first,
    ).state;

    expect(second.transcript).toEqual([{ role: "assistant", text: "Hello there." }]);
  });

  it("stores user transcription and transcription token usage", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "My name is Asha.",
        usage: { total_tokens: 26, input_tokens: 17, output_tokens: 9 },
      },
      state(),
    );

    expect(result.state.transcript).toEqual([{ role: "user", text: "My name is Asha." }]);
    expect(result.state.usage).toMatchObject({
      transcriptionCount: 1,
      transcriptionTokens: 26,
      transcriptionInputTokens: 17,
      transcriptionOutputTokens: 9,
    });
  });

  it("captures response usage totals", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          usage: {
            total_tokens: 253,
            input_tokens: 132,
            output_tokens: 121,
            input_token_details: { cached_tokens: 64 },
          },
        },
      },
      state(),
    );

    expect(result.state.usage).toMatchObject({
      responseCount: 1,
      responseTokens: 253,
      responseInputTokens: 132,
      responseOutputTokens: 121,
      responseCachedTokens: 64,
    });
  });

  it("returns wait_for_user output without creating a spoken response", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "wait_for_user",
              call_id: "call_wait",
              arguments: "{}",
            },
          ],
        },
      },
      state(),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_wait",
        createResponse: false,
        output: { ok: true, waited: true },
      },
    ]);
  });

  it("ends the voice session without asking the model to keep speaking", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "end_call",
              call_id: "call_end",
              arguments: JSON.stringify({ reason: "user_done" }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_end",
        createResponse: false,
        output: { ok: true, ended: true, reason: "user_done" },
      },
      { type: "end_voice", reason: "user_done" },
    ]);
  });

  it("rejects ungrounded identity fields instead of hallucinating contact details", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_hallucinated_name",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "I want to explore an AI demo partnership." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_hallucinated_name",
        createResponse: true,
        output: { ok: false, error: "ungrounded_identity_capture", key: "name", value: "Alex Tan" },
      },
    ]);
  });

  it("accepts spoken email evidence when it matches the user transcript", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim+ai@example.com",
                evidence: "asha dot lim plus ai at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha dot lim plus ai at example dot com." }] }),
    );

    expect(result.state.captured.email).toBe("asha.lim+ai@example.com");
  });

  it("appends brief updates when the model marks the message capture as additive", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_append_message",
              arguments: JSON.stringify({
                key: "message",
                value: "I can also rent the space and teach workshops.",
                mode: "append",
              }),
            },
          ],
        },
      },
      state({
        captured: {
          ...emptyCapturedLead,
          message: "I am a trainer and want the team to look me up.",
        },
      }),
    );

    expect(result.state.captured.message).toBe(
      "I am a trainer and want the team to look me up.\n\nI can also rent the space and teach workshops.",
    );
  });

  it("normalizes common spoken Mereka variants for organisation capture", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_moreika",
              arguments: JSON.stringify({ key: "org", value: "Moreika", evidence: "Moreika" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Moreika." }] }),
    );

    expect(result.state.captured.org).toBe("Mereka");
  });

  it("clears fields when the user rejects a wrong capture", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_field",
              call_id: "call_clear_name",
              arguments: JSON.stringify({ key: "name" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Alex Tan" } }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      callId: "call_clear_name",
      output: { ok: true, key: "name" },
    });
  });
});
