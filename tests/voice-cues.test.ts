import { describe, expect, it } from "vitest";
import { measureTapToLive, playArmCue, playLiveCue } from "@/components/voice-agent/live-chime";

describe("voice activation cues", () => {
  it("returns a bounded local scheduling duration even when Web Audio is unavailable", () => {
    const cue = playArmCue();
    expect(cue.tapToArmCueScheduledMs).toBeGreaterThanOrEqual(0);
    expect(cue.tapToArmCueScheduledMs).toBeLessThan(100);
    expect(cue.tapStartedAt).toBeGreaterThanOrEqual(0);
    expect(() => playLiveCue()).not.toThrow();
  });

  it("measures the exact initiating tap to live-channel interval", () => {
    expect(measureTapToLive({ tapStartedAt: 100, tapToArmCueScheduledMs: 4 }, 480)).toBe(380);
    expect(measureTapToLive({ tapStartedAt: 500, tapToArmCueScheduledMs: 4 }, 480)).toBe(0);
  });
});
