import { describe, expect, it } from "vitest";
import {
  serializeHandoffContext,
  serializeInputPolicyUpdate,
  serializeRealtimeCommand,
  serializeResponseCreate,
  serializeTypedInterruption,
  serializeTypedTurn,
  serializeUserText,
} from "@/lib/voice/client-events";

describe("serializeRealtimeCommand", () => {
  it("serializes function call output with event ids and optional response creation", () => {
    const events = serializeRealtimeCommand(
      {
        type: "function_result",
        callId: "call_1",
        createResponse: true,
        output: { ok: true, submitted: true },
      },
      nextEventId(["evt_output", "evt_response"]),
    );

    expect(events).toEqual([
      {
        type: "conversation.item.create",
        event_id: "evt_output",
        item: {
          type: "function_call_output",
          call_id: "call_1",
          output: JSON.stringify({ ok: true, submitted: true }),
        },
      },
      { type: "response.create", event_id: "evt_response" },
    ]);
  });

  it("can return tool output without asking the model to speak", () => {
    const events = serializeRealtimeCommand(
      {
        type: "function_result",
        callId: "call_wait",
        createResponse: false,
        output: { ok: true, waited: true },
      },
      nextEventId(["evt_output"]),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("conversation.item.create");
  });

  it("serializes typed handoff context as a user conversation item", () => {
    const event = serializeHandoffContext(
      {
        segment: "technology",
        captured: {
          name: "Mei Ling",
          email: "mei@example.com",
          org: "Future Lab",
          phone: "",
          website: "",
          message: "AI literacy demos for students.",
        },
        emailVerification: { value: "mei@example.com", source: "typed", status: "confirmed" },
      },
      nextEventId(["evt_context"]),
    );

    expect(event).toMatchObject({
      type: "conversation.item.create",
      event_id: "evt_context",
      item: {
        type: "message",
        role: "user",
      },
    });
    const body = JSON.stringify(event);
    expect(body).toContain("Treat non-empty fields as user-provided typed details");
    expect(body).toContain("Name: Mei Ling");
    expect(body).toContain("Email: mei@example.com");
    expect(body).toContain("Email verification: confirmed (typed)");
    expect(body).toContain("Brief: AI literacy demos for students.");
  });

  it("tells Reka when a speech email still needs an exact read-back", () => {
    const event = serializeHandoffContext({
      segment: "technology",
      captured: { name: "", email: "g@b.com", org: "", phone: "", website: "", message: "" },
      emailCaptureMode: "strict",
      emailVerification: { value: "g@b.com", source: "speech", status: "pending" },
    });

    const body = JSON.stringify(event);
    expect(body).toContain("Email verification: awaiting exact spoken confirmation");
    expect(body).toContain("Never route an unconfirmed email");
  });

  it("tells adaptive sessions to continue after a grounded speech capture", () => {
    const event = serializeHandoffContext({
      segment: "technology",
      captured: { name: "", email: "g@b.com", org: "", phone: "", website: "", message: "" },
      emailCaptureMode: "adaptive",
      emailVerification: {
        value: "g@b.com",
        source: "speech",
        status: "confirmed",
        confidence: "medium",
      },
    });

    const body = JSON.stringify(event);
    expect(body).toContain("continue without asking for a separate yes");
    expect(body).toContain("Email verification: confirmed (speech)");
    expect(body).not.toContain("Never route an unconfirmed email");
  });

  it("serializes a typed visitor message as a user conversation item", () => {
    expect(serializeUserText("My email is mei@example.com", nextEventId(["evt_text"]))).toEqual({
      type: "conversation.item.create",
      event_id: "evt_text",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "My email is mei@example.com" }],
      },
    });
  });

  it("includes the earlier conversation when a session reconnects", () => {
    const event = serializeHandoffContext(
      {
        segment: "technology",
        captured: { name: "Mei Ling", email: "", org: "", phone: "", website: "", message: "" },
      },
      nextEventId(["evt_context"]),
      {
        resumedTranscript: [
          { role: "assistant", text: "What would you like to build?" },
          { role: "user", text: "An AI literacy lab for students." },
        ],
      },
    );

    const body = JSON.stringify(event);
    expect(body).toContain("Earlier conversation before this voice session reconnected");
    expect(body).toContain("Reka: What would you like to build?");
    expect(body).toContain("User: An AI literacy lab for students.");
    expect(body).toContain("Do not repeat the opening pitch");
  });

  it("omits the reconnect context block for fresh sessions", () => {
    const event = serializeHandoffContext({
      segment: "technology",
      captured: { name: "", email: "", org: "", phone: "", website: "", message: "" },
    });

    expect(JSON.stringify(event)).not.toContain("Earlier conversation");
  });

  it("serializes a typed interruption as cancel plus audio clear", () => {
    expect(serializeTypedInterruption(nextEventId(["evt_cancel", "evt_clear"]))).toEqual([
      { type: "response.cancel", event_id: "evt_cancel" },
      { type: "output_audio_buffer.clear", event_id: "evt_clear" },
    ]);
  });

  it("serializes a typed turn as cancel, clear, text, then response", () => {
    expect(
      serializeTypedTurn("My email is mei@example.com", nextEventId(["cancel", "clear", "text", "response"])),
    ).toEqual([
      { type: "response.cancel", event_id: "cancel" },
      { type: "output_audio_buffer.clear", event_id: "clear" },
      {
        type: "conversation.item.create",
        event_id: "text",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "My email is mei@example.com" }],
        },
      },
      { type: "response.create", event_id: "response" },
    ]);
  });

  it("serializes a response.create event with optional per-response instructions", () => {
    expect(serializeResponseCreate("Start as Reka.", nextEventId(["evt_response"]))).toEqual({
      type: "response.create",
      event_id: "evt_response",
      response: { instructions: "Start as Reka." },
    });
  });

  it("serializes a scoped session.update for deterministic VAD changes", () => {
    expect(
      serializeInputPolicyUpdate(
        "patient",
        { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true },
        nextEventId(["evt_policy"]),
      ),
    ).toEqual({
      type: "session.update",
      event_id: "evt_policy",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "low",
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
  });
});

function nextEventId(ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `evt_${index}`;
}
