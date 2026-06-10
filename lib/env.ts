export function unwrapEnvValue(value: string | null | undefined) {
  if (!value) return undefined;
  let trimmed = value.trim();
  for (let depth = 0; depth < 2; depth += 1) {
    const quote = trimmed[0];
    if ((quote !== "'" && quote !== '"') || trimmed.at(-1) !== quote) break;
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed || undefined;
}

export function readEnv(name: string, fallback?: string) {
  return unwrapEnvValue(process.env[name]) ?? fallback;
}

export function isProductionEnv() {
  return readEnv("NODE_ENV") === "production";
}

/** Read a positive integer env value, falling back when unset or invalid. */
export function readPositiveIntEnv(name: string, fallback: number) {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
