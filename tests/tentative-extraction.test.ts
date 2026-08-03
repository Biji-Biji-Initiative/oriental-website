import { describe, expect, it } from "vitest";
import {
  extractExplicitSpelledVisitorName,
  extractExplicitVisitorBrief,
  extractExplicitVisitorEmail,
} from "@/lib/voice/tentative-extraction";

describe("explicit voice corrections", () => {
  it("accepts a first-person request to provide an email by voice", () => {
    expect(extractExplicitVisitorEmail("I want to use my voice to do the email gurpreet@singapore.com.")).toBe(
      "gurpreet@singapore.com",
    );
  });

  it("accepts an explicitly owned spoken email without relying on a model tool call", () => {
    expect(
      extractExplicitVisitorEmail(
        "My email is q a dot nebula at example dot test. Please capture it, but do not send.",
      ),
    ).toBe("qa.nebula@example.test");
  });

  it("does not claim a third-party email from nearby prose", () => {
    expect(extractExplicitVisitorEmail("I saw their email person@example.com in the brochure.")).toBeNull();
    expect(extractExplicitVisitorEmail("My colleague's email is q a dot nebula at example dot test.")).toBeNull();
  });

  it("joins a directly spelled name without guessing from normal prose", () => {
    expect(extractExplicitSpelledVisitorName("Guruprit is G-U-R-P-R-E-E-T.")).toBe("Gurpreet");
    expect(extractExplicitSpelledVisitorName("My name is G U R P R E E T I am from Mereka.")).toBe("Gurpreet");
    expect(extractExplicitSpelledVisitorName("We are building a community lab.")).toBeNull();
  });

  it("keeps a directly offered collaboration idea when the model misses its tool call", () => {
    expect(extractExplicitVisitorBrief("We want to run a croissant-making workshop at Oriental.")).toBe(
      "We want to run a croissant-making workshop at Oriental",
    );
    expect(extractExplicitVisitorBrief("I want to use my voice to do the email hello@example.com.")).toBeNull();
    expect(extractExplicitVisitorBrief("We want to host a workshop; call 60123456789.")).toBeNull();
    expect(extractExplicitVisitorBrief("Can I just chat with Reka?")).toBeNull();
  });
});
