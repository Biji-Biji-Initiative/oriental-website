import { describe, expect, it } from "vitest";
import { serializeRealtimeCommand } from "@/lib/voice/client-events";

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
});

function nextEventId(ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `evt_${index}`;
}
