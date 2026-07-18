// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  advanceRuntimeInputAttribution,
  type RuntimeInputAttribution,
  useVoiceRuntime,
} from "@/components/voice-agent/useVoiceRuntime";
import { serializeTypedTurn } from "@/lib/voice/client-events";
import { summarizeFieldProvenance } from "@/lib/voice/interaction-attribution";

function advance(state: RuntimeInputAttribution, eventType: string | undefined) {
  return advanceRuntimeInputAttribution(state, eventType);
}

describe("voice runtime input attribution", () => {
  it("attributes an audio-committed tool call to voice before transcription arrives", () => {
    let state: RuntimeInputAttribution = { latest: "chat" };
    ({ state } = advance(state, "input_audio_buffer.committed"));
    ({ state } = advance(state, "response.created"));
    const completed = advance(state, "response.done");

    expect(completed.input).toBe("voice");
    expect(completed.state).toEqual({ latest: "voice" });
  });

  it("keeps a response bound to chat when a later audio turn commits before it settles", () => {
    let state: RuntimeInputAttribution = { latest: "chat" };
    ({ state } = advance(state, "response.created"));
    ({ state } = advance(state, "input_audio_buffer.committed"));
    const completed = advance(state, "response.done");

    expect(completed.input).toBe("chat");
    expect(completed.state).toEqual({ latest: "voice" });
  });

  it("uses the latest modality when a provider omits response.created", () => {
    const completed = advance({ latest: "chat" }, "response.done");
    expect(completed.input).toBe("chat");
  });

  it("counts each form focus session once and recognizes a later form correction", () => {
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.beginCapturedEdit("email");
      result.current.updateCaptured("email", "a");
      result.current.updateCaptured("email", "as");
      result.current.updateCaptured("email", "asha@example.com");
      result.current.endCapturedEdit("email");
    });
    expect(
      summarizeFieldProvenance(
        result.current.stateRef.current.captured,
        result.current.stateRef.current.fieldProvenance,
      ).email,
    ).toMatchObject({ editCount: 1, correctionCount: 0 });

    act(() => {
      result.current.beginCapturedEdit("email");
      result.current.updateCaptured("email", "asha+team@example.com");
      result.current.endCapturedEdit("email");
    });
    expect(
      summarizeFieldProvenance(
        result.current.stateRef.current.captured,
        result.current.stateRef.current.fieldProvenance,
      ).email,
    ).toMatchObject({ method: "form", editCount: 2, correctionCount: 1 });
  });

  it("revokes browser handoff memory only after an accepted current clear-all", () => {
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.updateCaptured("email", "new@example.com");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_stale_runtime_clear",
                arguments: JSON.stringify({ scope: "all" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(onClearFields).not.toHaveBeenCalled();
    expect(result.current.stateRef.current.captured.email).toBe("new@example.com");

    act(() => {
      result.current.appendUserText("Clear all fields.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_current_runtime_clear",
                arguments: JSON.stringify({ scope: "all" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(onClearFields).toHaveBeenCalledTimes(1);
    expect(result.current.stateRef.current.captured.email).toBe("");
  });

  it("lets every newer form or chat action supersede destructive response tools", () => {
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 11 111 1111");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.updateCaptured("phone", "+60 12 222 2222");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_field",
                call_id: "call_stale_phone_clear",
                arguments: JSON.stringify({ key: "phone" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.captured.phone).toBe("+60 12 222 2222");

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.updateCaptured("name", "Asha Lim");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_stale_form_clear_all",
                arguments: JSON.stringify({ scope: "all" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.captured).toMatchObject({
      name: "Asha Lim",
      phone: "+60 12 222 2222",
    });

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.appendUserText("The workshop should be accessible.");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_stale_chat_clear_all",
                arguments: JSON.stringify({ scope: "all" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.transcript).toContainEqual({
      role: "user",
      text: "The workshop should be accessible.",
    });
    expect(result.current.stateRef.current.captured.name).toBe("Asha Lim");
    expect(onClearFields).not.toHaveBeenCalled();
  });

  it("resolves every clear-all sibling before creating exactly one follow-up response", () => {
    const onClearFields = vi.fn();
    const send = vi.fn();
    const channel = { readyState: "open", send } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 11 111 1111");
      result.current.appendUserText("Clear all fields.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_runtime_terminal_clear",
                arguments: JSON.stringify({ scope: "all" }),
              },
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_runtime_discarded_sibling",
                arguments: JSON.stringify({ key: "phone", value: "+60 12 222 2222" }),
              },
            ],
          },
        },
        channel,
      );
    });

    const events = send.mock.calls.map(([payload]) => JSON.parse(String(payload)) as { type: string });
    expect(events.filter((event) => event.type === "conversation.item.create")).toHaveLength(2);
    expect(events.filter((event) => event.type === "response.create")).toHaveLength(1);
    expect(result.current.stateRef.current.handledCallIds).toEqual([
      "call_runtime_terminal_clear",
      "call_runtime_discarded_sibling",
    ]);
    expect(result.current.stateRef.current.captured).toMatchObject({ phone: "" });
    expect(onClearFields).toHaveBeenCalledTimes(1);

    const sentBeforeReplay = send.mock.calls.length;
    act(() => {
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_runtime_discarded_sibling",
                arguments: JSON.stringify({ key: "phone", value: "+60 12 222 2222" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(send).toHaveBeenCalledTimes(sentBeforeReplay);
    expect(result.current.stateRef.current.captured.phone).toBe("");
  });

  it("fences every stale mutating tool after newer form, segment, or chat authority", () => {
    const onEndVoice = vi.fn();
    const onClearFields = vi.fn();
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead,
        onEndVoice,
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 USER EDIT");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.updateCaptured("phone", "+60 NEW USER EDIT");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_stale_phone_capture",
                arguments: JSON.stringify({ key: "phone", value: "+60 OLD MODEL" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.captured.phone).toBe("+60 NEW USER EDIT");

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.updateCaptured("name", "Current User");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_fields",
                call_id: "call_stale_batch_capture",
                arguments: JSON.stringify({
                  fields: [
                    { key: "name", value: "Old Model" },
                    { key: "phone", value: "+60 OLD MODEL" },
                  ],
                }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.captured).toMatchObject({
      name: "Current User",
      phone: "+60 NEW USER EDIT",
    });

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.setSegment("technology");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "set_partner_type",
                call_id: "call_stale_partner_type",
                arguments: JSON.stringify({ segment: "education" }),
              },
              {
                type: "function_call",
                name: "clear_fields",
                call_id: "call_stale_clear_after_segment",
                arguments: JSON.stringify({ scope: "all" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.segment).toBe("technology");
    expect(result.current.stateRef.current.captured.phone).toBe("+60 NEW USER EDIT");
    expect(onClearFields).not.toHaveBeenCalled();

    act(() => {
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.appendUserText("Actually, keep talking.");
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "end_call",
                call_id: "call_stale_end",
                arguments: JSON.stringify({ reason: "user_done" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(onEndVoice).not.toHaveBeenCalled();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it("does not let a delayed response.created bless an earlier form or picker snapshot", () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.setSegment("education");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_route_from_pre_picker_snapshot",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.segment).toBe("education");
    expect(result.current.stateRef.current.routeRequested).toBeFalsy();
    expect(submitLead).not.toHaveBeenCalled();

    act(() => {
      result.current.appendUserText("My name is Alice.");
      result.current.updateCaptured("name", "Bob");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_capture_from_pre_form_snapshot",
                arguments: JSON.stringify({ key: "name", value: "Alice", evidence: "Alice" }),
              },
            ],
          },
        },
        channel,
      );
    });
    expect(result.current.stateRef.current.captured.name).toBe("Bob");
  });

  it("lets a newly serialized typed turn own its response after an unrelated form edit", () => {
    const send = vi.fn();
    const channel = { readyState: "open", send } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 12 345 6789");
      for (const event of serializeTypedTurn("Please note wheelchair access.")) {
        channel.send(JSON.stringify(event));
      }
      result.current.appendUserText("Please note wheelchair access.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_typed_after_form_edit",
                arguments: JSON.stringify({
                  key: "message",
                  value: "Wheelchair access is required.",
                }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured).toMatchObject({
      phone: "+60 12 345 6789",
      message: "Wheelchair access is required.",
    });
  });

  it("keeps local authority through read-only follow-ups until a new user turn", () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.setSegment("education");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "lookup_oriental",
                call_id: "call_lookup_from_pre_picker_snapshot",
                arguments: JSON.stringify({ query: "workshops" }),
              },
            ],
          },
        },
        channel,
      );
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_route_after_stale_lookup",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.segment).toBe("education");
    expect(result.current.stateRef.current.routeRequested).toBeFalsy();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it("routes fresh speech with local form and picker values without restoring stale captures", async () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.appendUserText("My name is Alice.");
      result.current.updateCaptured("name", "Bob");
      result.current.setSegment("education");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.speech_started", item_id: "audio_send_after_local_edits" },
        channel,
      );
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: "audio_send_after_local_edits" },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "audio_send_after_local_edits",
          transcript: "Send it.",
        },
        channel,
      );
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_restore_old_name_after_local_edit",
                arguments: JSON.stringify({ key: "name", value: "Alice", evidence: "Alice" }),
              },
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_route_after_local_edits",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
      await Promise.resolve();
    });

    expect(result.current.stateRef.current.captured.name).toBe("Bob");
    expect(result.current.stateRef.current.segment).toBe("education");
    expect(submitLead).toHaveBeenCalledWith(
      expect.objectContaining({ segment: "education", captured: expect.objectContaining({ name: "Bob" }) }),
    );
  });

  it("requires every post-edit mutation and route to be supported by the post-edit turn", () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.appendUserText("My name is Alice.");
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.setSegment("education");
      for (const event of serializeTypedTurn("Please note wheelchair access.")) {
        channel.send(JSON.stringify(event));
      }
      result.current.appendUserText("Please note wheelchair access.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_fields",
                call_id: "call_old_message_with_generic_evidence",
                arguments: JSON.stringify({
                  fields: [
                    {
                      key: "message",
                      value: "We need a robotics lab for children.",
                      evidence: "please",
                    },
                  ],
                }),
              },
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_old_unrelated_name_after_typed_turn",
                arguments: JSON.stringify({ key: "name", value: "Alice", evidence: "Alice" }),
              },
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_old_route_after_typed_turn",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured).toMatchObject({
      name: "",
      phone: "+60 12 345 6789",
      message: "",
    });
    expect(result.current.stateRef.current.segment).toBe("education");
    expect(result.current.stateRef.current.routeRequested).toBeFalsy();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it.each([
    ["Do not clear my name.", "clear_field", { key: "name" }],
    ["I do not want you to clear my name.", "clear_field", { key: "name" }],
    ["Do not clear all fields.", "clear_fields", { scope: "all" }],
    ["I said not to clear all fields.", "clear_fields", { scope: "all" }],
    ["How do I clear all fields?", "clear_fields", { scope: "all" }],
    ["Clear my name tomorrow.", "clear_field", { key: "name" }],
    ["Clear my name would be a bad idea.", "clear_field", { key: "name" }],
    ["Clear my name? No.", "clear_field", { key: "name" }],
    ["Do not end the call.", "end_call", { reason: "user_done" }],
    ["I don't want to end the call.", "end_call", { reason: "user_done" }],
    ["I am not done talking.", "end_call", { reason: "user_done" }],
    ["No thanks.", "end_call", { reason: "user_done" }],
  ])("does not invert a negated post-edit instruction: %s", (instruction, toolName, args) => {
    const onEndVoice = vi.fn();
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "education",
        prefillEmail: "ready@example.com",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice,
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: toolName,
                call_id: `call_negated_${toolName}`,
                arguments: JSON.stringify(args),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.name).toBe("Bob");
    expect(onClearFields).not.toHaveBeenCalled();
    expect(onEndVoice).not.toHaveBeenCalled();
  });

  it.each([
    "I do not want you to send it.",
    "Should we send it?",
    "I will send it later.",
    "Can you send me the venue address?",
  ])("does not route on a non-affirmative post-edit send mention: %s", (instruction) => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "education",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: `call_non_affirmative_route_${instruction.length}`,
                arguments: JSON.stringify({ segment: "education" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.routeRequested).toBeFalsy();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it.each([
    ["phone", "+60 12 999 8888", "Do not use +60 12 999 8888."],
    ["website", "example.com", "Do not use example.com."],
    ["message", "Wheelchair access is required.", "We do not need wheelchair access."],
  ] as const)("does not invert a negated post-edit %s capture", (key, value, instruction) => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 11 111 1111");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: `call_negated_free_${key}`,
                arguments: JSON.stringify({ key, value }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured[key]).toBe(key === "phone" ? "+60 11 111 1111" : "");
  });

  it("does not reclassify the segment from pre-edit evidence after an unrelated turn", () => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.appendUserText("We are a technology startup.");
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.appendUserText("Please note wheelchair access.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "set_partner_type",
                call_id: "call_old_segment_after_local_edit",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.segment).toBe("other");
  });

  it.each([
    ["We are not a school; we are a technology startup.", "technology"],
    ["We are technology, not education.", "technology"],
  ] as const)("scopes post-edit segment negation to the requested cue: %s", (instruction, segment) => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "set_partner_type",
                call_id: `call_target_segment_${instruction.length}`,
                arguments: JSON.stringify({ segment }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.segment).toBe(segment);
  });

  it.each([
    "Can you please send it?",
    "I want you to send it.",
    "Send it.",
  ])("accepts an explicit post-edit route request: %s", async (instruction) => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "education",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.appendUserText(instruction);
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_repeat_send_${instruction.length}` },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `audio_repeat_send_${instruction.length}`,
          transcript: instruction,
        },
        channel,
      );
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: `call_explicit_route_${instruction.length}`,
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
      await Promise.resolve();
    });

    expect(submitLead).toHaveBeenCalledWith(expect.objectContaining({ segment: "education" }));
  });

  it.each([
    "Can you please end the call?",
    "I want to end the call.",
    "I would like to end the call.",
    "End voice.",
    "Stop voice.",
  ])("accepts an explicit post-edit end request: %s", (instruction) => {
    const onEndVoice = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice,
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "end_call",
                call_id: `call_explicit_end_${instruction.length}`,
                arguments: JSON.stringify({ reason: "user_done" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(onEndVoice).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["phone", "+60 12 777 8888", "No need for a website. My phone is +60 12 777 8888.", true],
    ["message", "We need a venue without stairs.", "We need a venue without stairs.", true],
    ["phone", "+60 12 999 8888", "That number is not mine: +60 12 999 8888.", false],
    ["website", "example.com", "example.com is not our website.", false],
    ["website", "old.example.com", "Use new.example.com, not old.example.com.", false],
    ["website", "new.example.com", "Use old.example.com, not old.example.com. Use new.example.com.", true],
    ["phone", "+60 12 222 2222", "My new number is +60 12 111 1111, not +60 12 222 2222.", false],
    ["phone", "+60 12 111 1111", "My new number is +60 12 111 1111, not +60 12 222 2222.", true],
    ["message", "Wheelchair access is required.", "No wheelchair access needed.", false],
    ["message", "No wheelchair access needed.", "No wheelchair access needed.", true],
    [
      "message",
      "Wheelchair access is required.",
      "Wheelchair access is required. Actually, wheelchair access is not needed.",
      false,
    ],
    [
      "message",
      "Wheelchair access is required.",
      "Wheelchair access is not needed. Actually, wheelchair access is required.",
      true,
    ],
  ] as const)("grounds a post-edit free %s capture to its own clause", (key, value, instruction, accepted) => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: `call_clause_grounded_${key}_${accepted}`,
                arguments: JSON.stringify({ key, value }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured[key]).toBe(accepted ? value : "");
  });

  it("uses the latest post-edit website correction instead of an older rejection", () => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.appendUserText("Do not use old.example.com.");
      result.current.appendUserText("Use new.example.com.");
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_latest_website_correction",
                arguments: JSON.stringify({ key: "website", value: "new.example.com" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.website).toBe("new.example.com");
  });

  it.each([
    ["phone", "Please clear my phone number."],
    ["email", "Please clear my email address."],
  ] as const)("accepts an explicit direct-object clear for %s", (key, instruction) => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured(key, key === "phone" ? "+60 12 345 6789" : "typed@example.com");
      result.current.appendUserText(instruction);
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "clear_field",
                call_id: `call_direct_clear_${key}`,
                arguments: JSON.stringify({ key }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured[key]).toBe("");
  });

  it("rechecks a deferred route against the settled response-bound transcript", async () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "education",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.updateCaptured("phone", "+60 12 345 6789");
      result.current.appendUserText("Please send it.");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: "audio_pending_route_negation" },
        channel,
      );
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_pending_route_negation",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
      expect(result.current.stateRef.current.deferredRouteCall).toBeDefined();
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "audio_pending_route_negation",
          transcript: "Do not send it.",
        },
        channel,
      );
      await Promise.resolve();
    });

    expect(result.current.stateRef.current.deferredRouteCall).toBeUndefined();
    expect(result.current.stateRef.current.routeRequested).toBeFalsy();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it("defers a post-edit capture without response.created and applies it after its supporting ASR settles", () => {
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: "audio_capture_without_created" },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "capture_field",
                call_id: "call_capture_without_created",
                arguments: JSON.stringify({ key: "name", value: "Alice", evidence: "Alice" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.name).toBe("Bob");
    expect(result.current.stateRef.current.deferredMutationCalls).toHaveLength(1);

    act(() => {
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "audio_capture_without_created",
          transcript: "My name is Alice.",
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.name).toBe("Alice");
    expect(result.current.stateRef.current.deferredMutationCalls).toEqual([]);
  });

  it.each([
    ["capture_field", { key: "name", value: "Alice", evidence: "Alice" }, "Actually, not Alice."],
    ["capture_fields", { fields: [{ key: "name", value: "Alice", evidence: "Alice" }] }, "Actually, not Alice."],
    ["clear_field", { key: "name" }, "Do not clear my name."],
    ["clear_fields", { scope: "all" }, "Do not clear anything."],
    ["set_partner_type", { segment: "technology" }, "We are not a technology company."],
    ["end_call", { reason: "user_done" }, "Do not end the call."],
  ] as const)("replays a no-binding deferred %s only after its current negation settles", (toolName, args, transcript) => {
    const onEndVoice = vi.fn();
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice,
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_no_binding_${toolName}` },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: toolName,
                call_id: `call_no_binding_${toolName}`,
                arguments: JSON.stringify(args),
              },
            ],
          },
        },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `audio_no_binding_${toolName}`,
          transcript,
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.name).toBe("Bob");
    expect(result.current.stateRef.current.segment).toBe("other");
    expect(onEndVoice).not.toHaveBeenCalled();
    expect(onClearFields).not.toHaveBeenCalled();
  });

  it.each([
    ["route_to_team", { segment: "technology" }, "Do not send it."],
    ["clear_fields", { scope: "all" }, "Do not clear all fields."],
    ["set_partner_type", { segment: "technology" }, "We are not a technology company."],
    ["end_call", { reason: "user_done" }, "Do not end the call."],
  ] as const)("requires settled user authority for a no-local-boundary %s call", async (toolName, args, transcript) => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const onEndVoice = vi.fn();
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice,
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    await act(async () => {
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_global_${toolName}` },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: toolName,
                call_id: `call_global_${toolName}`,
                arguments: JSON.stringify(args),
              },
            ],
          },
        },
        channel,
      );
      expect(result.current.stateRef.current.captured.email).toBe("ready@example.com");
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `audio_global_${toolName}`,
          transcript,
        },
        channel,
      );
      await Promise.resolve();
    });

    expect(result.current.stateRef.current.captured.email).toBe("ready@example.com");
    expect(result.current.stateRef.current.segment).toBe("other");
    expect(submitLead).not.toHaveBeenCalled();
    expect(onEndVoice).not.toHaveBeenCalled();
    expect(onClearFields).not.toHaveBeenCalled();
  });

  it.each([
    "failed",
    "empty",
  ] as const)("does not end after omitted response.created when the latest ASR is %s", (outcome) => {
    const onEndVoice = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice,
        onToolDuration: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_late_end_${outcome}` },
        channel,
      );
      result.current.handleRealtimeEvent(
        outcome === "failed"
          ? { type: "conversation.item.input_audio_transcription.failed", item_id: `audio_late_end_${outcome}` }
          : {
              type: "conversation.item.input_audio_transcription.completed",
              item_id: `audio_late_end_${outcome}`,
              transcript: "   ",
            },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "end_call",
                call_id: `call_late_end_${outcome}`,
                arguments: JSON.stringify({ reason: "user_done" }),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(onEndVoice).not.toHaveBeenCalled();
  });

  it("defers a fresh post-edit route before intent is available and submits after affirmative ASR", async () => {
    const submitLead = vi.fn(async () => ({ submitted: true }));
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "education",
        prefillEmail: "ready@example.com",
        submitLead,
        onEndVoice: vi.fn(),
        onToolDuration: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.updateCaptured("name", "Bob");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: "audio_fresh_route_without_created" },
        channel,
      );
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: "call_fresh_route_without_created",
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        channel,
      );
      expect(result.current.stateRef.current.deferredRouteCall).toBeDefined();
      result.current.handleRealtimeEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "audio_fresh_route_without_created",
          transcript: "Please send it.",
        },
        channel,
      );
      await Promise.resolve();
    });

    expect(result.current.stateRef.current.deferredRouteCall).toBeUndefined();
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(submitLead).toHaveBeenCalledWith(expect.objectContaining({ segment: "education" }));
  });

  it.each([
    ["capture_field", { key: "name", value: "Alice", evidence: "Alice" }],
    ["capture_fields", { fields: [{ key: "name", value: "Alice", evidence: "Alice" }] }],
    ["clear_field", { key: "name" }],
    ["clear_fields", { scope: "all" }],
    ["set_partner_type", { segment: "technology" }],
    ["end_call", { reason: "user_done" }],
  ] as const)("fails a response-bound pending-ASR %s mutation closed", (toolName, args) => {
    const onEndVoice = vi.fn();
    const onClearFields = vi.fn();
    const channel = { readyState: "open", send: vi.fn() } as unknown as RTCDataChannel;
    const { result } = renderHook(() =>
      useVoiceRuntime({
        initialSegment: "other",
        prefillEmail: "ready@example.com",
        submitLead: vi.fn(async () => ({ submitted: true })),
        onEndVoice,
        onToolDuration: vi.fn(),
        onClearFields,
      }),
    );

    act(() => {
      result.current.updateCaptured("name", "Bob");
      result.current.appendUserText("My name is Alice. Please clear and end this technology call.");
      result.current.handleRealtimeEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_pending_${toolName}` },
        channel,
      );
      result.current.handleRealtimeEvent({ type: "response.created" }, channel);
      result.current.handleRealtimeEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: toolName,
                call_id: `call_pending_${toolName}`,
                arguments: JSON.stringify(args),
              },
            ],
          },
        },
        channel,
      );
    });

    expect(result.current.stateRef.current.captured.name).toBe("Bob");
    expect(result.current.stateRef.current.segment).toBe("other");
    expect(onClearFields).not.toHaveBeenCalled();
    expect(onEndVoice).not.toHaveBeenCalled();
  });
});
