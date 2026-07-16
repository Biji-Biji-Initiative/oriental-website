import { errorMeta, logWarn } from "@/lib/server/logger";
import type { NotificationResult } from "@/lib/server/notifications";

export function settledNotificationResult(
  result: PromiseSettledResult<NotificationResult>,
  fallback: string,
  logEvent: string,
): NotificationResult {
  if (result.status === "fulfilled") return result.value;
  logWarn(logEvent, { fallback, error: errorMeta(result.reason) });
  return { ok: false, error: fallback };
}

export function publicNotificationResult(result: NotificationResult): NotificationResult {
  if (!result.ok) return result;
  return { ok: true, transport: result.transport };
}
