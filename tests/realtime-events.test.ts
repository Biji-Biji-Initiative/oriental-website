import { describe, expect, it } from "vitest";
import {
  appendTypedUserMessage,
  emptyCapturedLead,
  isBenignVoiceError,
  reduceRealtimeServerEvent,
  responseHasFunctionCall,
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
  it("identifies tool-only response completions so timing waits for the spoken follow-up", () => {
    expect(
      responseHasFunctionCall({
        type: "response.done",
        response: { output: [{ type: "function_call", name: "lookup_oriental" }] },
      }),
    ).toBe(true);
    expect(responseHasFunctionCall({ type: "response.done", response: { output: [{ type: "message" }] } })).toBe(false);
  });

  it("tentatively captures only an explicit literal visitor email", () => {
    const typed = appendTypedUserMessage(state(), "My email is asha@example.com");
    expect(typed.captured.email).toBe("asha@example.com");
    expect(typed.emailVerification).toEqual({ value: "asha@example.com", source: "typed", status: "confirmed" });

    const example = appendTypedUserMessage(state(), "The website uses team@example.com as an example.");
    expect(example.captured.email).toBe("");
  });

  it("never overwrites an email the visitor already edited", () => {
    const result = appendTypedUserMessage(
      state({ captured: { ...emptyCapturedLead, email: "correct@example.com" } }),
      "My email is other@example.com",
    );
    expect(result.captured.email).toBe("correct@example.com");
  });

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
          emailConfirmationRequired: true,
          emailReadback: "asha at example dot com",
          nextAction: expect.stringContaining("Read emailReadback verbatim"),
          captured: { ...emptyCapturedLead, email: "asha@example.com" },
        },
      },
    ]);
    expect(result.state.emailVerification).toEqual({
      value: "asha@example.com",
      source: "speech",
      status: "pending",
    });
  });

  it("routes a grounded speech email without a confirmation turn in adaptive mode", () => {
    const capture = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_adaptive_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha@example.com",
                evidence: "asha at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha at example dot com." }] }),
    );

    expect(capture.state.emailCaptureMode).toBe("adaptive");
    expect(capture.state.emailVerification).toEqual({
      value: "asha@example.com",
      source: "speech",
      status: "confirmed",
      confidence: "high",
    });
    expect(capture.commands[0]).toMatchObject({
      output: {
        ok: true,
        emailConfirmationRequired: false,
        emailCaptureMode: "adaptive",
        emailConfidence: "high",
        nextAction: expect.stringContaining("without asking for a separate confirmation"),
      },
    });

    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_adaptive_route",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      capture.state,
    );
    expect(routed.commands).toEqual([{ type: "submit_voice", callId: "call_adaptive_route", segment: "technology" }]);
  });

  it("keeps bounded ASR drift smooth but reports medium confidence", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_adaptive_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asia.lim@example.my." }] }),
    );

    expect(result.state.emailVerification).toMatchObject({
      status: "confirmed",
      source: "speech",
      confidence: "medium",
    });
    expect(result.commands[0]).toMatchObject({ output: { emailConfirmationRequired: false } });
  });

  it("re-evaluates a corrected adaptive email and still blocks an invented replacement", () => {
    const initial = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_initial_adaptive_email",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com", evidence: "asha@example.com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha@example.com." }] }),
    );
    const corrected = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_corrected_adaptive_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.com",
                evidence: "actually asha dot lim at example dot com",
              }),
            },
          ],
        },
      },
      {
        ...initial.state,
        transcript: [
          ...initial.state.transcript,
          { role: "user", text: "Actually, it is asha dot lim at example dot com." },
        ],
      },
    );
    expect(corrected.state.captured.email).toBe("asha.lim@example.com");
    expect(corrected.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });

    const invented = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_invented_replacement",
              arguments: JSON.stringify({
                key: "email",
                value: "sales@example.com",
                evidence: "sales at example dot com",
              }),
            },
          ],
        },
      },
      corrected.state,
    );
    expect(invented.state.captured.email).toBe("asha.lim@example.com");
    expect(invented.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a one-character email drift instead of changing the visitor's address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_near_miss",
              arguments: JSON.stringify({ key: "email", value: "g@g.com", evidence: "g at b dot com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is g at b dot com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
    expect(result.state.errors).toContainEqual(
      expect.objectContaining({ code: "voice_capture_rejected", message: expect.stringContaining("email") }),
    );
  });

  it("keeps a native-audio email as a pending draft when ASR spelling drifts", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_asr_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asia.lim@example.my." }] }),
    );

    expect(result.state.captured.email).toBe("asha.lim@example.my");
    expect(result.state.emailVerification).toEqual({
      value: "asha.lim@example.my",
      source: "speech",
      status: "pending",
    });
    expect(result.commands[0]).toMatchObject({
      output: { ok: true, emailConfirmationRequired: true, emailReadback: "asha dot lim at example dot my" },
    });
  });

  it("still rejects a self-consistent email invention when the user gave no contact detail", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_invented",
              arguments: JSON.stringify({
                key: "email",
                value: "invented@example.com",
                evidence: "invented at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "We want to run a robotics workshop." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("requires an exact read-back confirmation before routing a speech email", () => {
    const capture = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_exact",
              arguments: JSON.stringify({ key: "email", value: "g@b.com", evidence: "g at b dot com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is g at b dot com." }] }),
    );
    const prematureRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_too_soon",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      capture.state,
    );

    expect(prematureRoute.commands[0]).toMatchObject({
      output: {
        ok: false,
        error: "unconfirmed_required_fields",
        unconfirmedFields: ["email"],
      },
    });

    let confirmedState = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "I heard g at b dot com. Is that right?" },
      prematureRoute.state,
    ).state;
    confirmedState = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Yes, that's correct. Do not send it yet.",
      },
      confirmedState,
    ).state;
    confirmedState = reduceRealtimeServerEvent(
      {
        type: "response.output_audio_transcript.done",
        transcript: "Alright, let me lock that confirmation in first.",
      },
      confirmedState,
    ).state;
    const contradictedConfirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_contradicted_email",
              arguments: JSON.stringify({ evidence: "Yes, that's not correct" }),
            },
          ],
        },
      },
      confirmedState,
    );
    expect(contradictedConfirmation.commands[0]).toMatchObject({
      output: { ok: false, error: "email_confirmation_not_explicit", key: "email" },
    });

    const confirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_email",
              arguments: JSON.stringify({ evidence: "Yes, that's correct. Do not send it yet" }),
            },
          ],
        },
      },
      confirmedState,
    );
    expect(confirmation.state.emailVerification).toEqual({
      value: "g@b.com",
      source: "speech",
      status: "confirmed",
    });

    const route = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_confirmed",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      confirmation.state,
    );
    expect(route.commands).toEqual([{ type: "submit_voice", callId: "call_route_confirmed", segment: "technology" }]);
  });

  it("captures several grounded fields atomically", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_batch",
              arguments: JSON.stringify({
                fields: [
                  { key: "name", value: "Asha Lim", evidence: "Asha Lim" },
                  { key: "email", value: "asha@example.com", evidence: "asha at example dot com" },
                  { key: "message", value: "We run robotics workshops." },
                ],
              }),
            },
          ],
        },
      },
      state({
        transcript: [{ role: "user", text: "I'm Asha Lim, asha at example dot com. We run robotics workshops." }],
      }),
    );

    expect(result.state.captured).toMatchObject({
      name: "Asha Lim",
      email: "asha@example.com",
      message: "We run robotics workshops.",
    });
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, fields: [{ key: "name" }, { key: "email" }, { key: "message" }] },
    });
  });

  it("retains valid fields when one identity field in a batch is ungrounded", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_atomic_reject",
              arguments: JSON.stringify({
                fields: [
                  { key: "message", value: "A robotics workshop." },
                  { key: "email", value: "invented@example.com", evidence: "invented at example dot com" },
                ],
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "We want to run a robotics workshop." }] }),
    );

    expect(result.state.captured).toEqual({ ...emptyCapturedLead, message: "A robotics workshop." });
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: false,
        error: "partial_capture",
        fields: [{ key: "message", mode: "replace" }],
        rejectedFields: [{ index: 1 }],
        detail: { error: "ungrounded_identity_capture", key: "email" },
        retry: expect.stringContaining("only the rejected fields"),
      },
    });
  });

  it("rejects duplicate keys instead of applying ambiguous batch order", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_duplicate_batch",
              arguments: JSON.stringify({
                fields: [
                  { key: "message", value: "First." },
                  { key: "message", value: "Second.", mode: "append" },
                ],
              }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.state.captured.message).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "invalid_field_batch", detail: { error: "duplicate_field" } },
    });
  });

  it("answers factual lookup calls from the bounded local knowledge base", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "lookup_oriental",
              call_id: "call_lookup",
              arguments: JSON.stringify({ topic: "pricing", query: "full floor size" }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.state.captured).toEqual(emptyCapturedLead);
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, topic: "pricing", matches: expect.any(Array) },
    });
    expect(JSON.stringify(result.commands[0])).toContain("2,800–3,000 sq ft");
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
        emailVerification: { value: "asha@example.com", source: "typed", status: "confirmed" },
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
        emailVerification: { value: "asha@example.com", source: "typed", status: "confirmed" },
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

  it("replaces a truncated assistant caption with its complete final line", () => {
    const partial = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I'm R" },
      state(),
    ).state;
    const complete = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I'm Reka. What would you like to build?" },
      partial,
    ).state;

    expect(complete.transcript).toEqual([{ role: "assistant", text: "Hi, I'm Reka. What would you like to build?" }]);
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

  it("keeps a grounded email valid across a trailing unrelated microphone transcription", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_email_after_mic_race",
              arguments: JSON.stringify({
                fields: [
                  {
                    key: "email",
                    value: "qa.nebula@example.test",
                    evidence: "q a dot nebula at example dot test",
                  },
                ],
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is q a dot nebula at example dot test." },
          { role: "user", text: "Sorry, background audio says we can meet at 3." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("qa.nebula@example.test");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
    expect(result.commands[0]).toMatchObject({ output: { ok: true, emailConfirmationRequired: false } });
  });

  it("does not revive an older email after a newer correction", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_stale_email_after_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old at example dot com." },
          { role: "user", text: "Actually, use new at example dot com instead." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a stale email when the latest correction repeats it before the replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_stale_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, old@example.com was wrong; use new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("accepts the replacement address when the visitor says what they meant", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_corrected_email",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.com",
                evidence: "new@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, I meant new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("new@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
    expect(result.commands[0]).toMatchObject({ output: { ok: true, emailConfirmationRequired: false } });
  });

  it("does not reuse an older address after a fragment-only correction", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_fragment_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Sorry, I meant the local part should be new." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps prior email grounding across unrelated correction-like microphone text", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_unrelated_should_be",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "The meeting should be at three." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("does not confuse an address with a suffix of the corrected address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_suffix_collision",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: "Actually, I meant qa@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not confuse a spoken address with a suffix of the corrected local part", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email_suffix_collision",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a at example dot com." },
          { role: "user", text: "Actually, I meant q a at example dot com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "qa@example.com.",
    "q a at example dot com.",
  ])("does not revive a suffix address from a different latest address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_suffix_without_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a@example.com.",
    "a at example dot com.",
  ])("does not expand a different latest address into a prefixed stale address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_prefix_without_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "qa@example.com",
                evidence: "qa@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is qa@example.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "The right email is a@y.com.",
    "The right email is a at y dot com.",
  ])("lets a newer different address supersede the older exact address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_new_address",
              arguments: JSON.stringify({
                key: "email",
                value: "a@x.com",
                evidence: "a@x.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@x.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "ca",
    "au",
    "agency",
    "museum",
  ])("recognises an arbitrary valid spoken domain suffix when superseding: .%s", (suffix) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_spoken_tld",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: `a at example dot ${suffix}.` },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a at example dot c a.",
    "a at example dot a u.",
  ])("recognises a letter-spelled spoken suffix when superseding: %s", (spokenAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_spelled_tld",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: spokenAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a at proton mail dot com.",
    "a at red panda dot com.",
    "a at my company dot com.",
    "a at the edge dot io.",
    "a at our team dot org.",
  ])("recognises a naturally spoken multiword domain when superseding: %s", (spokenAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_multiword_domain",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: spokenAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps prior email grounding across an unrelated at-point phrase", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_launch_point",
              arguments: JSON.stringify({
                key: "email",
                value: "a@x.com",
                evidence: "a@x.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@x.com." },
          { role: "user", text: "We are at the launch point now." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("a@x.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it.each([
    "Meet me at the red dot on the map.",
    "Look at the blue dot near the entrance.",
  ])("keeps prior email grounding across ordinary dot-location language: %s", (backgroundTranscript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_dot_location",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: backgroundTranscript },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("treats a different address after forget as a replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_forget",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Forget old@example.com; use new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not accept an address explicitly rejected after the replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_explicitly_rejected_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Use new@example.com, not old@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not accept the trailing address rejected by instead of", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_instead_of",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Use new@example.com instead of old@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Use new@example.com rather than old@example.com.",
    "Use new at example dot com rather than old at example dot com.",
  ])("does not accept the trailing address rejected by rather than: %s", (transcript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_rather_than",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: transcript }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("recognises a contracted rejection after an address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_isnt_correct",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "old@example.com isn't correct." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a spoken address when its repeated mention retracts it", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_spoken_retraction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          {
            role: "user",
            text: "old at example dot com — no, not old at example dot com.",
          },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Actually, old@example.com, yes, old@example.com.",
    "Actually, old at example dot com, yes, old at example dot com.",
  ])("accepts a repeated address that the visitor affirms: %s", (transcript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_email_affirmation",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: transcript }] }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("orders fully spoken replacement addresses correctly", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email_replacement_order",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          {
            role: "user",
            text: "Actually, old at example dot com should be new at example dot com.",
          },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Sorry, I meant new.",
    "No, I said new.",
  ])("does not reuse an older address after the fragment correction %s", (correction) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_short_fragment",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: correction },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps email grounding across an explicitly meeting-related I meant turn", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_meeting_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Sorry, I meant Tuesday for the meeting." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("accepts either explicitly offered address without extra confirmation", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_alternative_email",
              arguments: JSON.stringify({
                key: "email",
                value: "first@example.com",
                evidence: "first@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Either first@example.com or second@example.com works." }] }),
    );

    expect(result.state.captured.email).toBe("first@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("accepts a plain or choice when either offered address works", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_plain_alternative_email",
              arguments: JSON.stringify({
                key: "email",
                value: "first@example.com",
                evidence: "first@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Actually, first@example.com or second@example.com works." }] }),
    );

    expect(result.state.captured.email).toBe("first@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
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

  it("accepts a phonetically rough name draft only behind an explicit name cue", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_rough_asr",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet", evidence: "Gurpreet" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Goodbreed." }] }),
    );

    expect(result.state.captured.name).toBe("Gurpreet");
  });

  it("rejects an unrelated same-initial name despite an explicit name cue", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_unrelated_asr",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet", evidence: "Gurpreet" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Gareth." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "name" },
    });
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
