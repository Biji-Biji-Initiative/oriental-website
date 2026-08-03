type ScrubbableRequest = {
  cookies?: unknown;
  data?: unknown;
  headers?: unknown;
  method?: string;
  query_string?: unknown;
  url?: string;
};

type ScrubbableSpan = {
  data: Record<string, unknown>;
};

type ScrubbableEvent = {
  breadcrumbs?: unknown;
  contexts?: unknown;
  exception?: { values?: Array<Record<string, unknown>> };
  extra?: unknown;
  logentry?: unknown;
  message?: unknown;
  request?: ScrubbableRequest;
  spans?: ScrubbableSpan[];
  tags?: unknown;
  user?: unknown;
};

type StructuredLog = {
  schema: "oriental.application_log.v1";
  ts: string;
  level: "info" | "warn" | "error";
  service: "oriental-website";
  version: string;
  event: string;
  metadata: unknown;
};

const SAFE_LOG_EVENT = /^[a-z][a-z0-9_.-]{0,120}$/i;
const SAFE_LOG_LEVELS = new Set<StructuredLog["level"]>(["info", "warn", "error"]);
const SENSITIVE_LOG_KEY =
  /(email|name|phone|address|message|transcript|content|body|input|output|token|secret|password|authorization|cookie|key|actor|user|id)$/i;

/**
 * Sentry is operational telemetry, never a second store for enquiry content.
 * Keep only the request method and a query-free route URL; bodies, cookies,
 * headers, query values, users, and request-body span attributes are removed.
 */
export function scrubSentryEvent<T extends object>(event: T): T {
  const scrubbed = event as ScrubbableEvent;
  const structuredLog = readStructuredLog(scrubbed.extra);
  delete scrubbed.user;
  // Structured application logs remain the detailed diagnostic plane. Sentry
  // gets the fixed event name/stack/trace, never arbitrary extras or browser
  // breadcrumbs that may echo visitor input.
  delete scrubbed.extra;
  delete scrubbed.breadcrumbs;
  delete scrubbed.contexts;
  delete scrubbed.logentry;
  delete scrubbed.message;
  delete scrubbed.tags;
  if (structuredLog) {
    scrubbed.extra = { structured_log: structuredLog };
    scrubbed.message = `log:${structuredLog.event}`;
    scrubbed.tags = {
      service: structuredLog.service,
      event: structuredLog.event,
      level: structuredLog.level,
      log_kind: "structured",
    };
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception.values = scrubbed.exception.values.map((entry) => {
      const safe: Record<string, unknown> = {};
      if (typeof entry.type === "string") safe.type = entry.type.slice(0, 120);
      if (entry.stacktrace) safe.stacktrace = entry.stacktrace;
      return safe;
    });
  }
  if (scrubbed.request) {
    const requestRecord = scrubbed.request as unknown as Record<string, unknown>;
    for (const key of Object.keys(requestRecord)) {
      if (key !== "method" && key !== "url") delete requestRecord[key];
    }
    const safeUrl = queryFreeUrl(scrubbed.request.url);
    if (safeUrl) scrubbed.request.url = safeUrl;
    else delete scrubbed.request.url;
  }
  if (scrubbed.spans) scrubbed.spans = scrubbed.spans.map(scrubSentrySpan);
  return event;
}

function readStructuredLog(value: unknown): StructuredLog | undefined {
  if (!isRecord(value) || !isRecord(value.structuredLog)) return undefined;
  const candidate = value.structuredLog;
  if (
    candidate.schema !== "oriental.application_log.v1" ||
    typeof candidate.ts !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.event !== "string" ||
    !SAFE_LOG_EVENT.test(candidate.event) ||
    !SAFE_LOG_LEVELS.has(candidate.level as StructuredLog["level"])
  ) {
    return undefined;
  }
  return {
    schema: "oriental.application_log.v1",
    ts: candidate.ts.slice(0, 48),
    level: candidate.level as StructuredLog["level"],
    service: "oriental-website",
    version: candidate.version.slice(0, 120),
    event: candidate.event,
    metadata: scrubStructuredMetadata(candidate.metadata),
  };
}

function scrubStructuredMetadata(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return "[redacted]";
  if (depth >= 4) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 24).map((entry) => scrubStructuredMetadata(entry, depth + 1));
  if (!isRecord(value)) return "[redacted]";
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 48)
      .map(([key, entry]) => [
        key.slice(0, 80),
        SENSITIVE_LOG_KEY.test(key) ? "[redacted]" : scrubStructuredMetadata(entry, depth + 1),
      ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function scrubSentrySpan<T extends ScrubbableSpan>(span: T): T {
  for (const key of Object.keys(span.data)) {
    if (!SAFE_SPAN_DATA_KEYS.has(key)) delete span.data[key];
  }
  const fullUrl = span.data["url.full"];
  if (typeof fullUrl === "string") {
    const safeUrl = queryFreeUrl(fullUrl);
    if (safeUrl) span.data["url.full"] = safeUrl;
    else delete span.data["url.full"];
  }
  return span;
}

const SAFE_SPAN_DATA_KEYS = new Set([
  "http.request.method",
  "http.response.status_code",
  "network.protocol.version",
  "server.address",
  "server.port",
  "url.full",
]);

function queryFreeUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, "https://redaction.invalid");
    if (parsed.origin === "https://redaction.invalid") return parsed.pathname;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}
