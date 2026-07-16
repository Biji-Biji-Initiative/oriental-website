import { getSegment } from "@/lib/segments";
import type { VoiceInputPolicy } from "@/lib/voice/latency";
import type { VoiceTurnDetection } from "@/lib/voice/profile";
import type { RealtimeClientCommand, VoiceRuntimeState, VoiceTranscriptEntry } from "@/lib/voice/realtime-events";

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
    }
  | { type: "response.cancel"; event_id: string }
  | { type: "output_audio_buffer.clear"; event_id: string }
  | {
      type: "session.update";
      event_id: string;
      session: {
        type: "realtime";
        audio: { input: { turn_detection: VoiceTurnDetection } };
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

/**
 * Stop the in-flight assistant response and clear queued WebRTC audio so a
 * typed message interrupts Reka the same way speech does.
 */
export function serializeTypedInterruption(createEventId: EventIdFactory = defaultEventId): RealtimeOutboundEvent[] {
  return [
    { type: "response.cancel", event_id: createEventId() },
    { type: "output_audio_buffer.clear", event_id: createEventId() },
  ];
}

/**
 * A typed turn always supersedes any queued speech. Cancelling unconditionally
 * also closes the tiny opener race before response.created reaches the client.
 */
export function serializeTypedTurn(
  text: string,
  createEventId: EventIdFactory = defaultEventId,
): RealtimeOutboundEvent[] {
  return [
    ...serializeTypedInterruption(createEventId),
    serializeUserText(text, createEventId),
    serializeResponseCreate(undefined, createEventId),
  ];
}

export function serializeUserText(text: string, createEventId: EventIdFactory = defaultEventId): RealtimeOutboundEvent {
  return {
    type: "conversation.item.create",
    event_id: createEventId(),
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  };
}

export function serializeHandoffContext(
  state: Pick<VoiceRuntimeState, "segment" | "captured"> &
    Partial<Pick<VoiceRuntimeState, "emailVerification" | "emailCaptureMode">>,
  createEventId: EventIdFactory = defaultEventId,
  options: { resumedTranscript?: VoiceTranscriptEntry[] } = {},
): RealtimeOutboundEvent {
  const segment = getSegment(state.segment);
  const field = (value: string) => (value.trim() ? value.trim() : "[empty]");
  const emailStatus = state.captured.email.trim()
    ? state.emailVerification?.status === "confirmed" &&
      state.emailVerification.value.trim().toLowerCase() === state.captured.email.trim().toLowerCase()
      ? `confirmed (${state.emailVerification.source})`
      : "awaiting exact spoken confirmation"
    : "missing";
  const resumed = options.resumedTranscript ?? [];
  const emailPolicy =
    state.emailCaptureMode === "adaptive"
      ? "A grounded speech email marked confirmed is immediately usable. It is visible and editable; continue without asking for a separate yes. Clarify only a rejected or corrected address."
      : state.emailCaptureMode === "strict"
        ? "A speech-captured email marked awaiting confirmation is a draft. Read it back exactly, ask if it is correct, then call confirm_email only after a clear yes. Never route an unconfirmed email."
        : null;
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
            ...(emailPolicy ? [emailPolicy] : []),
            "If the user says send, submit, okay send, looks good, or similar, call route_to_team when the email status is confirmed.",
            `Segment: ${segment.label} (${segment.id})`,
            `Name: ${field(state.captured.name)}`,
            `Email: ${field(state.captured.email)}`,
            `Email verification: ${emailStatus}`,
            `Organisation: ${field(state.captured.org)}`,
            `Brief: ${field(state.captured.message)}`,
            ...(resumed.length > 0
              ? [
                  "",
                  "[Earlier conversation before this voice session reconnected:]",
                  ...resumed.map((entry) => `${entry.role === "assistant" ? "Reka" : "User"}: ${entry.text}`),
                  "Continue from this context. Do not repeat the opening pitch and do not re-ask anything already answered.",
                ]
              : []),
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

export function serializeInputPolicyUpdate(
  _policy: VoiceInputPolicy,
  turnDetection: VoiceTurnDetection,
  createEventId: EventIdFactory = defaultEventId,
): RealtimeOutboundEvent {
  return {
    type: "session.update",
    event_id: createEventId(),
    session: {
      type: "realtime",
      audio: { input: { turn_detection: turnDetection } },
    },
  };
}

function defaultEventId() {
  return `evt_${crypto.randomUUID()}`;
}
