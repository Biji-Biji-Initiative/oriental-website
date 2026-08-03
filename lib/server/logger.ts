import * as Sentry from "@sentry/nextjs";
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
  // Containers are disposable in Coolify. Keep an intentionally PII-free copy
  // of every structured application event in the configured Sentry project so
  // an operator can still see its history after a container is replaced.
  if (readEnv("SENTRY_DSN")) {
    Sentry.captureMessage(`log:${event}`, {
      level: level === "warn" ? "warning" : level,
      tags: { service: "oriental-website", event, log_kind: "structured" },
      extra: { structuredLog: retainedStructuredLog(payload) },
    });
  }
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

/**
 * Central log retention keeps event identity and numeric/boolean diagnostics,
 * but never copies free-form values (which can contain visitor content) out of
 * the disposable container log plane.
 */
export function retainedStructuredLog(payload: LogMeta): LogMeta {
  return {
    schema: "oriental.application_log.v1",
    ts: typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
    level: payload.level,
    service: "oriental-website",
    version: typeof payload.version === "string" ? payload.version : "unknown",
    event: typeof payload.event === "string" ? payload.event : "unknown",
    metadata: retainMetadata(payload),
  };
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

function retainMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return "[redacted]";
  if (depth >= 4) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 24).map((entry) => retainMetadata(entry, depth + 1));
  if (!isRecord(value)) return "[redacted]";

  const output: LogMeta = {};
  for (const [key, entry] of Object.entries(value)) {
    if (["ts", "level", "service", "version", "event"].includes(key)) continue;
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : retainMetadata(entry, depth + 1);
  }
  return output;
}

function isRecord(value: unknown): value is LogMeta {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
