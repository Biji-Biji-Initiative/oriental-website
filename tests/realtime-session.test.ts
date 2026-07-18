import { describe, expect, it } from "vitest";
import {
  appendTypedUserMessage,
  emptyCapturedLead,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";

/**
 * Golden-session replay: one realistic conversation streamed end-to-end
 * through the reducer, exercising the interactions BETWEEN features —
 * captions, the transcription race, typed messages, grounding, and routing —
 * that single-behavior unit tests cannot catch.
 */

function functionCall(callId: string, name: string, args: Record<string, unknown>): RealtimeServerEvent {
  return {
    type: "response.done",
    response: {
      output: [{ type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) }],
    },
  };
}

describe("golden voice session", () => {
  it("carries a full conversation from greeting to routed submission", () => {
    let state: VoiceRuntimeState = { segment: "technology", captured: emptyCapturedLead, transcript: [] };
    const allCommands: string[] = [];
    const step = (event: RealtimeServerEvent) => {
      const result = reduceRealtimeServerEvent(event, state);
      state = result.state;
      allCommands.push(...result.commands.map((command) => command.type));
      return result;
    };

    // Reka greets — captions stream, then settle into the transcript.
    step({ type: "response.created" });
    step({ type: "response.output_audio_transcript.delta", delta: "Hi, I’m Reka. " });
    expect(state.assistantDraft).toBe("Hi, I’m Reka. ");
    step({ type: "response.output_audio_transcript.delta", delta: "What would you like to build?" });
    step({ type: "response.output_audio_transcript.done", transcript: "Hi, I’m Reka. What would you like to build?" });
    expect(state.assistantDraft).toBe("");
    step({ type: "response.done" });

    // Visitor explains their idea; the model captures the brief and segment.
    step({ type: "input_audio_buffer.committed", item_id: "audio_brief" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "audio_brief",
      transcript: "We run AI literacy workshops and want a demo lab.",
    });
    step({ type: "response.created" });
    step(
      functionCall("call_brief", "capture_field", {
        key: "message",
        value: "AI literacy workshops; wants a demo lab.",
      }),
    );
    step(functionCall("call_segment", "set_partner_type", { segment: "technology" }));
    expect(state.segment).toBe("technology");
    expect(state.captured.message).toContain("AI literacy");

    // The visitor supplies their name; settled ASR is the current authority
    // for the model's subsequent capture.
    step({ type: "input_audio_buffer.committed", item_id: "audio_contact" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "audio_contact",
      transcript: "My name is Asha Lim.",
    });
    step(functionCall("call_name", "capture_field", { key: "name", value: "Asha Lim", evidence: "Asha Lim" }));
    expect(state.captured.name).toBe("Asha Lim");
    expect(state.pendingUserTranscripts).toBe(0);

    // The visitor types their email into the live chat instead of spelling it.
    state = appendTypedUserMessage(state, "Email is asha@futurelab.my and I’m with Future Lab.");
    step(
      functionCall("call_email", "capture_field", {
        key: "email",
        value: "asha@futurelab.my",
        evidence: "asha@futurelab.my",
      }),
    );
    step(functionCall("call_org", "capture_field", { key: "org", value: "Future Lab", evidence: "Future Lab" }));
    expect(state.captured.email).toBe("asha@futurelab.my");
    expect(state.captured.org).toBe("Future Lab");

    // The visitor interrupts Reka mid-sentence; the caption is discarded.
    step({ type: "response.created" });
    step({ type: "response.output_audio_transcript.delta", delta: "Let me tell you about the dem" });
    step({ type: "response.done" });
    expect(state.assistantDraft).toBe("");

    // "Send it" — all fields present, the reducer hands the UI a submit command.
    state = appendTypedUserMessage(state, "Please send it.");
    const route = step(functionCall("call_route", "route_to_team", { segment: "technology" }));
    expect(state.routeRequested).toBe(true);
    expect(route.commands).toEqual([{ type: "submit_voice", callId: "call_route", segment: "technology" }]);

    // A duplicate route attempt is refused without a second submission.
    const duplicate = step(functionCall("call_route_again", "route_to_team", { segment: "technology" }));
    expect(duplicate.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "route_already_requested" },
    });

    expect(allCommands.filter((type) => type === "submit_voice")).toHaveLength(1);
    expect(state.transcript.map((entry) => entry.role)).toEqual(["assistant", "user", "user", "user", "user"]);
  });

  it("recovers an ASR-drifted contact turn and routes only after exact email confirmation", () => {
    let runtime: VoiceRuntimeState = { segment: "technology", captured: emptyCapturedLead, transcript: [] };
    const step = (event: RealtimeServerEvent) => {
      const result = reduceRealtimeServerEvent(event, runtime);
      runtime = result.state;
      return result;
    };

    step({ type: "input_audio_buffer.committed", item_id: "audio_drifted_contact" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "audio_drifted_contact",
      transcript:
        "My name is Goodbreed and my email is asia dot lim at example dot my. We want to run digital-skills workshops.",
    });
    const captured = step(
      functionCall("call_contact_drift", "capture_fields", {
        fields: [
          { key: "name", value: "Gurpreet", evidence: "Gurpreet" },
          {
            key: "email",
            value: "asha.lim@example.my",
            evidence: "asha dot lim at example dot my",
          },
          { key: "message", value: "Run digital-skills workshops." },
        ],
      }),
    );

    expect(captured.commands[0]).toMatchObject({
      output: {
        ok: true,
        emailConfirmationRequired: true,
        emailReadback: "asha dot lim at example dot my",
      },
    });
    expect(runtime.captured).toMatchObject({
      name: "Gurpreet",
      email: "asha.lim@example.my",
      message: "Run digital-skills workshops.",
    });

    step({
      type: "response.output_audio_transcript.done",
      transcript: "I have asha dot lim at example dot my. Is that exactly right?",
    });
    step({ type: "input_audio_buffer.committed", item_id: "audio_confirm_drifted_contact" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "audio_confirm_drifted_contact",
      transcript: "Yes, that's exactly right.",
    });
    step(
      functionCall("call_confirm_drifted_email", "confirm_email", {
        evidence: "Yes, that's exactly right.",
      }),
    );
    expect(runtime.emailVerification?.status).toBe("confirmed");

    runtime = appendTypedUserMessage(runtime, "Please send it.");
    const routed = step(functionCall("call_route_drifted_contact", "route_to_team", { segment: "education" }));
    expect(routed.commands).toEqual([
      { type: "submit_voice", callId: "call_route_drifted_contact", segment: "education" },
    ]);
  });

  it("finishes the adaptive happy path in one fewer visitor turn", () => {
    let runtime: VoiceRuntimeState = { segment: "technology", captured: emptyCapturedLead, transcript: [] };
    const step = (event: RealtimeServerEvent) => {
      const result = reduceRealtimeServerEvent({ ...event, email_capture_mode: "adaptive" }, runtime);
      runtime = result.state;
      return result;
    };

    step({ type: "input_audio_buffer.committed", item_id: "audio_adaptive_contact" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "audio_adaptive_contact",
      transcript: "My email is asha dot lim at example dot my and we run digital skills workshops. Please send it.",
    });
    const captured = step(
      functionCall("call_adaptive_contact", "capture_fields", {
        fields: [
          { key: "email", value: "asha.lim@example.my", evidence: "asha dot lim at example dot my" },
          { key: "message", value: "Run digital-skills workshops." },
        ],
      }),
    );

    expect(captured.commands[0]).toMatchObject({
      output: { ok: true, emailConfirmationRequired: false, emailCaptureMode: "adaptive" },
    });
    expect(runtime.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });

    const routed = step(functionCall("call_adaptive_route", "route_to_team", { segment: "technology" }));
    expect(routed.commands).toEqual([{ type: "submit_voice", callId: "call_adaptive_route", segment: "technology" }]);
    expect(runtime.transcript.filter((entry) => entry.role === "user")).toHaveLength(1);
  });
});
