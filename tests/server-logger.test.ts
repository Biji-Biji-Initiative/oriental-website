import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));

vi.mock("@sentry/nextjs", () => sentry);

import { logInfo, retainedStructuredLog } from "@/lib/server/logger";

describe("central structured-log retention", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    sentry.captureMessage.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps PII-free structured events across a disposable container log plane", () => {
    logInfo("voice_review.session_snapshot", {
      durationMs: 48,
      email: "visitor@example.com",
      transcript: "Private visitor words.",
      connected: true,
    });

    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "log:voice_review.session_snapshot",
      expect.objectContaining({
        level: "info",
        tags: expect.objectContaining({ log_kind: "structured" }),
        extra: {
          structuredLog: expect.objectContaining({
            event: "voice_review.session_snapshot",
            metadata: {
              durationMs: 48,
              email: "[redacted]",
              transcript: "[redacted]",
              connected: true,
            },
          }),
        },
      }),
    );
  });

  it("never retains free-form metadata values", () => {
    expect(
      retainedStructuredLog({
        ts: "2026-08-03T00:00:00.000Z",
        level: "warn",
        service: "oriental-website",
        version: "abc123",
        event: "voice_review.session_errors",
        reason: "Private provider detail",
        count: 3,
      }),
    ).toMatchObject({ metadata: { reason: "[redacted]", count: 3 } });
  });
});
