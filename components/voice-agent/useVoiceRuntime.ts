"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SegmentId } from "@/lib/segments";
import { serializeRealtimeCommand } from "@/lib/voice/client-events";
import {
  appendTypedUserMessage,
  type CapturedLead,
  emptyCapturedLead,
  isBenignVoiceError,
  type RealtimeClientCommand,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
  type VoiceTranscriptEntry,
} from "@/lib/voice/realtime-events";
import { voiceToastIds } from "./voice-dialog-copy";

type UseVoiceRuntimeArgs = {
  initialSegment: SegmentId;
  prefillEmail?: string;
  /** Persist the lead; resolves with the tool output returned to the model. */
  submitLead: (state: VoiceRuntimeState) => Promise<Record<string, unknown>>;
  onEndVoice: () => void;
};

/**
 * Owns the client-side realtime voice state: the reducer over server events,
 * the resulting React state, command dispatch back over the data channel, and
 * the user-facing toast policy for session errors and rejected captures.
 */
export function useVoiceRuntime({ initialSegment, prefillEmail, submitLead, onEndVoice }: UseVoiceRuntimeArgs) {
  const [segment, setSegment] = useState<SegmentId>(initialSegment);
  const [captured, setCaptured] = useState<CapturedLead>({ ...emptyCapturedLead, email: prefillEmail ?? "" });
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const stateRef = useRef<VoiceRuntimeState>({ segment, captured, transcript, handledCallIds: [] });
  const callbacksRef = useRef({ submitLead, onEndVoice });
  callbacksRef.current = { submitLead, onEndVoice };

  useEffect(() => {
    stateRef.current = { ...stateRef.current, segment, captured, transcript };
  }, [captured, segment, transcript]);

  const reset = useCallback((initial: { segment: SegmentId; email?: string }) => {
    const nextCaptured = { ...emptyCapturedLead, email: initial.email ?? "" };
    setSegment(initial.segment);
    setCaptured(nextCaptured);
    setTranscript([]);
    setAssistantDraft("");
    stateRef.current = { segment: initial.segment, captured: nextCaptured, transcript: [], handledCallIds: [] };
  }, []);

  const updateCaptured = useCallback((key: keyof CapturedLead, value: string) => {
    setCaptured((current) => ({ ...current, [key]: value }));
  }, []);

  const appendUserText = useCallback((text: string) => {
    stateRef.current = appendTypedUserMessage(stateRef.current, text);
    setTranscript(stateRef.current.transcript);
  }, []);

  const submitVoiceCommand = useCallback(
    (
      channel: RTCDataChannel,
      command: Extract<RealtimeClientCommand, { type: "submit_voice" }>,
      leadState: VoiceRuntimeState,
    ) => {
      callbacksRef.current
        .submitLead(leadState)
        .then((output) => {
          if (output.submitted !== true) {
            stateRef.current = { ...stateRef.current, routeRequested: false };
          }
          sendRealtimeCommand(channel, {
            type: "function_result",
            callId: command.callId,
            createResponse: output.submitted !== true,
            output,
          });
        })
        .catch(() => {
          stateRef.current = { ...stateRef.current, routeRequested: false };
          toast.error("Could not finish voice routing. You can still send from the handoff panel.");
        });
    },
    [],
  );

  const handleRealtimeEvent = useCallback(
    (serverEvent: RealtimeServerEvent, channel: RTCDataChannel) => {
      const previousErrorCount = stateRef.current.errors?.length ?? 0;
      const reduced = reduceRealtimeServerEvent(serverEvent, stateRef.current);
      stateRef.current = reduced.state;
      setSegment(reduced.state.segment);
      setCaptured(reduced.state.captured);
      setTranscript(reduced.state.transcript);
      setAssistantDraft(reduced.state.assistantDraft ?? "");
      const newErrors = (reduced.state.errors ?? []).slice(previousErrorCount);
      if (newErrors.some((error) => !isBenignVoiceError(error))) {
        toast.error("Voice session reported an error. The form is still available.", {
          id: voiceToastIds.sessionError,
        });
      }
      for (const command of reduced.commands) {
        if (command.type === "function_result") {
          if (command.output.error === "ungrounded_identity_capture") {
            toast.warning("Ignored an unverified contact detail.", {
              description: "Please type it in the handoff panel or say it clearly once.",
              id: voiceToastIds.captureWarning,
            });
          }
          sendRealtimeCommand(channel, command);
        }
        if (command.type === "submit_voice") submitVoiceCommand(channel, command, reduced.state);
        if (command.type === "end_voice") callbacksRef.current.onEndVoice();
      }
    },
    [submitVoiceCommand],
  );

  return {
    appendUserText,
    assistantDraft,
    captured,
    handleRealtimeEvent,
    reset,
    segment,
    setSegment,
    stateRef,
    transcript,
    updateCaptured,
  };
}

function sendRealtimeCommand(
  channel: RTCDataChannel,
  command: Extract<RealtimeClientCommand, { type: "function_result" }>,
) {
  if (channel.readyState !== "open") return;
  for (const event of serializeRealtimeCommand(command)) {
    channel.send(JSON.stringify(event));
  }
}
