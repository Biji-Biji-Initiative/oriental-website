import { describe, expect, it } from "vitest";
import { leadSubmitErrorCopy, notificationDelivered } from "@/lib/voice/lead-submit";

describe("lead submit helpers", () => {
  it("detects email, Slack, or ClickUp notification delivery", () => {
    expect(notificationDelivered({ notifications: { slack: { ok: true, transport: "slack" } } })).toBe(true);
    expect(notificationDelivered({ notifications: { clickup: { ok: true, transport: "clickup" } } })).toBe(true);
    expect(
      notificationDelivered({ notifications: { email: { ok: false }, slack: { ok: false, skipped: true } } }),
    ).toBe(false);
  });

  it("keeps persisted notification failures distinct from failed submissions", () => {
    expect(leadSubmitErrorCopy(500, { error: "notification_failed", persisted: true })).toEqual({
      title: "Saved, but notifications need attention.",
      description:
        "Your details were stored, but the owner notification did not complete. Please use team@mereka.io if this is urgent.",
    });
  });

  it("explains the voice email confirmation gate", () => {
    expect(leadSubmitErrorCopy(409, { error: "voice_email_unconfirmed" })).toEqual({
      title: "Please confirm the email first.",
      description: "Say yes after Reka reads it back, or edit the email field and send again.",
    });
  });
});
