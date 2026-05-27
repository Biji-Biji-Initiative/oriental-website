import type { RealtimeClientCommand } from "@/lib/voice/realtime-events";

export type RealtimeOutboundEvent =
  | {
      type: "conversation.item.create";
      event_id: string;
      item: {
        type: "function_call_output";
        call_id: string;
        output: string;
      };
    }
  | {
      type: "response.create";
      event_id: string;
    };

type EventIdFactory = () => string;

export function serializeRealtimeCommand(
  command: Extract<RealtimeClientCommand, { type: "function_result" }>,
  createEventId: EventIdFactory = defaultEventId,
): RealtimeOutboundEvent[] {
  const outputEventId = createEventId();
  const events: RealtimeOutboundEvent[] = [
    {
      type: "conversation.item.create",
      event_id: outputEventId,
      item: {
        type: "function_call_output",
        call_id: command.callId,
        output: JSON.stringify(command.output),
      },
    },
  ];

  if (command.createResponse) {
    events.push({ type: "response.create", event_id: createEventId() });
  }

  return events;
}

function defaultEventId() {
  return `evt_${crypto.randomUUID()}`;
}
