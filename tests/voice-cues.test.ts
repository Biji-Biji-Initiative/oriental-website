import { describe, expect, it } from "vitest";
import { playArmCue, playLiveCue } from "@/components/voice-agent/live-chime";

describe("voice activation cues", () => {
  it("returns a bounded local scheduling duration even when Web Audio is unavailable", () => {
    const cue = playArmCue();
    expect(cue.tapToArmCueScheduledMs).toBeGreaterThanOrEqual(0);
    expect(cue.tapToArmCueScheduledMs).toBeLessThan(100);
    expect(() => playLiveCue()).not.toThrow();
  });
});
