import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { isProductionEnv, readEnv } from "@/lib/env";

export { checkRateLimit, resetRateLimitBucketsForTest } from "@/lib/server/rate-limit";

export function requestIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1"
  );
}

export function hashIp(ip: string, scope = "lead"): string {
  const secret = readEnv("IP_HASH_SECRET", "oriental-local-development") ?? "oriental-local-development";
  return createHash("sha256").update(`${scope}:${secret}:${ip}`).digest("hex");
}

function isLocalDevelopmentIp(ip: string) {
  return ip === "localhost" || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}

export async function verifyTurnstile(token: string | undefined, ip: string) {
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

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    body,
    method: "POST",
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

export function noStoreJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}
