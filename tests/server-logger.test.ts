import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
const centralLogs = vi.hoisted(() => ({ persistApplicationLog: vi.fn() }));
const nextServer = vi.hoisted(() => ({ after: vi.fn((task: () => unknown) => void task()) }));

vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/server/convex", () => centralLogs);
vi.mock("next/server", () => nextServer);

import { logInfo, retainedApplicationLogRecord, retainedStructuredLog } from "@/lib/server/logger";

describe("central structured-log retention", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    sentry.captureMessage.mockReset();
    centralLogs.persistApplicationLog.mockReset().mockResolvedValue({ ok: true, inserted: true });
    nextServer.after.mockClear();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps PII-free structured events across a disposable container log plane", async () => {
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
    await vi.waitFor(() => expect(centralLogs.persistApplicationLog).toHaveBeenCalledTimes(1));
    expect(centralLogs.persistApplicationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        event: "voice_review.session_snapshot",
        payload: expect.stringContaining('"email":"[redacted]"'),
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

  it("serializes a bounded, PII-free raw structured record for the Convex ledger", () => {
    const record = retainedApplicationLogRecord(
      {
        ts: "2026-08-04T00:00:00.000Z",
        level: "error",
        service: "oriental-website",
        version: "release-sha",
        event: "lead.persistence_failed",
        email: "visitor@example.com",
        providerMessage: "Raw provider text",
        durationMs: 42,
      },
      "log-1",
    );

    expect(record).toMatchObject({
      logId: "log-1",
      occurredAt: Date.parse("2026-08-04T00:00:00.000Z"),
      level: "error",
      event: "lead.persistence_failed",
    });
    expect(JSON.parse(record.payload)).toMatchObject({
      metadata: { email: "[redacted]", providerMessage: "[redacted]", durationMs: 42 },
    });
  });
});
