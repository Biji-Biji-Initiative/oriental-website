export type AudioReactivityState = {
  level: number;
  noiseFloor: number;
};

const INITIAL_NOISE_FLOOR = 0.012;
// This floor lives in the gain-adjusted visual domain. Let it learn the full
// bounded analyser range: any lower ceiling creates a band of valid steady
// signals that can pin the orb permanently above its gate.
const MAX_NOISE_FLOOR = 1;

export function createAudioReactivityState(): AudioReactivityState {
  return { level: 0, noiseFloor: INITIAL_NOISE_FLOOR };
}

/**
 * Converts analyser samples into a visual envelope that reacts to quiet speech
 * without turning steady room noise into permanent motion. The activity/latency
 * detector deliberately continues to use its original frequency level.
 */
export function updateAudioReactivity(
  state: AudioReactivityState,
  frequencyLevel: number,
  timeDomainRms: number,
  deltaSeconds: number,
): AudioReactivityState {
  const frequencySignal = clamp01(frequencyLevel);
  const rmsSignal = clamp01(timeDomainRms * 2.8);
  const signal = Math.max(frequencySignal, rmsSignal);
  const delta = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 1 / 60, 1 / 240, 0.1);

  // Follow a steady background slowly at every ordinary room level. Speech
  // attacks the visual envelope much faster than this floor can rise, while a
  // fan or HVAC hum converges back to rest instead of living above a dead zone.
  let noiseFloor = clamp(state.noiseFloor, 0, MAX_NOISE_FLOOR);
  // A learned floor from a louder environment must not mask later quiet speech.
  // Rebase below a materially lower signal; slow upward learning will classify
  // it as new steady room tone if it persists.
  if (signal + 0.012 < noiseFloor && signal < noiseFloor * 0.82) noiseFloor = signal * 0.5;
  const floorTarget = Math.min(signal, MAX_NOISE_FLOOR);
  const floorTimeConstant = floorTarget > noiseFloor ? 4 : 2.2;
  noiseFloor += (floorTarget - noiseFloor) * exponentialEase(delta, floorTimeConstant);

  const excess = Math.max(0, signal - noiseFloor - 0.004);
  const gate = smoothstep(0.006, 0.028, excess);
  const compressed = Math.sqrt(clamp01(excess / 0.22));
  const target = clamp01(gate * compressed);
  const currentLevel = clamp01(state.level);
  const timeConstant = target > currentLevel ? 0.045 : 0.32;
  const level = currentLevel + (target - currentLevel) * exponentialEase(delta, timeConstant);

  return {
    level: level < 0.001 ? 0 : clamp01(level),
    noiseFloor,
  };
}

export function timeDomainRms(samples: Uint8Array) {
  if (samples.length === 0) return 0;
  let squared = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    squared += centered * centered;
  }
  return Math.sqrt(squared / samples.length);
}

function exponentialEase(deltaSeconds: number, timeConstant: number) {
  return 1 - Math.exp(-deltaSeconds / timeConstant);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clamp01((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}
