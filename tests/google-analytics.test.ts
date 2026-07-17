import { describe, expect, it } from "vitest";
import {
  analyticsPageLocation,
  isAnalyticsConsent,
  isGaMeasurementId,
  shouldTrackPath,
} from "@/components/site/GoogleAnalytics";

describe("GA4 path tracking guard", () => {
  it("tracks public site routes", () => {
    expect(shouldTrackPath("/")).toBe(true);
    expect(shouldTrackPath("/faq")).toBe(true);
  });

  it("never tracks internal admin or API surfaces", () => {
    expect(shouldTrackPath("/admin")).toBe(false);
    expect(shouldTrackPath("/admin/session-review")).toBe(false);
    expect(shouldTrackPath("/api/admin/review")).toBe(false);
  });

  it("skips unknown pathnames instead of guessing", () => {
    expect(shouldTrackPath(null)).toBe(false);
    expect(shouldTrackPath(undefined)).toBe(false);
    expect(shouldTrackPath("")).toBe(false);
  });

  it("accepts only explicit stored consent choices", () => {
    expect(isAnalyticsConsent("granted")).toBe(true);
    expect(isAnalyticsConsent("denied")).toBe(true);
    expect(isAnalyticsConsent(null)).toBe(false);
    expect(isAnalyticsConsent("yes")).toBe(false);
  });

  it("accepts only injection-safe GA4 measurement ids", () => {
    expect(isGaMeasurementId("G-ABC123DEF4")).toBe(true);
    expect(isGaMeasurementId("UA-123")).toBe(false);
    expect(isGaMeasurementId("G-ABC';alert(1)//")).toBe(false);
  });

  it("never includes query strings or fragments in page locations", () => {
    expect(analyticsPageLocation("https://oriental.mereka.io", "/faq")).toBe("https://oriental.mereka.io/faq");
  });
});
