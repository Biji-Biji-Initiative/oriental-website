import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { isProductionEnv, readEnv } from "@/lib/env";

export { checkRateLimit, resetRateLimitBucketsForTest } from "@/lib/server/rate-limit";

export function requestIp(request: NextRequest): string {
  // Traefik owns X-Forwarded-For at the direct origin. Read from the trusted
  // proxy side of the chain and never trust CF-Connecting-IP here: while the
  // DNS record is unproxied, a client can supply that header directly.
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const proxyAddress = forwarded?.at(-1);
  if (proxyAddress && isIP(proxyAddress)) return proxyAddress;

  // A stable sentinel fails closed into a shared rate-limit bucket when proxy
  // metadata is absent or malformed instead of accepting attacker input.
  return "0.0.0.0";
}

export function rateLimitResponseHeaders(resetAt: number, now = Date.now()) {
  return {
    "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };
}

export function hashIp(ip: string, scope = "lead"): string {
  const secret = readEnv("IP_HASH_SECRET", "oriental-local-development") ?? "oriental-local-development";
  return createHash("sha256").update(`${scope}:${secret}:${ip}`).digest("hex");
}

function isLocalDevelopmentIp(ip: string) {
  return ip === "localhost" || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}

function turnstileRequired() {
  return readEnv("TURNSTILE_ENFORCEMENT") === "required";
}

export async function verifyTurnstile(token: string | undefined, ip: string) {
  if (!turnstileRequired()) return true;

  if (!isProductionEnv() && token === "local-dev" && isLocalDevelopmentIp(ip)) {
    return true;
  }

  const secret = readEnv("TURNSTILE_SECRET_KEY");
  if (!secret) {
    return !isProductionEnv();
  }
  if (!token) return false;

  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  body.set("remoteip", ip);

  // A Turnstile outage must degrade to a clean rejection, not a hung or crashed request.
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      body,
      method: "POST",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

export function noStoreJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}
