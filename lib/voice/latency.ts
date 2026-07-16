/**
 * Pure turn-state and latency telemetry for Realtime voice sessions.
 *
 * The browser hook translates raw OpenAI events into these semantic signals.
 * Keeping the reducer free of WebRTC, React, and wall-clock APIs makes the
 * timing contract deterministic and straightforward to test.
 */

export type VoiceTurnPhase = "quiet" | "user_speaking" | "waiting_for_response" | "assistant_speaking";

export type VoiceInputPolicy = "baseline" | "fast" | "patient";

export const VOICE_TOOL_NAMES = [
  "set_partner_type",
  "capture_field",
  "capture_fields",
  "confirm_email",
  "lookup_oriental",
  "clear_field",
  "summarise_lead",
  "route_to_team",
  "wait_for_user",
  "end_call",
  "unknown",
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];
export type VoiceToolOutcome = "success" | "rejected" | "failed" | "dispatch_failed";

export type VoiceToolLatencySample = {
  /** Turn sequence when available; omitted for lifecycle-only calls. */
  sequence?: number;
  name: VoiceToolName;
  outcome: VoiceToolOutcome;
  /** Browser execution plus function-result serialization and dispatch. */
  executionMs: number;
  /** Model/transport time from response.created until browser execution began. */
  responseCreatedToCallMs?: number;
  /** End-to-end response.created until the result was dispatched. */
  responseCreatedToResultMs?: number;
};

export type VoiceTurnLatencySample = {
  sequence: number;
  inputPolicy: VoiceInputPolicy;
  /** Total detected speech across rapid-resume segments in this turn. */
  speechDurationMs?: number;
  /** Final speech stop to response.created. */
  stopToResponseCreatedMs?: number;
  /** Final speech stop to the first output audio/transcript event. */
  stopToFirstOutputEventMs?: number;
  /** Local microphone activity end to the server VAD speech-stopped event. */
  localSpeechEndToSpeechStoppedMs?: number;
  /** Final speech stop to independently detected remote-stream audio activity. */
  stopToRemoteAudioMs?: number;
  /** First output event to independently detected remote-stream audio activity. */
  firstOutputEventToRemoteAudioMs?: number;
  /** Browser-side tool execution and result dispatch within this response chain. */
  toolDurationMs?: number;
  /** Visitor barge-in to response.done, used as the interruption-silence proxy. */
  bargeInToResponseDoneMs?: number;
  /** response.created to response.done (or interruption/session close). */
  responseDurationMs?: number;
  /** The visitor began speaking while this turn's response was active. */
  interrupted: boolean;
  /** Speech resumed soon after an apparent endpoint, before output began. */
  rapidResume: boolean;
};

export type VoiceLatencyTelemetry = {
  version: 1;
  activation?: {
    /** Initiating tap to scheduling the local arm cue; this is not speaker output. */
    tapToArmCueScheduledMs?: number;
    /** Initiating tap to the Realtime data channel becoming live. */
    tapToLiveMs?: number;
    /** Initiating tap to independently detected remote-stream audio activity. */
    tapToAudibleMs?: number;
  };
  turns: VoiceTurnLatencySample[];
  /** PII-free per-tool timings, retained separately from turn aggregates. */
  toolCalls?: VoiceToolLatencySample[];
};

export type VoiceLatencySignal =
  | { type: "speech_started"; at: number }
  | { type: "speech_stopped"; at: number }
  | { type: "response_created"; at: number }
  | { type: "first_output"; at: number }
  | { type: "local_speech_ended"; at: number }
  | { type: "remote_audio_started"; at: number }
  | { type: "tool_completed"; at: number; durationMs: number; name: VoiceToolName; outcome: VoiceToolOutcome }
  | { type: "interruption_cleared"; at: number }
  | { type: "input_policy_changed"; inputPolicy: VoiceInputPolicy }
  | { type: "response_done"; at: number }
  | { type: "session_closed"; at: number };

type VoiceTurnDraft = {
  sequence: number;
  inputPolicy: VoiceInputPolicy;
  speechSegmentStartedAt?: number;
  speechDurationMs: number;
  localSpeechEndedAt?: number;
  speechStoppedAt?: number;
  responseCreatedAt?: number;
  firstOutputAt?: number;
  remoteAudioAt?: number;
  toolDurationMs: number;
  interrupted: boolean;
  rapidResume: boolean;
};

export type VoiceLatencyState = {
  phase: VoiceTurnPhase;
  telemetry: VoiceLatencyTelemetry;
  inputPolicy: VoiceInputPolicy;
  nextSequence: number;
  activeResponse: boolean;
  pendingBargeInAt?: number;
  /** Monotonic browser marker; used to derive a duration and never persisted. */
  activationStartedAt?: number;
  current?: VoiceTurnDraft;
};

export const MAX_VOICE_LATENCY_TURNS = 80;
export const MAX_VOICE_TOOL_SAMPLES = 120;
export const RAPID_RESUME_WINDOW_MS = 1_500;

export function createVoiceLatencyState(
  inputPolicy: VoiceInputPolicy = "baseline",
  activation?: VoiceLatencyTelemetry["activation"],
  activationStartedAt?: number,
): VoiceLatencyState {
  return {
    phase: "quiet",
    telemetry: { version: 1, ...(activation ? { activation } : {}), turns: [] },
    inputPolicy,
    nextSequence: 1,
    activeResponse: false,
    activationStartedAt,
  };
}

export function reduceVoiceLatency(state: VoiceLatencyState, signal: VoiceLatencySignal): VoiceLatencyState {
  switch (signal.type) {
    case "speech_started":
      return recordSpeechStarted(state, signal.at);
    case "speech_stopped":
      return recordSpeechStopped(state, signal.at);
    case "response_created":
      return recordResponseCreated(state, signal.at);
    case "first_output":
      return recordFirstOutput(state, signal.at);
    case "local_speech_ended":
      return recordLocalSpeechEnded(state, signal.at);
    case "remote_audio_started":
      return recordRemoteAudioStarted(state, signal.at);
    case "tool_completed":
      return recordToolCompleted(state, signal);
    case "interruption_cleared":
      return recordInterruptionCleared(state, signal.at);
    case "input_policy_changed":
      return { ...state, inputPolicy: signal.inputPolicy };
    case "response_done":
      return recordResponseDone(state, signal.at);
    case "session_closed":
      return closeLatencySession(state, signal.at);
  }
}

function recordSpeechStarted(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const current = state.current;
  if (current?.speechSegmentStartedAt !== undefined) return state;

  if (current?.speechStoppedAt !== undefined) {
    const resumeDelay = Math.max(0, at - current.speechStoppedAt);
    if (resumeDelay <= RAPID_RESUME_WINDOW_MS && current.firstOutputAt === undefined) {
      return {
        ...state,
        phase: "user_speaking",
        activeResponse: false,
        current: {
          ...current,
          speechSegmentStartedAt: at,
          speechStoppedAt: undefined,
          responseCreatedAt: undefined,
          firstOutputAt: undefined,
          localSpeechEndedAt: undefined,
          remoteAudioAt: undefined,
          toolDurationMs: 0,
          rapidResume: true,
        },
      };
    }

    const interrupted = state.activeResponse;
    const completed = finishCurrentTurn(state, at, { interrupted });
    return { ...startTurn(completed, at), ...(interrupted ? { pendingBargeInAt: at } : {}) };
  }

  return startTurn(state, at);
}

function startTurn(state: VoiceLatencyState, at: number): VoiceLatencyState {
  return {
    ...state,
    phase: "user_speaking",
    activeResponse: false,
    nextSequence: state.nextSequence + 1,
    current: {
      sequence: state.nextSequence,
      inputPolicy: state.inputPolicy,
      speechSegmentStartedAt: at,
      speechDurationMs: 0,
      toolDurationMs: 0,
      interrupted: false,
      rapidResume: false,
    },
  };
}

function recordSpeechStopped(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const current = state.current;
  if (!current || current.speechSegmentStartedAt === undefined) return state;
  return {
    ...state,
    phase: "waiting_for_response",
    current: {
      ...current,
      speechDurationMs: current.speechDurationMs + elapsed(current.speechSegmentStartedAt, at),
      speechSegmentStartedAt: undefined,
      speechStoppedAt: at,
    },
  };
}

function recordResponseCreated(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const current = state.current;
  return {
    ...state,
    activeResponse: true,
    phase: current?.speechSegmentStartedAt !== undefined ? "user_speaking" : "waiting_for_response",
    current:
      current?.speechStoppedAt !== undefined && current.responseCreatedAt === undefined
        ? { ...current, responseCreatedAt: at }
        : current,
  };
}

function recordFirstOutput(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const current = state.current;
  // A late delta from a cancelled response must not make the orb claim that
  // Reka is speaking over a new user utterance.
  if (current?.speechSegmentStartedAt !== undefined) return state;
  return {
    ...state,
    phase: "assistant_speaking",
    current:
      current?.speechStoppedAt !== undefined &&
      current.responseCreatedAt !== undefined &&
      current.firstOutputAt === undefined
        ? { ...current, firstOutputAt: at }
        : current,
  };
}

function recordLocalSpeechEnded(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const current = state.current;
  if (!current || current.speechSegmentStartedAt === undefined) return state;
  return { ...state, current: { ...current, localSpeechEndedAt: at } };
}

function recordRemoteAudioStarted(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const activation =
    state.activationStartedAt !== undefined && state.telemetry.activation?.tapToAudibleMs === undefined
      ? {
          ...state.telemetry.activation,
          tapToAudibleMs: elapsed(state.activationStartedAt, at),
        }
      : state.telemetry.activation;
  const current = state.current;
  if (!current || current.speechSegmentStartedAt !== undefined || current.remoteAudioAt !== undefined) {
    return activation === state.telemetry.activation
      ? state
      : { ...state, telemetry: { ...state.telemetry, activation } };
  }
  return {
    ...state,
    phase: "assistant_speaking",
    current: { ...current, remoteAudioAt: at },
    telemetry: { ...state.telemetry, activation },
  };
}

function recordToolCompleted(
  state: VoiceLatencyState,
  signal: Extract<VoiceLatencySignal, { type: "tool_completed" }>,
): VoiceLatencyState {
  const { at, durationMs, name, outcome } = signal;
  if (!Number.isFinite(at) || !Number.isFinite(durationMs) || durationMs < 0) return state;
  const executionMs = Math.min(120_000, Math.round(durationMs));
  const startedAt = at - durationMs;
  const current = state.current;
  const sample: VoiceToolLatencySample = {
    ...(current ? { sequence: current.sequence } : {}),
    name,
    outcome,
    executionMs,
    ...(current?.responseCreatedAt !== undefined
      ? {
          responseCreatedToCallMs: elapsed(current.responseCreatedAt, startedAt),
          responseCreatedToResultMs: elapsed(current.responseCreatedAt, at),
        }
      : {}),
  };
  return {
    ...state,
    telemetry: {
      ...state.telemetry,
      toolCalls: [...(state.telemetry.toolCalls ?? []), sample].slice(-MAX_VOICE_TOOL_SAMPLES),
    },
    ...(current
      ? {
          current: {
            ...current,
            // The persisted schema accepts at most 120 seconds for one turn.
            toolDurationMs: Math.min(120_000, current.toolDurationMs + executionMs),
          },
        }
      : {}),
  };
}

function recordInterruptionCleared(state: VoiceLatencyState, at: number): VoiceLatencyState {
  if (state.pendingBargeInAt === undefined) return state;
  const turns = [...state.telemetry.turns];
  const last = turns.at(-1);
  if (last?.interrupted && last.bargeInToResponseDoneMs === undefined) {
    turns[turns.length - 1] = { ...last, bargeInToResponseDoneMs: elapsed(state.pendingBargeInAt, at) };
  }
  return {
    ...state,
    pendingBargeInAt: undefined,
    telemetry: { ...state.telemetry, turns },
  };
}

function recordResponseDone(state: VoiceLatencyState, at: number): VoiceLatencyState {
  if (state.current?.responseCreatedAt !== undefined) {
    return finishCurrentTurn(state, at);
  }
  return {
    ...state,
    activeResponse: false,
    phase: phaseForCurrent(state.current),
  };
}

function closeLatencySession(state: VoiceLatencyState, at: number): VoiceLatencyState {
  const closed = state.current ? finishCurrentTurn(state, at) : state;
  return { ...closed, phase: "quiet", activeResponse: false, current: undefined };
}

function finishCurrentTurn(
  state: VoiceLatencyState,
  at: number,
  overrides: { interrupted?: boolean } = {},
): VoiceLatencyState {
  const current = state.current;
  if (!current) return state;
  const speechDurationMs =
    current.speechDurationMs +
    (current.speechSegmentStartedAt === undefined ? 0 : elapsed(current.speechSegmentStartedAt, at));
  const sample: VoiceTurnLatencySample = {
    sequence: current.sequence,
    inputPolicy: current.inputPolicy,
    ...(speechDurationMs > 0 ? { speechDurationMs } : {}),
    ...durationField("stopToResponseCreatedMs", current.speechStoppedAt, current.responseCreatedAt),
    ...durationField("stopToFirstOutputEventMs", current.speechStoppedAt, current.firstOutputAt),
    ...durationField("localSpeechEndToSpeechStoppedMs", current.localSpeechEndedAt, current.speechStoppedAt),
    ...durationField("stopToRemoteAudioMs", current.speechStoppedAt, current.remoteAudioAt),
    ...durationField("firstOutputEventToRemoteAudioMs", current.firstOutputAt, current.remoteAudioAt),
    ...(current.toolDurationMs > 0 ? { toolDurationMs: current.toolDurationMs } : {}),
    ...durationField("responseDurationMs", current.responseCreatedAt, at),
    interrupted: overrides.interrupted ?? current.interrupted,
    rapidResume: current.rapidResume,
  };
  return {
    ...state,
    phase: "quiet",
    activeResponse: false,
    current: undefined,
    telemetry: {
      ...state.telemetry,
      turns: [...state.telemetry.turns, sample].slice(-MAX_VOICE_LATENCY_TURNS),
    },
  };
}

function phaseForCurrent(current: VoiceTurnDraft | undefined): VoiceTurnPhase {
  if (current?.speechSegmentStartedAt !== undefined) return "user_speaking";
  if (current?.speechStoppedAt !== undefined) return "waiting_for_response";
  return "quiet";
}

function elapsed(start: number, end: number): number {
  return Math.round(Math.max(0, end - start));
}

function durationField<Key extends keyof VoiceTurnLatencySample>(
  key: Key,
  start: number | undefined,
  end: number | undefined,
): Partial<Record<Key, number>> {
  if (start === undefined || end === undefined) return {};
  return { [key]: elapsed(start, end) } as Partial<Record<Key, number>>;
}
