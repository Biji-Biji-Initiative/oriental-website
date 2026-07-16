import Redis from "ioredis";
import { readEnv } from "@/lib/env";
import { logWarn } from "@/lib/server/logger";
import { sendOpsAlert } from "@/lib/server/ops-alerts";

type LimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  store: "redis" | "memory";
};

const buckets = new Map<string, LimitBucket>();
const redisTimeoutMs = 500;
const redisReadyTimeoutMs = 450;

declare global {
  // eslint-disable-next-line no-var
  var __orientalRateLimitRedis: Redis | undefined;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redis = getRedisClient();
  if (redis) {
    try {
      return await withTimeout(checkRedisLimit(redis, key, limit, windowMs), redisTimeoutMs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      logWarn("rate_limit.redis_fallback", {
        reason,
      });
      void sendOpsAlert({
        event: "rate_limit.redis_fallback",
        severity: "error",
        summary: "Redis-backed rate limiting failed; app is using memory fallback.",
        meta: { reason },
        fingerprint: reason,
      });
    }
  }

  return checkMemoryLimit(key, limit, windowMs);
}

export function resetRateLimitBucketsForTest() {
  if (readEnv("NODE_ENV") !== "test") return;
  buckets.clear();
}

function getRedisClient() {
  const url = readEnv("REDIS_URL") ?? readEnv("UPSTASH_REDIS_URL") ?? readEnv("VALKEY_URL");
  if (!url) return null;
  if (!globalThis.__orientalRateLimitRedis) {
    globalThis.__orientalRateLimitRedis = new Redis(url, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => (attempt > 2 ? null : 100),
    });
  }
  return globalThis.__orientalRateLimitRedis;
}

async function checkRedisLimit(redis: Redis, key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  await ensureRedisReady(redis);
  const environment = readEnv("SENTRY_ENVIRONMENT");
  const scope = environment && environment !== "production" ? `${safeRateLimitScope(environment)}:` : "";
  const redisKey = `oriental:${scope}rate:${key}`;
  const results = await redis.pipeline().incr(redisKey).pttl(redisKey).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  let ttl = Number(results?.[1]?.[1] ?? -1);

  if (count === 1 || ttl < 0) {
    await redis.pexpire(redisKey, windowMs);
    ttl = windowMs;
  }

  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + Math.max(0, ttl),
    store: "redis",
  };
}

function safeRateLimitScope(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 40) || "unknown"
  );
}

async function ensureRedisReady(redis: Redis) {
  if (redis.status === "ready") return;
  if (redis.status === "end") throw new Error("redis_connection_closed");

  if (redis.status === "wait") {
    await redis.connect();
    return;
  }

  await waitForRedisReady(redis);
}

function waitForRedisReady(redis: Redis): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      redis.off("ready", handleReady);
      redis.off("end", handleEnd);
      redis.off("error", handleError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const handleReady = () => finish();
    const handleEnd = () => finish(new Error("redis_connection_closed"));
    const handleError = (error: Error) => finish(error);
    const timeout = setTimeout(() => finish(new Error("redis_connect_timeout")), redisReadyTimeoutMs);

    redis.once("ready", handleReady);
    redis.once("end", handleEnd);
    redis.once("error", handleError);

    // The connection can become ready between the initial status check and
    // listener registration, so recheck after the listeners are attached.
    if (redis.status === "ready") finish();
    if (redis.status === "end") finish(new Error("redis_connection_closed"));
  });
}

function checkMemoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, store: "memory" };
  }
  if (current.count >= limit) {
    return { ok: false, remaining: 0, resetAt: current.resetAt, store: "memory" };
  }
  current.count += 1;
  return { ok: true, remaining: limit - current.count, resetAt: current.resetAt, store: "memory" };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("redis_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
