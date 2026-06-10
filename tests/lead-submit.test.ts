import { describe, expect, it } from "vitest";
import { leadSubmitErrorCopy, notificationDelivered } from "@/lib/voice/lead-submit";

describe("lead submit helpers", () => {
  it("detects either email or Slack notification delivery", () => {
    expect(notificationDelivered({ notifications: { slack: { ok: true, transport: "slack" } } })).toBe(true);
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
});
