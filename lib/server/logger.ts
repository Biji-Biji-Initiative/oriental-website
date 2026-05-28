import { readEnv } from "@/lib/env";

type LogLevel = "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|key)$/i;

export function logInfo(event: string, meta: LogMeta = {}) {
  logEvent("info", event, meta);
}

export function logWarn(event: string, meta: LogMeta = {}) {
  logEvent("warn", event, meta);
}

export function logError(event: string, meta: LogMeta = {}) {
  logEvent("error", event, meta);
}

export function errorMeta(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

export function durationSince(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function logEvent(level: LogLevel, event: string, meta: LogMeta) {
  if (readEnv("NODE_ENV") === "test" && readEnv("LOG_TEST_EVENTS") !== "true") return;

  const metaPayload = sanitize(meta);
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: "oriental-website",
    version: readEnv("SOURCE_COMMIT") ?? readEnv("APP_VERSION") ?? readEnv("COMMIT_SHA") ?? "unknown",
    event,
    ...(isRecord(metaPayload) ? metaPayload : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== "object") return value;

  const output: LogMeta = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitize(entry);
  }
  return output;
}

function isRecord(value: unknown): value is LogMeta {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
