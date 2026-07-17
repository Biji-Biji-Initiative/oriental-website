/**
 * Client-side GA4 event helper. `window.gtag` exists only when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is configured (see
 * components/site/GoogleAnalytics.tsx), so this is a safe no-op everywhere
 * else — tests, admin, and unconfigured environments.
 *
 * PII rule: event parameters MUST NOT contain names, emails, phone numbers,
 * transcripts, or free-text messages. Segments, sources, and variant labels
 * only.
 */
export type AnalyticsEventName =
  | "lead_submitted"
  | "voice_lead_submitted"
  | "voice_session_started"
  | "newsletter_signup";

export function trackEvent(name: AnalyticsEventName, params: Record<string, string | number | boolean> = {}) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", name, params);
}
