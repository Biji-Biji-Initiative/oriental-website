import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/analytics";

describe("GA4 event helper", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup of the injected stub
    delete globalThis.window;
  });

  it("no-ops without a window (SSR, tests)", () => {
    expect(() => trackEvent("newsletter_signup")).not.toThrow();
  });

  it("no-ops when gtag is not configured", () => {
    // @ts-expect-error minimal window stub
    globalThis.window = {};
    expect(() => trackEvent("lead_submitted", { segment: "technology" })).not.toThrow();
  });

  it("forwards conversion events to gtag with parameters", () => {
    const gtag = vi.fn();
    // @ts-expect-error minimal window stub
    globalThis.window = { gtag };

    trackEvent("voice_lead_submitted", { segment: "technology", source: "voice" });

    expect(gtag).toHaveBeenCalledWith("event", "voice_lead_submitted", { segment: "technology", source: "voice" });
  });
});
