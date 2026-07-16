import { beforeEach, describe, expect, it, vi } from "vitest";

const redisState = vi.hoisted(() => ({
  connectCalls: 0,
  connectError: null as Error | null,
  events: [] as string[],
  expireCalls: 0,
  keys: [] as string[],
}));

vi.mock("ioredis", () => ({
  default: class RedisMock {
    status = "wait";

    async connect() {
      redisState.connectCalls += 1;
      redisState.events.push("connect");
      if (redisState.connectError) {
        this.status = "close";
        throw redisState.connectError;
      }
      this.status = "ready";
    }

    pipeline() {
      redisState.events.push("pipeline");
      const pipeline = {
        incr: (key: string) => {
          redisState.keys.push(key);
          return pipeline;
        },
        pttl: () => pipeline,
        exec: async () => [
          [null, 1],
          [null, -1],
        ],
      };
      return pipeline;
    }

    async pexpire() {
      redisState.expireCalls += 1;
      return 1;
    }
  },
}));

vi.mock("@/lib/server/logger", () => ({
  logWarn: vi.fn(),
}));

vi.mock("@/lib/server/ops-alerts", () => ({
  sendOpsAlert: vi.fn().mockResolvedValue({ ok: false, skipped: true }),
}));

import { logWarn } from "@/lib/server/logger";
import { checkRateLimit, resetRateLimitBucketsForTest } from "@/lib/server/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REDIS_URL", "redis://rate-limit.test");
    globalThis.__orientalRateLimitRedis = undefined;
    redisState.connectCalls = 0;
    redisState.connectError = null;
    redisState.events = [];
    redisState.expireCalls = 0;
    redisState.keys = [];
    vi.mocked(logWarn).mockClear();
    resetRateLimitBucketsForTest();
  });

  it("isolates non-production rate limits without changing production keys", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    await checkRateLimit("voice:abc", 3, 60_000);
    expect(redisState.keys).toEqual(["oriental:staging:rate:voice:abc"]);

    globalThis.__orientalRateLimitRedis = undefined;
    redisState.keys = [];
    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    await checkRateLimit("voice:abc", 3, 60_000);
    expect(redisState.keys).toEqual(["oriental:rate:voice:abc"]);
  });

  it("connects a lazy Redis client before the first pipeline", async () => {
    const result = await checkRateLimit("first", 3, 60_000);

    expect(result).toMatchObject({ ok: true, remaining: 2, store: "redis" });
    expect(redisState.events).toEqual(["connect", "pipeline"]);
    expect(redisState.connectCalls).toBe(1);
    expect(redisState.expireCalls).toBe(1);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("reuses the ready Redis connection without reconnecting", async () => {
    await checkRateLimit("first", 3, 60_000);
    await checkRateLimit("second", 3, 60_000);

    expect(redisState.events).toEqual(["connect", "pipeline", "pipeline"]);
    expect(redisState.connectCalls).toBe(1);
  });

  it("falls back to the bounded in-memory limiter when Redis cannot connect", async () => {
    redisState.connectError = new Error("redis unavailable");

    const result = await checkRateLimit("fallback", 3, 60_000);

    expect(result).toMatchObject({ ok: true, remaining: 2, store: "memory" });
    expect(redisState.events).toEqual(["connect"]);
    expect(logWarn).toHaveBeenCalledWith("rate_limit.redis_fallback", { reason: "redis unavailable" });
  });
});
