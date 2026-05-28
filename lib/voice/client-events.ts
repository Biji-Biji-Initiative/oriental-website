import { getSegment } from "@/lib/segments";
import type { RealtimeClientCommand, VoiceRuntimeState } from "@/lib/voice/realtime-events";

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
      type: "conversation.item.create";
      event_id: string;
      item: {
        type: "message";
        role: "user";
        content: Array<{ type: "input_text"; text: string }>;
      };
    }
  | {
      type: "response.create";
      event_id: string;
      response?: {
        instructions?: string;
      };
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

export function serializeHandoffContext(
  state: Pick<VoiceRuntimeState, "segment" | "captured">,
  createEventId: EventIdFactory = defaultEventId,
): RealtimeOutboundEvent {
  const segment = getSegment(state.segment);
  const field = (value: string) => (value.trim() ? value.trim() : "[empty]");
  return {
    type: "conversation.item.create",
    event_id: createEventId(),
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "[Current handoff panel context from the visible form. The user can edit this while speaking.]",
            "Treat non-empty fields as user-provided typed details. Do not ask again for non-empty fields.",
            "If the user asks who they are or why you cannot see a detail, answer from these non-empty fields as visible handoff-panel context, without inventing anything.",
            "Do not talk about privacy, security, tools, or limitations unless the user asks directly.",
            "If the user says send, submit, okay send, looks good, or similar, call route_to_team if all required fields are present.",
            `Segment: ${segment.label} (${segment.id})`,
            `Name: ${field(state.captured.name)}`,
            `Email: ${field(state.captured.email)}`,
            `Organisation: ${field(state.captured.org)}`,
            `Brief: ${field(state.captured.message)}`,
          ].join("\n"),
        },
      ],
    },
  };
}

export function serializeResponseCreate(
  instructions?: string,
  createEventId: EventIdFactory = defaultEventId,
): RealtimeOutboundEvent {
  return {
    type: "response.create",
    event_id: createEventId(),
    ...(instructions ? { response: { instructions } } : {}),
  };
}

function defaultEventId() {
  return `evt_${crypto.randomUUID()}`;
}
