// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/analytics";
import type { IntakeAnalyticsParametersByEvent } from "@/lib/client-analytics";

describe("GA4 event helper", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.gtag = undefined;
  });

  it("forwards bounded conversion events only after explicit consent", () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    trackEvent("voice_lead_submitted", { segment: "technology", source: "voice" });
    expect(gtag).not.toHaveBeenCalled();

    window.localStorage.setItem("oriental_analytics_consent_v1", "granted");
    trackEvent("voice_lead_submitted", { segment: "technology", source: "voice" });

    expect(gtag).toHaveBeenCalledWith("event", "voice_lead_submitted", { segment: "technology", source: "voice" });
  });

  it("stops future conversion events after consent withdrawal even when gtag remains", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.localStorage.setItem("oriental_analytics_consent_v1", "denied");

    trackEvent("newsletter_signup", { placement: "hero" });

    expect(gtag).not.toHaveBeenCalled();
  });

  it("drops unexpected, free-form, and invalid conversion parameters at runtime", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.localStorage.setItem("oriental_analytics_consent_v1", "granted");

    trackEvent("voice_session_started", {
      segment: "technology",
      voice_variant: "made-up-variant",
      email: "person@example.com",
      error: "user-controlled text",
    } as unknown as IntakeAnalyticsParametersByEvent["voice_session_started"]);

    expect(gtag).toHaveBeenCalledWith("event", "voice_session_started", { segment: "technology" });
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("person@example.com");
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("user-controlled text");
  });
});
