/**
 * Pure turn-state and latency telemetry for Realtime voice sessions.
 *
 * The browser hook translates raw OpenAI events into these semantic signals.
 * Keeping the reducer free of WebRTC, React, and wall-clock APIs makes the
 * timing contract deterministic and straightforward to test.
 */

export type VoiceTurnPhase = "quiet" | "user_speaking" | "waiting_for_response" | "assistant_speaking";

export type VoiceInputPolicy = "baseline" | "fast" | "patient";

export type VoiceTurnLatencySample = {
  sequence: number;
  inputPolicy: VoiceInputPolicy;
  /** Total detected speech across rapid-resume segments in this turn. */
  speechDurationMs?: number;
  /** Final speech stop to response.created. */
  stopToResponseCreatedMs?: number;
  /** Final speech stop to the first output audio/transcript event. */
  stopToFirstOutputEventMs?: number;
  /** response.created to response.done (or interruption/session close). */
  responseDurationMs?: number;
  /** The visitor began speaking while this turn's response was active. */
  interrupted: boolean;
  /** Speech resumed soon after an apparent endpoint, before output began. */
  rapidResume: boolean;
};

export type VoiceLatencyTelemetry = {
  version: 1;
  turns: VoiceTurnLatencySample[];
};

export type VoiceLatencySignal =
  | { type: "speech_started"; at: number }
  | { type: "speech_stopped"; at: number }
  | { type: "response_created"; at: number }
  | { type: "first_output"; at: number }
  | { type: "response_done"; at: number }
  | { type: "session_closed"; at: number };

type VoiceTurnDraft = {
  sequence: number;
  inputPolicy: VoiceInputPolicy;
  speechSegmentStartedAt?: number;
  speechDurationMs: number;
  speechStoppedAt?: number;
  responseCreatedAt?: number;
  firstOutputAt?: number;
  interrupted: boolean;
  rapidResume: boolean;
};

export type VoiceLatencyState = {
  phase: VoiceTurnPhase;
  telemetry: VoiceLatencyTelemetry;
  inputPolicy: VoiceInputPolicy;
  nextSequence: number;
  activeResponse: boolean;
  current?: VoiceTurnDraft;
};

export const MAX_VOICE_LATENCY_TURNS = 80;
export const RAPID_RESUME_WINDOW_MS = 1_500;

export function createVoiceLatencyState(inputPolicy: VoiceInputPolicy = "baseline"): VoiceLatencyState {
  return {
    phase: "quiet",
    telemetry: { version: 1, turns: [] },
    inputPolicy,
    nextSequence: 1,
    activeResponse: false,
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
          rapidResume: true,
        },
      };
    }

    const completed = finishCurrentTurn(state, at, { interrupted: state.activeResponse });
    return startTurn(completed, at);
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
      version: 1,
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
