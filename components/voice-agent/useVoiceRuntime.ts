"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { SegmentId } from "@/lib/segments";
import { serializeRealtimeCommand } from "@/lib/voice/client-events";
import { provenanceForInitialCaptured, recordCapturedChanges } from "@/lib/voice/interaction-attribution";
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
  /** Revokes browser-local handoff memory after a successful clear-all tool call. */
  onClearFields?: () => void;
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
  onClearFields,
}: UseVoiceRuntimeArgs) {
  const [segment, setSegment] = useState<SegmentId>(initialSegment);
  const [captured, setCaptured] = useState<CapturedLead>({ ...emptyCapturedLead, email: prefillEmail ?? "" });
  const [emailVerification, setEmailVerification] = useState<VoiceEmailVerification | undefined>(
    confirmedEmailVerification(prefillEmail ?? "", "prefill"),
  );
  // Only deliberate form edits need a context refresh. Re-sending model-owned
  // tool captures as synthetic user messages creates duplicate replies and
  // makes Reka react to the form instead of the person speaking.
  const [localHandoffContextVersion, setLocalHandoffContextVersion] = useState(0);
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const initialCaptured = { ...emptyCapturedLead, email: prefillEmail ?? "" };
  const stateRef = useRef<VoiceRuntimeState>({
    segment,
    captured,
    transcript,
    handledCallIds: [],
    emailVerification,
    emailVerificationUserTurnSequence: 0,
    fieldProvenance: provenanceForInitialCaptured(initialCaptured),
  });
  const callbacksRef = useRef({ submitLead, onEndVoice, onToolDuration, onCaptureNeedsAttention, onClearFields });
  callbacksRef.current = { submitLead, onEndVoice, onToolDuration, onCaptureNeedsAttention, onClearFields };
  // The model retries a rejected capture on its own; only bother the visitor
  // when the same field keeps failing.
  const ungroundedRejectionsRef = useRef(0);
  // Tool calls do not identify whether their evidence came from microphone or
  // the live text composer. Bind each response to the modality that caused it;
  // a later turn must not relabel a delayed tool result from an earlier turn.
  const inputAttributionRef = useRef<RuntimeInputAttribution>({ latest: "voice" });
  // Deferred tools retain the start of their originating response so their
  // ASR wait remains visible in telemetry instead of looking instantaneous.
  const toolCallStartedAtRef = useRef(new Map<string, number>());
  // False means focused but unchanged; true means this focus session already
  // recorded its one bounded form edit.
  const capturedEditSessionsRef = useRef<Partial<Record<keyof CapturedLead, boolean>>>({});

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
    inputAttributionRef.current = { latest: "voice" };
    toolCallStartedAtRef.current.clear();
    capturedEditSessionsRef.current = {};
    stateRef.current = {
      segment: initial.segment,
      captured: nextCaptured,
      transcript: [],
      handledCallIds: [],
      emailVerification: nextEmailVerification,
      emailVerificationUserTurnSequence: 0,
      fieldProvenance: provenanceForInitialCaptured(nextCaptured),
    };
  }, []);

  const updateCaptured = useCallback((key: keyof CapturedLead, value: string) => {
    const nextCaptured = { ...stateRef.current.captured, [key]: value };
    const changeKind = capturedEditSessionsRef.current[key] === true ? "continuous" : "atomic";
    capturedEditSessionsRef.current[key] = true;
    const nextEmailVerification =
      key === "email" ? confirmedEmailVerification(value, "typed") : stateRef.current.emailVerification;
    stateRef.current = {
      ...stateRef.current,
      captured: nextCaptured,
      userAuthoritySequence: (stateRef.current.userAuthoritySequence ?? 0) + 1,
      latestUserTranscriptItemId: undefined,
      legacyUserTranscriptOutcome: undefined,
      localAuthorityPendingResponse: true,
      localFieldEditUserTurnSequences: {
        ...stateRef.current.localFieldEditUserTurnSequences,
        [key]: stateRef.current.transcript.filter((entry) => entry.role === "user").length,
      },
      localMutationBoundaryUserTurnSequence: stateRef.current.transcript.filter((entry) => entry.role === "user")
        .length,
      activeResponseSupersededByUserInput: stateRef.current.activeResponse
        ? true
        : stateRef.current.activeResponseSupersededByUserInput,
      fieldProvenance: recordCapturedChanges(
        stateRef.current.captured,
        nextCaptured,
        stateRef.current.fieldProvenance,
        "form",
        changeKind,
      ),
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
    setLocalHandoffContextVersion((version) => version + 1);
  }, []);

  const beginCapturedEdit = useCallback((key: keyof CapturedLead) => {
    capturedEditSessionsRef.current[key] = false;
  }, []);

  const endCapturedEdit = useCallback((key: keyof CapturedLead) => {
    delete capturedEditSessionsRef.current[key];
  }, []);

  const updateSegment = useCallback((nextSegment: SegmentId) => {
    stateRef.current = {
      ...stateRef.current,
      segment: nextSegment,
      userAuthoritySequence: (stateRef.current.userAuthoritySequence ?? 0) + 1,
      latestUserTranscriptItemId: undefined,
      legacyUserTranscriptOutcome: undefined,
      localAuthorityPendingResponse: true,
      localSegmentEditUserTurnSequence: stateRef.current.transcript.filter((entry) => entry.role === "user").length,
      localMutationBoundaryUserTurnSequence: stateRef.current.transcript.filter((entry) => entry.role === "user")
        .length,
      activeResponseSupersededByUserInput: stateRef.current.activeResponse
        ? true
        : stateRef.current.activeResponseSupersededByUserInput,
    };
    setSegment(nextSegment);
    setLocalHandoffContextVersion((version) => version + 1);
  }, []);

  const appendUserText = useCallback((text: string) => {
    inputAttributionRef.current = { ...inputAttributionRef.current, latest: "chat" };
    const previous = stateRef.current;
    const next = appendTypedUserMessage(previous, text);
    stateRef.current = {
      ...next,
      fieldProvenance: recordCapturedChanges(previous.captured, next.captured, previous.fieldProvenance, "chat"),
    };
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
      const eventStartedAt = performance.now();
      if (serverEvent.type === "response.done") {
        for (const item of serverEvent.response?.output ?? []) {
          if (item.type === "function_call" && item.call_id && !toolCallStartedAtRef.current.has(item.call_id)) {
            toolCallStartedAtRef.current.set(item.call_id, eventStartedAt);
          }
        }
      }
      const inputAttribution = advanceRuntimeInputAttribution(inputAttributionRef.current, serverEvent.type);
      inputAttributionRef.current = inputAttribution.state;
      const previousErrorCount = stateRef.current.errors?.length ?? 0;
      const previous = stateRef.current;
      const reduced = reduceRealtimeServerEvent(serverEvent, previous);
      reduced.state.fieldProvenance = recordCapturedChanges(
        previous.captured,
        reduced.state.captured,
        previous.fieldProvenance,
        inputAttribution.input,
      );
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
        const toolStartedAt =
          "callId" in command ? (toolCallStartedAtRef.current.get(command.callId) ?? eventStartedAt) : eventStartedAt;
        if (command.type === "function_result") {
          const toolName = command.toolName ?? toolNameForCall(serverEvent, command.callId);
          const detail =
            command.output.detail && typeof command.output.detail === "object"
              ? (command.output.detail as Record<string, unknown>)
              : null;
          const rejectedBatchKeys = Array.isArray(command.output.rejectedFields)
            ? command.output.rejectedFields.flatMap((entry) => {
                if (!entry || typeof entry !== "object") return [];
                const output = (entry as { output?: unknown }).output;
                if (!output || typeof output !== "object") return [];
                const key = toCapturedLeadKey((output as Record<string, unknown>).key);
                return key ? [key] : [];
              })
            : [];
          const rejectedKey = rejectedBatchKeys.includes("email")
            ? "email"
            : (toCapturedLeadKey(detail?.key ?? command.output.key) ?? "email");
          if (
            command.output.error === "ungrounded_identity_capture" ||
            detail?.error === "ungrounded_identity_capture" ||
            command.output.error === "invalid_email"
          ) {
            ungroundedRejectionsRef.current += 1;
            if (rejectedKey === "email" || ungroundedRejectionsRef.current >= 2) {
              toast.warning(
                rejectedKey === "email" ? "Reka didn't catch that email yet." : "Reka didn't catch one detail.",
                {
                  description:
                    rejectedKey === "email"
                      ? "Say the full address once more, including the domain. Reka will keep listening."
                      : "Say it once more, or type it straight into the handoff panel.",
                  id: voiceToastIds.captureWarning,
                },
              );
              if (rejectedKey !== "email") callbacksRef.current.onCaptureNeedsAttention?.(rejectedKey);
            }
          }
          if (command.output.error === "unconfirmed_required_fields") {
            toast.message("Reka needs one spoken email correction.", {
              description: "Say the full address naturally, including the domain. Reka will keep listening.",
              id: voiceToastIds.captureWarning,
            });
          }
          if (toolName === "clear_fields" && command.output.cleared === true) {
            callbacksRef.current.onClearFields?.();
          }
          const sent = sendRealtimeCommand(channel, command);
          reportTool(callbacksRef.current.onToolDuration, toolName, toolStartedAt, command.output, sent);
          toolCallStartedAtRef.current.delete(command.callId);
        }
        if (command.type === "submit_voice") {
          submitVoiceCommand(channel, command, reduced.state, toolStartedAt);
          toolCallStartedAtRef.current.delete(command.callId);
        }
        if (command.type === "end_voice") callbacksRef.current.onEndVoice();
      }
      for (const callId of reduced.state.handledCallIds ?? []) toolCallStartedAtRef.current.delete(callId);
    },
    [submitVoiceCommand],
  );

  return {
    appendUserText,
    assistantDraft,
    beginCapturedEdit,
    captured,
    emailVerification,
    endCapturedEdit,
    handleRealtimeEvent,
    localHandoffContextVersion,
    reset,
    segment,
    setSegment: updateSegment,
    stateRef,
    transcript,
    updateCaptured,
  };
}

type RuntimeInputModality = "voice" | "chat";

export type RuntimeInputAttribution = {
  latest: RuntimeInputModality;
  activeResponse?: RuntimeInputModality;
};

/**
 * Realtime function calls arrive on response completion and do not carry their
 * originating input modality. Audio commit is the earliest authoritative voice
 * boundary; response creation freezes that boundary until its output settles.
 */
export function advanceRuntimeInputAttribution(
  current: RuntimeInputAttribution,
  eventType: RealtimeServerEvent["type"],
): { state: RuntimeInputAttribution; input: RuntimeInputModality } {
  let latest = current.latest;
  let activeResponse = current.activeResponse;
  if (
    eventType === "input_audio_buffer.committed" ||
    eventType === "conversation.item.input_audio_transcription.completed"
  ) {
    latest = "voice";
  }
  if (eventType === "response.created") activeResponse = latest;
  const input = eventType === "response.done" ? (activeResponse ?? latest) : latest;
  if (eventType === "response.done") activeResponse = undefined;
  return { state: { latest, ...(activeResponse ? { activeResponse } : {}) }, input };
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
