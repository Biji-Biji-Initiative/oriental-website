import { describe, expect, it } from "vitest";
import { shouldTrackPath } from "@/components/site/GoogleAnalytics";

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
});
