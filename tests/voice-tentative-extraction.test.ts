import { describe, expect, it } from "vitest";
import { extractExplicitVisitorEmail } from "@/lib/voice/tentative-extraction";

describe("tentative contact extraction", () => {
  it("accepts a literal address alone or with explicit ownership", () => {
    expect(extractExplicitVisitorEmail("asha.lim+ai@example.com")).toBe("asha.lim+ai@example.com");
    expect(extractExplicitVisitorEmail("My email address is asha@example.com.")).toBe("asha@example.com");
    expect(extractExplicitVisitorEmail("You can reach me at asha@example.com")).toBe("asha@example.com");
  });

  it("rejects examples and third-party addresses", () => {
    expect(extractExplicitVisitorEmail("For example, team@example.com is on the website.")).toBeNull();
    expect(extractExplicitVisitorEmail("Please send this to Nadia at nadia@example.com.")).toBeNull();
  });

  it("does not guess spoken punctuation", () => {
    expect(extractExplicitVisitorEmail("asha dot lim at example dot com")).toBeNull();
  });
});
