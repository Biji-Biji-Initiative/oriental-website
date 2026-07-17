import { describe, expect, it } from "vitest";
import { scrubSentryEvent, scrubSentrySpan } from "@/lib/sentry-privacy";

describe("Sentry privacy boundary", () => {
  it("removes request PII while retaining a query-free operational route", () => {
    const event = scrubSentryEvent({
      breadcrumbs: [{ message: "visitor@example.com typed private words" }],
      contexts: { response: { body: "visitor@example.com private words" } },
      exception: {
        values: [
          {
            type: "ProviderError",
            value: "visitor@example.com private words",
            mechanism: { data: { email: "visitor@example.com" } },
            stacktrace: { frames: [{ filename: "route.ts", lineno: 1 }] },
          },
        ],
      },
      extra: { email: "visitor@example.com", transcript: "private words" },
      logentry: { message: "visitor@example.com private words" },
      message: "visitor@example.com private words",
      tags: { visitor: "visitor@example.com" },
      user: { email: "visitor@example.com" },
      request: {
        cookies: { session: "secret" },
        data: { email: "visitor@example.com", transcript: "private words" },
        env: { REMOTE_ADDR: "203.0.113.1" },
        headers: { authorization: "Bearer secret", cookie: "session=secret" },
        method: "POST",
        query_string: "email=visitor%40example.com",
        url: "https://oriental.mereka.io/api/leads?email=visitor%40example.com#private",
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.contexts).toBeUndefined();
    expect(event.logentry).toBeUndefined();
    expect(event.message).toBeUndefined();
    expect(event.tags).toBeUndefined();
    expect(event.exception).toEqual({
      values: [{ type: "ProviderError", stacktrace: { frames: [{ filename: "route.ts", lineno: 1 }] } }],
    });
    expect(event.request).toEqual({ method: "POST", url: "https://oriental.mereka.io/api/leads" });
    expect(JSON.stringify(event)).not.toContain("visitor@example.com");
    expect(JSON.stringify(event)).not.toContain("private words");
  });

  it("removes body, query, and sensitive header attributes from trace spans", () => {
    const span = scrubSentrySpan({
      data: {
        "http.request.body.data": '{"email":"visitor@example.com"}',
        "http.request.header.authorization": "Bearer secret",
        "url.full": "https://oriental.mereka.io/api/voice/debug?review=private",
        "url.query": "review=private",
        safe_counter: 3,
        "http.response.status_code": 429,
      },
      description: "POST /api/voice/debug",
      op: "http.server",
      parent_span_id: "1234567890abcdef",
      span_id: "abcdef1234567890",
      start_timestamp: 1,
      timestamp: 2,
      trace_id: "1234567890abcdef1234567890abcdef",
    });

    expect(span.data).toEqual({
      "url.full": "https://oriental.mereka.io/api/voice/debug",
      "http.response.status_code": 429,
    });
  });

  it("drops non-http URL schemes instead of retaining opaque contact data", () => {
    const event = scrubSentryEvent({ request: { method: "GET", url: "mailto:visitor@example.com" } });

    expect(event.request).toEqual({ method: "GET" });
    expect(JSON.stringify(event)).not.toContain("visitor@example.com");
  });
});
