// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { type IntakeAnalyticsParametersByEvent, trackIntakeEvent } from "@/lib/client-analytics";

describe("intake client analytics", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.gtag = undefined;
  });

  it("emits bounded product events only after explicit analytics consent", () => {
    const gtag = vi.fn();
    window.gtag = gtag;

    trackIntakeEvent("intake_open", { entry_point: "hero_primary", entry_method: "form", intended_mode: "form" });
    expect(gtag).not.toHaveBeenCalled();

    window.localStorage.setItem("oriental_analytics_consent_v1", "granted");
    trackIntakeEvent("intake_open", {
      entry_point: "hero_primary",
      entry_method: "form",
      intended_mode: "form",
      absent: undefined,
    } as unknown as IntakeAnalyticsParametersByEvent["intake_open"]);
    expect(gtag).toHaveBeenCalledWith("event", "intake_open", {
      entry_point: "hero_primary",
      entry_method: "form",
      intended_mode: "form",
    });
  });

  it("drops unknown, PII-shaped, cross-event, and out-of-range parameters at runtime", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.localStorage.setItem("oriental_analytics_consent_v1", "granted");

    trackIntakeEvent("intake_submit_failure", {
      entry_point: "hero_primary",
      entry_method: "voice_button",
      submission_method: "voice_command",
      session_mode: "voice",
      completed_field_count: 3,
      voice_field_count: 7,
      manual_field_count: -1,
      mixed_field_count: 0,
      corrected_field_count: 0,
      failure_class: "network",
      email: "person@example.com",
      intended_mode: "voice",
      arbitrary_boolean: true,
    } as unknown as IntakeAnalyticsParametersByEvent["intake_submit_failure"]);

    expect(gtag).toHaveBeenCalledWith("event", "intake_submit_failure", {
      entry_point: "hero_primary",
      entry_method: "voice_button",
      submission_method: "voice_command",
      session_mode: "voice",
      completed_field_count: 3,
      mixed_field_count: 0,
      corrected_field_count: 0,
      failure_class: "network",
    });
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("person@example.com");
  });

  it("drops invalid category values instead of forwarding caller strings", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    window.localStorage.setItem("oriental_analytics_consent_v1", "granted");

    trackIntakeEvent("intake_open", {
      entry_point: "A user-controlled label",
      entry_method: "clicked a bespoke thing",
      intended_mode: "form",
    } as unknown as IntakeAnalyticsParametersByEvent["intake_open"]);

    expect(gtag).toHaveBeenCalledWith("event", "intake_open", { intended_mode: "form" });
  });
});
