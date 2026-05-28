import { describe, expect, it } from "vitest";
import { serializeHandoffContext, serializeRealtimeCommand, serializeResponseCreate } from "@/lib/voice/client-events";

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
        segment: "ai",
        captured: {
          name: "Mei Ling",
          email: "mei@example.com",
          org: "Future Lab",
          message: "AI literacy demos for students.",
        },
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
    expect(body).toContain("Brief: AI literacy demos for students.");
  });

  it("serializes a response.create event with optional per-response instructions", () => {
    expect(serializeResponseCreate("Start as Reka.", nextEventId(["evt_response"]))).toEqual({
      type: "response.create",
      event_id: "evt_response",
      response: { instructions: "Start as Reka." },
    });
  });
});

function nextEventId(ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `evt_${index}`;
}
