// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  advanceRuntimeInputAttribution,
  type RuntimeInputAttribution,
  useVoiceRuntime,
} from "@/components/voice-agent/useVoiceRuntime";
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
});
