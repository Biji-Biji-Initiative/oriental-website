import { describe, expect, it } from "vitest";
import { extractExplicitSpelledVisitorName, extractExplicitVisitorEmail } from "@/lib/voice/tentative-extraction";

describe("explicit voice corrections", () => {
  it("accepts a first-person request to provide an email by voice", () => {
    expect(extractExplicitVisitorEmail("I want to use my voice to do the email gurpreet@singapore.com.")).toBe(
      "gurpreet@singapore.com",
    );
  });

  it("does not claim a third-party email from nearby prose", () => {
    expect(extractExplicitVisitorEmail("I saw their email person@example.com in the brochure.")).toBeNull();
  });

  it("joins a directly spelled name without guessing from normal prose", () => {
    expect(extractExplicitSpelledVisitorName("Guruprit is G-U-R-P-R-E-E-T.")).toBe("Gurpreet");
    expect(extractExplicitSpelledVisitorName("We are building a community lab.")).toBeNull();
  });
});
