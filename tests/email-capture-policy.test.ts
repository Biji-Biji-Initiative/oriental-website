import { describe, expect, it } from "vitest";
import { adaptiveEmailToolInstructions, resolveVoiceEmailCaptureMode } from "@/lib/voice/email-capture-policy";

describe("voice email capture policy", () => {
  it("fails closed to strict mode for missing or unknown values", () => {
    expect(resolveVoiceEmailCaptureMode(undefined)).toBe("strict");
    expect(resolveVoiceEmailCaptureMode("relaxed")).toBe("strict");
  });

  it("accepts an explicitly configured adaptive mode", () => {
    expect(resolveVoiceEmailCaptureMode(" ADAPTIVE ")).toBe("adaptive");
    expect(adaptiveEmailToolInstructions("adaptive").join(" ")).toContain("without asking for a separate yes");
  });
});
