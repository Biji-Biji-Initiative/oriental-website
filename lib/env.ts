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
