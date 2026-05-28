import Redis from "ioredis";
import { readEnv } from "@/lib/env";
import { logWarn } from "@/lib/server/logger";

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
      logWarn("rate_limit.redis_fallback", {
        reason: error instanceof Error ? error.message : "unknown",
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
  const redisKey = `oriental:rate:${key}`;
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
