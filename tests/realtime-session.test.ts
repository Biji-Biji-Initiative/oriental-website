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
    step({ type: "input_audio_buffer.committed" });
    step({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "We run AI literacy workshops and want a demo lab.",
    });
    step({ type: "response.created" });
    step(
      functionCall("call_brief", "capture_field", {
        key: "message",
        value: "AI literacy workshops; wants a demo lab.",
      }),
    );
    step(functionCall("call_segment", "set_partner_type", { segment: "ai" }));
    expect(state.segment).toBe("ai");
    expect(state.captured.message).toContain("AI literacy");

    // The transcription race: the visitor says their name and email, the
    // model captures BEFORE the transcription completes.
    step({ type: "input_audio_buffer.committed" });
    step(functionCall("call_name", "capture_field", { key: "name", value: "Asha Lim", evidence: "Asha Lim" }));
    expect(state.captured.name).toBe("Asha Lim");
    step({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "My name is Asha Lim.",
    });
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
    const route = step(functionCall("call_route", "route_to_team", { segment: "ai" }));
    expect(state.routeRequested).toBe(true);
    expect(route.commands).toEqual([{ type: "submit_voice", callId: "call_route", segment: "ai" }]);

    // A duplicate route attempt is refused without a second submission.
    const duplicate = step(functionCall("call_route_again", "route_to_team", { segment: "ai" }));
    expect(duplicate.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "route_already_requested" },
    });

    expect(allCommands.filter((type) => type === "submit_voice")).toHaveLength(1);
    expect(state.transcript.map((entry) => entry.role)).toEqual(["assistant", "user", "user", "user"]);
  });
});
