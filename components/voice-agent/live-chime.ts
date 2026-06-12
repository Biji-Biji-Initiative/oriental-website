let chimeContext: AudioContext | null = null;

/**
 * Two soft sine notes (~250ms, low gain) marking the moment Reka goes live —
 * presence you can hear, instead of another toast. Failures are swallowed:
 * audio feedback must never break the session flow.
 */
export function playLiveChime() {
  try {
    chimeContext ??= new AudioContext();
    const context = chimeContext;
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    const notes: ReadonlyArray<readonly [frequency: number, at: number, duration: number]> = [
      [659.25, 0, 0.16], // E5
      [880, 0.09, 0.24], // A5
    ];
    for (const [frequency, at, duration] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.045, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + at);
      oscillator.stop(now + at + duration + 0.05);
    }
  } catch {
    // No AudioContext (old browser, autoplay policy): stay silent.
  }
}
