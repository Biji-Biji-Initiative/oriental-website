export const REALTIME_BUSY_MAX_RETRIES = 1;
export const REALTIME_BUSY_RETRY_MIN_MS = 300;
export const REALTIME_BUSY_RETRY_MAX_MS = 700;

export function shouldRetryRealtimeCall(status: number, retriesUsed: number) {
  return status === 429 && retriesUsed < REALTIME_BUSY_MAX_RETRIES;
}

export function realtimeBusyRetryDelayMs(randomValue = Math.random()) {
  const bounded = Math.min(1, Math.max(0, randomValue));
  return Math.round(REALTIME_BUSY_RETRY_MIN_MS + bounded * (REALTIME_BUSY_RETRY_MAX_MS - REALTIME_BUSY_RETRY_MIN_MS));
}
