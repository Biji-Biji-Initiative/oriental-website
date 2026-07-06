import { describe, expect, it } from "vitest";
import {
  appendTypedUserMessage,
  emptyCapturedLead,
  isBenignVoiceError,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";

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
          phone: "",
          website: "",
          message: "We want to run public AI literacy demos.",
        },
      }),
    );

    expect(result.state.segment).toBe("technology");
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([{ type: "submit_voice", callId: "call_2", segment: "technology" }]);
  });

  it("allows spoken email corrections that only add punctuation", () => {
    const current = state({
      captured: { ...emptyCapturedLead, email: "saralim@gmail.com" },
      transcript: [{ role: "user", text: "Sorry, it is sara dot lim at gmail dot com." }],
    });

    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "sara.lim@gmail.com",
                evidence: "sara dot lim at gmail dot com",
              }),
            },
          ],
        },
      },
      current,
    );

    expect(result.state.captured.email).toBe("sara.lim@gmail.com");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, key: "email", captured: expect.objectContaining({ email: "sara.lim@gmail.com" }) },
    });
  });

  it("does not route malformed email addresses", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_bad_email",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, email: "sara at gmail", message: "AI demos." } }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_bad_email",
        createResponse: true,
        output: {
          ok: false,
          ready: false,
          segment: "technology",
          error: "invalid_required_fields",
          missingFields: [],
          missingFieldLabels: [],
          invalidFields: ["email"],
          invalidFieldLabels: ["email"],
          captured: { ...emptyCapturedLead, email: "sara at gmail", message: "AI demos." },
        },
      },
    ]);
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
          phone: "",
          website: "",
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
        output: {
          ok: false,
          ready: false,
          segment: "education",
          error: "missing_required_fields",
          missingFields: ["email"],
          missingFieldLabels: ["email"],
          invalidFields: [],
          invalidFieldLabels: [],
          captured: { ...emptyCapturedLead, name: "Asha" },
        },
      },
    ]);
  });

  it("treats whitespace-only fields as missing before routing", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_whitespace",
              arguments: JSON.stringify({ segment: "education" }),
            },
          ],
        },
      },
      state({
        captured: {
          name: "Asha",
          email: "   ",
          org: "Future Lab",
          phone: "",
          website: "",
          message: "AI literacy demos.",
        },
      }),
    );

    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: false,
        ready: false,
        missingFields: ["email"],
        missingFieldLabels: ["email"],
        invalidFields: [],
        invalidFieldLabels: [],
      },
    });
  });

  it("summarises readiness with missing-field labels", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [{ type: "function_call", name: "summarise_lead", call_id: "call_summary", arguments: "{}" }],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Asha", message: "A programme idea." } }),
    );

    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: true,
        ready: false,
        missingFields: ["email"],
        missingFieldLabels: ["email"],
        invalidFields: [],
        invalidFieldLabels: [],
        routeRequested: false,
      },
    });
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

  it("accepts an organisation when ASR spelling drifts from what the model heard", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_asr_drift",
              arguments: JSON.stringify({
                key: "org",
                value: "Khazanah Nasional",
                evidence: "Khazanah Nasional",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "I'm calling from Cazana Nasional about the demo lab." }] }),
    );

    expect(result.state.captured.org).toBe("Khazanah Nasional");
  });

  it("still rejects an organisation with no resemblance to anything the user said", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_invented",
              arguments: JSON.stringify({ key: "org", value: "Petronas", evidence: "sure can" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "sure can, let's do that" }] }),
    );

    expect(result.state.captured.org).toBe("");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_org_invented",
        createResponse: true,
        output: { ok: false, error: "ungrounded_identity_capture", key: "org", value: "Petronas" },
      },
    ]);
  });

  it("accepts a name when the transcript spells it differently but recognisably", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_asr_drift",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet Singh", evidence: "Gurpreet Singh" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Gurprit Sing." }] }),
    );

    expect(result.state.captured.name).toBe("Gurpreet Singh");
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

  it("captures organisation when the user asks Reka to write a recently mentioned value", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_write_it",
              arguments: JSON.stringify({ key: "org", value: "Mereka", evidence: "You write it in" }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "Moreika." },
          { role: "assistant", text: "Please say the organisation name." },
          { role: "user", text: "You write it in." },
        ],
      }),
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

  it("accepts evidence-consistent identity capture while a user transcription is still pending", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_lagging_transcript",
              arguments: JSON.stringify({
                key: "email",
                value: "asha@example.com",
                evidence: "asha at example dot com",
              }),
            },
          ],
        },
      },
      committed.state,
    );

    expect(result.state.captured.email).toBe("asha@example.com");
  });

  it("still rejects evidence-inconsistent capture while a transcription is pending", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_mismatch",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan", evidence: "we want a demo lab" }),
            },
          ],
        },
      },
      committed.state,
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture" },
    });
  });

  it("clears the pending transcription window once the user transcript completes", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const transcribed = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "We want a demo lab." },
      committed.state,
    );
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_after_transcript",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan", evidence: "Alex Tan" }),
            },
          ],
        },
      },
      transcribed.state,
    );

    expect(result.state.pendingUserTranscripts).toBe(0);
    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture" },
    });
  });

  it("captures organisation as Individual when the user says they have no organisation", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_individual",
              arguments: JSON.stringify({ key: "org", value: "Individual", evidence: "no organisation, just me" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "No organisation, just me." }] }),
    );

    expect(result.state.captured.org).toBe("Individual");
  });

  it("confirms an already-captured value without demanding fresh evidence", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_confirm_existing",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, email: "asha@example.com" } }),
    );

    expect(result.state.captured.email).toBe("asha@example.com");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, key: "email" },
    });
  });

  it("grounds identity captures in messages the visitor typed into the chat", () => {
    const typed = appendTypedUserMessage(state(), "My email is mei@example.com and I am from Future Lab.");
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_typed_email",
              arguments: JSON.stringify({
                key: "email",
                value: "mei@example.com",
                evidence: "mei@example.com",
              }),
            },
          ],
        },
      },
      typed,
    );

    expect(typed.transcript).toEqual([{ role: "user", text: "My email is mei@example.com and I am from Future Lab." }]);
    expect(result.state.captured.email).toBe("mei@example.com");
  });

  it("streams assistant captions from transcript deltas and clears them on completion", () => {
    const first = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Hi, I’m " },
      state(),
    );
    const second = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Reka." },
      first.state,
    );
    expect(second.state.assistantDraft).toBe("Hi, I’m Reka.");

    const done = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I’m Reka." },
      second.state,
    );
    expect(done.state.assistantDraft).toBe("");
    expect(done.state.transcript).toEqual([{ role: "assistant", text: "Hi, I’m Reka." }]);
  });

  it("drops captions of a cancelled response when it finishes", () => {
    const speaking = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Let me tell you about the spa" },
      state(),
    );
    const cancelled = reduceRealtimeServerEvent({ type: "response.done" }, speaking.state);

    expect(cancelled.state.assistantDraft).toBe("");
    expect(cancelled.state.transcript).toEqual([]);
  });

  it("tracks whether an assistant response is in flight", () => {
    const started = reduceRealtimeServerEvent({ type: "response.created" }, state());
    expect(started.state.activeResponse).toBe(true);

    const finished = reduceRealtimeServerEvent({ type: "response.done" }, started.state);
    expect(finished.state.activeResponse).toBe(false);
  });

  it("records error codes and classifies benign realtime errors", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "error",
        error: { code: "response_cancel_not_active", message: "Cancellation failed: no active response found" },
      },
      state(),
    );

    expect(result.state.errors).toEqual([
      {
        eventId: undefined,
        code: "response_cancel_not_active",
        message: "Cancellation failed: no active response found",
      },
    ]);
    expect(isBenignVoiceError(result.state.errors?.[0] ?? { message: "" })).toBe(true);
    expect(isBenignVoiceError({ message: "Server error while processing audio" })).toBe(false);
  });
});
