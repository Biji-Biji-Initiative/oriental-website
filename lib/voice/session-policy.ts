export type VoiceDurationPolicy = {
  maxDurationMs: number;
  idleTimeoutMs: number;
  idleGoodbyeGraceMs: number;
};

export const VOICE_DURATION_LIMITS = {
  maxDurationMs: 1_800_000,
  maxIdleGoodbyeGraceMs: 30_000,
} as const;

export const VOICE_HEARTBEAT_INTERVAL_MS = 12_000;
export const MIN_ORPHAN_STALE_MS =
  VOICE_DURATION_LIMITS.maxDurationMs + VOICE_DURATION_LIMITS.maxIdleGoodbyeGraceMs + 2 * VOICE_HEARTBEAT_INTERVAL_MS;
export const MIN_ORPHAN_STALE_MINUTES = Math.ceil(MIN_ORPHAN_STALE_MS / 60_000);
export const DEFAULT_ORPHAN_STALE_MINUTES = 35;

export const VOICE_DURATION_DEFAULTS: VoiceDurationPolicy = {
  maxDurationMs: 600_000,
  idleTimeoutMs: 20_000,
  idleGoodbyeGraceMs: 6_000,
};

export function resolveVoiceDurationPolicy(input: {
  maxDurationMs?: string | number | null;
  idleTimeoutMs?: string | number | null;
  idleGoodbyeGraceMs?: string | number | null;
}): VoiceDurationPolicy {
  const maxDurationMs = boundedDuration(
    input.maxDurationMs,
    VOICE_DURATION_DEFAULTS.maxDurationMs,
    60_000,
    VOICE_DURATION_LIMITS.maxDurationMs,
  );
  const idleTimeoutMs = boundedDuration(input.idleTimeoutMs, VOICE_DURATION_DEFAULTS.idleTimeoutMs, 5_000, 120_000);
  const idleGoodbyeGraceMs = Math.min(
    boundedDuration(
      input.idleGoodbyeGraceMs,
      VOICE_DURATION_DEFAULTS.idleGoodbyeGraceMs,
      1_000,
      VOICE_DURATION_LIMITS.maxIdleGoodbyeGraceMs,
    ),
    Math.max(1_000, idleTimeoutMs - 1_000),
  );
  return { maxDurationMs, idleTimeoutMs, idleGoodbyeGraceMs };
}

function boundedDuration(value: string | number | null | undefined, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.round(parsed);
}
