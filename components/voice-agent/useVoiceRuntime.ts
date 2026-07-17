"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { SegmentId } from "@/lib/segments";
import { serializeRealtimeCommand } from "@/lib/voice/client-events";
import { VOICE_TOOL_NAMES, type VoiceToolName, type VoiceToolOutcome } from "@/lib/voice/latency";
import {
  appendTypedUserMessage,
  type CapturedLead,
  confirmedEmailVerification,
  emptyCapturedLead,
  isBenignVoiceError,
  isVoiceCaptureIntegrityIssue,
  type RealtimeClientCommand,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceEmailVerification,
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
  /** Reports PII-free browser tool timing through result dispatch. */
  onToolDuration: (sample: { at: number; durationMs: number; name: VoiceToolName; outcome: VoiceToolOutcome }) => void;
  /** Brings the editable fallback into view after repeated capture trouble. */
  onCaptureNeedsAttention?: (key: keyof CapturedLead) => void;
};

/**
 * Owns the client-side realtime voice state: the reducer over server events,
 * the resulting React state, command dispatch back over the data channel, and
 * the user-facing toast policy for session errors and rejected captures.
 */
export function useVoiceRuntime({
  initialSegment,
  prefillEmail,
  submitLead,
  onEndVoice,
  onToolDuration,
  onCaptureNeedsAttention,
}: UseVoiceRuntimeArgs) {
  const [segment, setSegment] = useState<SegmentId>(initialSegment);
  const [captured, setCaptured] = useState<CapturedLead>({ ...emptyCapturedLead, email: prefillEmail ?? "" });
  const [emailVerification, setEmailVerification] = useState<VoiceEmailVerification | undefined>(
    confirmedEmailVerification(prefillEmail ?? "", "prefill"),
  );
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const stateRef = useRef<VoiceRuntimeState>({
    segment,
    captured,
    transcript,
    handledCallIds: [],
    emailVerification,
    emailVerificationUserTurnSequence: 0,
  });
  const callbacksRef = useRef({ submitLead, onEndVoice, onToolDuration, onCaptureNeedsAttention });
  callbacksRef.current = { submitLead, onEndVoice, onToolDuration, onCaptureNeedsAttention };
  // The model retries a rejected capture on its own; only bother the visitor
  // when the same field keeps failing.
  const ungroundedRejectionsRef = useRef(0);

  const reset = useCallback((initial: { segment: SegmentId; email?: string; name?: string; org?: string }) => {
    const nextCaptured = {
      ...emptyCapturedLead,
      email: initial.email ?? "",
      name: initial.name ?? "",
      org: initial.org ?? "",
    };
    setSegment(initial.segment);
    setCaptured(nextCaptured);
    const nextEmailVerification = confirmedEmailVerification(initial.email ?? "", "prefill");
    setEmailVerification(nextEmailVerification);
    setTranscript([]);
    setAssistantDraft("");
    ungroundedRejectionsRef.current = 0;
    stateRef.current = {
      segment: initial.segment,
      captured: nextCaptured,
      transcript: [],
      handledCallIds: [],
      emailVerification: nextEmailVerification,
      emailVerificationUserTurnSequence: 0,
    };
  }, []);

  const updateCaptured = useCallback((key: keyof CapturedLead, value: string) => {
    const nextCaptured = { ...stateRef.current.captured, [key]: value };
    const nextEmailVerification =
      key === "email" ? confirmedEmailVerification(value, "typed") : stateRef.current.emailVerification;
    stateRef.current = {
      ...stateRef.current,
      captured: nextCaptured,
      emailVerification: nextEmailVerification,
      ...(key === "email"
        ? {
            emailVerificationUserTurnSequence: stateRef.current.transcript.filter((entry) => entry.role === "user")
              .length,
            emailVerificationIgnoredTranscriptIds: [...(stateRef.current.pendingUserTranscriptIds ?? [])],
            activeResponseStaleForEmail: stateRef.current.activeResponse
              ? true
              : stateRef.current.activeResponseStaleForEmail,
            emailGroundingAwaitingTranscript: undefined,
          }
        : {}),
    };
    setCaptured(nextCaptured);
    if (key === "email") setEmailVerification(nextEmailVerification);
  }, []);

  const updateSegment = useCallback((nextSegment: SegmentId) => {
    stateRef.current = { ...stateRef.current, segment: nextSegment };
    setSegment(nextSegment);
  }, []);

  const appendUserText = useCallback((text: string) => {
    stateRef.current = appendTypedUserMessage(stateRef.current, text);
    setCaptured(stateRef.current.captured);
    setEmailVerification(stateRef.current.emailVerification);
    setTranscript(stateRef.current.transcript);
  }, []);

  const submitVoiceCommand = useCallback(
    (
      channel: RTCDataChannel,
      command: Extract<RealtimeClientCommand, { type: "submit_voice" }>,
      leadState: VoiceRuntimeState,
      startedAt: number,
    ) => {
      callbacksRef.current
        .submitLead(leadState)
        .then((output) => {
          if (output.submitted !== true) {
            stateRef.current = { ...stateRef.current, routeRequested: false };
          }
          const sent = sendRealtimeCommand(channel, {
            type: "function_result",
            callId: command.callId,
            createResponse: output.submitted !== true,
            output,
          });
          reportTool(callbacksRef.current.onToolDuration, "route_to_team", startedAt, output, sent);
        })
        .catch((error) => {
          stateRef.current = { ...stateRef.current, routeRequested: false };
          const sent = sendRealtimeCommand(channel, {
            type: "function_result",
            callId: command.callId,
            createResponse: true,
            output: {
              ok: false,
              error: "lead_submit_failed",
              message: error instanceof Error ? error.message : "The lead submission failed.",
            },
          });
          reportTool(callbacksRef.current.onToolDuration, "route_to_team", startedAt, { ok: false }, sent, "failed");
          toast.error("Could not finish voice routing. You can still send from the handoff panel.");
        });
    },
    [],
  );

  const handleRealtimeEvent = useCallback(
    (serverEvent: RealtimeServerEvent, channel: RTCDataChannel) => {
      const toolStartedAt = performance.now();
      const previousErrorCount = stateRef.current.errors?.length ?? 0;
      const reduced = reduceRealtimeServerEvent(serverEvent, stateRef.current);
      stateRef.current = reduced.state;
      setSegment(reduced.state.segment);
      setCaptured(reduced.state.captured);
      setEmailVerification(reduced.state.emailVerification);
      setTranscript(reduced.state.transcript);
      setAssistantDraft(reduced.state.assistantDraft ?? "");
      const newErrors = (reduced.state.errors ?? []).slice(previousErrorCount);
      if (newErrors.some((error) => !isBenignVoiceError(error) && !isVoiceCaptureIntegrityIssue(error))) {
        toast.error("Voice session reported an error. The form is still available.", {
          id: voiceToastIds.sessionError,
        });
      }
      for (const command of reduced.commands) {
        if (command.type === "function_result") {
          const detail =
            command.output.detail && typeof command.output.detail === "object"
              ? (command.output.detail as Record<string, unknown>)
              : null;
          const rejectedKey = toCapturedLeadKey(detail?.key ?? command.output.key) ?? "email";
          if (
            command.output.error === "ungrounded_identity_capture" ||
            detail?.error === "ungrounded_identity_capture" ||
            command.output.error === "invalid_email"
          ) {
            ungroundedRejectionsRef.current += 1;
            if (ungroundedRejectionsRef.current >= 2) {
              toast.warning("Reka didn't catch one detail.", {
                description: "Say it once more, or type it straight into the handoff panel.",
                id: voiceToastIds.captureWarning,
              });
              callbacksRef.current.onCaptureNeedsAttention?.(rejectedKey);
            }
          }
          if (command.output.error === "unconfirmed_required_fields") {
            toast.message("Please confirm the email Reka read back.", {
              description: "Say yes if it is exact, or edit the highlighted email field.",
              id: voiceToastIds.captureWarning,
            });
            callbacksRef.current.onCaptureNeedsAttention?.("email");
          }
          const sent = sendRealtimeCommand(channel, command);
          reportTool(
            callbacksRef.current.onToolDuration,
            toolNameForCall(serverEvent, command.callId),
            toolStartedAt,
            command.output,
            sent,
          );
        }
        if (command.type === "submit_voice") submitVoiceCommand(channel, command, reduced.state, toolStartedAt);
        if (command.type === "end_voice") callbacksRef.current.onEndVoice();
      }
    },
    [submitVoiceCommand],
  );

  return {
    appendUserText,
    assistantDraft,
    captured,
    emailVerification,
    handleRealtimeEvent,
    reset,
    segment,
    setSegment: updateSegment,
    stateRef,
    transcript,
    updateCaptured,
  };
}

function toolNameForCall(event: RealtimeServerEvent, callId: string): VoiceToolName {
  const name = event.response?.output?.find((item) => item.call_id === callId)?.name;
  return typeof name === "string" && (VOICE_TOOL_NAMES as readonly string[]).includes(name)
    ? (name as VoiceToolName)
    : "unknown";
}

function reportTool(
  report: UseVoiceRuntimeArgs["onToolDuration"],
  name: VoiceToolName,
  startedAt: number,
  output: Record<string, unknown>,
  sent: boolean,
  forcedOutcome?: VoiceToolOutcome,
) {
  const at = performance.now();
  const error = typeof output.error === "string" ? output.error : null;
  const outcome =
    forcedOutcome ??
    (!sent
      ? "dispatch_failed"
      : output.ok !== false
        ? "success"
        : error === "unknown_tool" || error?.includes("failed")
          ? "failed"
          : "rejected");
  report({ at, durationMs: at - startedAt, name, outcome });
}

function toCapturedLeadKey(value: unknown): keyof CapturedLead | null {
  return value === "name" ||
    value === "email" ||
    value === "org" ||
    value === "phone" ||
    value === "website" ||
    value === "message"
    ? value
    : null;
}

function sendRealtimeCommand(
  channel: RTCDataChannel,
  command: Extract<RealtimeClientCommand, { type: "function_result" }>,
) {
  if (channel.readyState !== "open") return false;
  for (const event of serializeRealtimeCommand(command)) {
    channel.send(JSON.stringify(event));
  }
  return true;
}
