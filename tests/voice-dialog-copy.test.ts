import { describe, expect, it } from "vitest";
import { openingVoiceInstruction, voiceStatusCopy } from "@/components/voice-agent/voice-dialog-copy";

describe("voice dialogue activation copy", () => {
  it("uses the reviewed one-sentence opener", () => {
    const instruction = openingVoiceInstruction(false);
    expect(instruction).toContain("Hi, I'm Reka. What would you like to build at Oriental?");
    expect(instruction).toContain("exactly one opening sentence");
  });

  it("acknowledges a detected pause without claiming understanding", () => {
    const immediate = voiceStatusCopy("listening", "waiting_for_response", false);
    expect(immediate.label).toBe("Turn ended");
    expect(immediate.detail).toContain("no understanding is implied");

    const delayed = voiceStatusCopy("listening", "waiting_for_response", true);
    expect(delayed.label).toBe("Reka is responding");
  });

  it("maps speaking phases to distinct live states", () => {
    expect(voiceStatusCopy("listening", "user_speaking").label).toBe("Listening");
    expect(voiceStatusCopy("listening", "assistant_speaking").label).toBe("Reka speaking");
  });
});
