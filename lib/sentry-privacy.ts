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

/**
 * Sentry is operational telemetry, never a second store for enquiry content.
 * Keep only the request method and a query-free route URL; bodies, cookies,
 * headers, query values, users, and request-body span attributes are removed.
 */
export function scrubSentryEvent<T extends object>(event: T): T {
  const scrubbed = event as ScrubbableEvent;
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
