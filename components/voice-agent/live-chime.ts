let chimeContext: AudioContext | null = null;

export type VoiceActivationCue = {
  tapToArmCueScheduledMs: number;
  /** Monotonic browser marker used only to derive tap-to-live; never persisted. */
  tapStartedAt: number;
};

/**
 * Immediate, local acknowledgement for the user action that starts voice.
 * This must run synchronously inside the initiating event handler so browser
 * audio policy allows it and the UI responds before any network work begins.
 */
export function playArmCue(): VoiceActivationCue {
  const tappedAt = performance.now();
  playNotes([[523.25, 0, 0.085]], 0.032);
  return {
    tapToArmCueScheduledMs: Math.max(0, Math.round(performance.now() - tappedAt)),
    tapStartedAt: tappedAt,
  };
}

/** Complete the activation measurement when the Realtime channel is usable. */
export function measureTapToLive(cue: VoiceActivationCue, liveAt = performance.now()): number {
  return Math.max(0, Math.round(liveAt - cue.tapStartedAt));
}

/**
 * Optional second cue when the data channel becomes live. It is intentionally
 * quieter than the arm cue: the initiating tap already received acknowledgement.
 */
export function playLiveCue() {
  playNotes([[784, 0, 0.13]], 0.018);
}

function playNotes(notes: ReadonlyArray<readonly [frequency: number, at: number, duration: number]>, peakGain: number) {
  try {
    chimeContext ??= new AudioContext();
    const context = chimeContext;
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    for (const [frequency, at, duration] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(peakGain, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + at);
      oscillator.stop(now + at + duration + 0.05);
    }
  } catch {
    // No AudioContext or blocked autoplay: cues are progressive enhancement.
  }
}
