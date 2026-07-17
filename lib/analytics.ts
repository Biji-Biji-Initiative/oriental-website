import {
  type IntakeAnalyticsEvent,
  type IntakeAnalyticsParametersByEvent,
  trackIntakeEvent,
} from "@/lib/client-analytics";

/**
 * Typed compatibility adapter for the site's GA4 conversion events. All
 * events share the intake pipeline's explicit-consent check and runtime
 * allowlist, so a stale `window.gtag` after consent withdrawal cannot emit
 * conversions and unexpected/free-form parameters are discarded.
 */
export type AnalyticsEventName = Extract<
  IntakeAnalyticsEvent,
  "lead_submitted" | "voice_lead_submitted" | "voice_session_started" | "newsletter_signup"
>;

export function trackEvent<Event extends AnalyticsEventName>(
  name: Event,
  params: IntakeAnalyticsParametersByEvent[Event],
) {
  trackIntakeEvent(name, params);
}
