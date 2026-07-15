/**
 * Pure audio-activity detector used by the browser analysers.
 *
 * The detector is deliberately independent of animation preferences. Visual
 * motion may be disabled, but remote-audio onset and local speech-end timing
 * must remain measurable for latency evaluation.
 */

export type AudioActivityState = {
  active: boolean;
  lastActiveAt?: number;
};

export type AudioActivityTransition = "started" | "stopped" | null;

export const AUDIO_ACTIVITY_THRESHOLD = 0.055;
export const AUDIO_ACTIVITY_SILENCE_HOLD_MS = 180;

export function detectAudioActivity(
  state: AudioActivityState,
  level: number,
  at: number,
  options: { threshold?: number; silenceHoldMs?: number } = {},
): { state: AudioActivityState; transition: AudioActivityTransition } {
  const threshold = options.threshold ?? AUDIO_ACTIVITY_THRESHOLD;
  const silenceHoldMs = options.silenceHoldMs ?? AUDIO_ACTIVITY_SILENCE_HOLD_MS;
  const aboveThreshold = Number.isFinite(level) && level >= threshold;

  if (aboveThreshold) {
    return {
      state: { active: true, lastActiveAt: at },
      transition: state.active ? null : "started",
    };
  }

  if (!state.active || state.lastActiveAt === undefined || at - state.lastActiveAt < silenceHoldMs) {
    return { state, transition: null };
  }

  return {
    state: { active: false },
    transition: "stopped",
  };
}
