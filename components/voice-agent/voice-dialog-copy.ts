import type { VoiceTurnPhase } from "@/lib/voice/latency";
import type { CapturedLead } from "@/lib/voice/realtime-events";
import type { VoiceCloseReason, VoiceConnectionStatus } from "./useRealtimeVoiceSession";

/** Stable sonner toast ids so repeated voice events update in place instead of stacking. */
export const voiceToastIds = {
  close: "voice-close",
  live: "voice-live",
  sessionError: "voice-session-error",
  captureWarning: "voice-capture-warning",
} as const;

export const handoffFieldSpecs = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "org", label: "Organisation" },
  { key: "message", label: "Brief" },
] as const satisfies ReadonlyArray<{ key: keyof CapturedLead; label: string }>;

/** Only a valid email is required to send; the rest keep the handoff low-friction. */
const requiredHandoffKeys = ["email"] as const satisfies ReadonlyArray<keyof CapturedLead>;

export function handoffCompletion(captured: CapturedLead) {
  const completed = handoffFieldSpecs.filter((field) => captured[field.key].trim().length > 0);
  return {
    completedCount: completed.length,
    totalCount: handoffFieldSpecs.length,
    ready: requiredHandoffKeys.every((key) => captured[key].trim().length > 0),
    completedKeys: new Set(completed.map((field) => field.key)),
  };
}

export function voiceStatusCopy(
  status: VoiceConnectionStatus,
  turnPhase: VoiceTurnPhase = "quiet",
  showWaitingCopy = false,
) {
  if (status === "requesting_mic") {
    return {
      label: "Mic permission",
      detail: "Allow the microphone when your browser asks. Reka listens only while voice is on.",
      button: "Waiting for the mic...",
    };
  }
  if (status === "connecting") {
    return {
      label: "Setting up",
      detail: "Reka is picking up — she'll greet you in a second.",
      button: "Connecting...",
    };
  }
  if (status === "reconnecting") {
    return {
      label: "Reconnecting",
      detail: "Live voice is busy. Reka is making one quick retry without losing your handoff.",
      button: "Reconnecting...",
    };
  }
  if (status === "listening") {
    if (turnPhase === "user_speaking") {
      return {
        label: "Listening",
        detail: "Keep going — Reka will wait for your turn to end.",
        button: "End voice",
      };
    }
    if (turnPhase === "waiting_for_response") {
      return showWaitingCopy
        ? {
            label: "Reka is responding",
            detail: "Your turn ended. Reka is preparing a reply.",
            button: "End voice",
          }
        : {
            label: "Turn ended",
            detail: "Your pause was detected; no understanding is implied yet.",
            button: "End voice",
          };
    }
    if (turnPhase === "assistant_speaking") {
      return {
        label: "Reka speaking",
        detail: "You can interrupt naturally whenever you need to.",
        button: "End voice",
      };
    }
    return {
      label: "Live now",
      detail: "Speak naturally. Reka will keep the handoff sharp.",
      button: "End voice",
    };
  }
  return {
    label: "Ready",
    detail: "Fill in the handoff details, or start voice when you are ready.",
    button: "Start voice with Reka",
  };
}

export function voiceCloseReasonToast(reason: VoiceCloseReason) {
  if (reason === "error" || reason === "session_failed" || reason === "webrtc_failed") {
    return {
      tone: "error" as const,
      title: "Voice unavailable.",
      description: "You can keep typing in the handoff panel.",
    };
  }
  if (reason === "mic_denied") {
    return {
      tone: "error" as const,
      title: "Microphone access is blocked.",
      description: "Allow microphone access in the browser, or type the handoff instead.",
    };
  }
  if (reason === "voice_limit_reached") {
    return {
      tone: "warning" as const,
      title: "Voice limit reached for today.",
      description: "You can still send the handoff from the panel.",
    };
  }
  if (reason === "realtime_busy") {
    return {
      tone: "warning" as const,
      title: "Live voice is busy right now.",
      description: "Your handoff is still here. Try voice again shortly, or keep typing while the service recovers.",
    };
  }
  if (reason === "disconnected") {
    return {
      tone: "warning" as const,
      title: "Voice disconnected.",
      description: "Your captured details are still here.",
    };
  }
  if (reason === "idle_timeout") {
    return {
      tone: "message" as const,
      title: "Voice ended after inactivity.",
      description: "Your details are still here.",
    };
  }
  if (reason === "max_duration") {
    return {
      tone: "message" as const,
      title: "Voice paused after a long chat.",
      description: "Your details are still here — restart voice anytime to keep going.",
    };
  }
  return null;
}

export const idleGoodbyeInstruction =
  "The visitor has gone quiet and this voice session is about to close. As Reka, say one short, warm goodbye in a single sentence: their typed details stay in the panel and they can restart voice anytime. Do not ask a question and do not wait for a reply.";

export const reconnectVoiceInstruction =
  "The visitor reconnected to voice and the earlier conversation context was just provided. Do not repeat the opening pitch and do not greet from scratch. Acknowledge in one short sentence that you are back, then continue exactly where the conversation left off.";

const openingVoiceInstructionBase =
  "Start the intake now as Reka, pronounced REH-ka. Say exactly one opening sentence: “Hi, I'm Reka. What would you like to build at Oriental?” Then listen. Keep later responses naturally Malaysian, never forced or caricatured. Do not add a pitch, second welcome, pronunciation explanation, tool explanation, privacy note, or form explanation.";

export function openingVoiceInstruction(knownVisitor: boolean) {
  if (!knownVisitor) return openingVoiceInstructionBase;
  return `${openingVoiceInstructionBase} The handoff panel already carries details for this visitor — typed just now or remembered from an earlier visit. Greet them warmly by name if a name is present, acknowledge you can see what is filled in, and never re-ask details that are already there. Do not assume they have visited before unless they say so.`;
}
