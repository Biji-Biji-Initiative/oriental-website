import { describe, expect, it } from "vitest";
import { detectAudioActivity } from "@/lib/voice/audio-activity";

describe("voice audio activity detector", () => {
  it("starts immediately above threshold and stops only after sustained silence", () => {
    const started = detectAudioActivity({ active: false }, 0.1, 100);
    expect(started.transition).toBe("started");

    const briefDip = detectAudioActivity(started.state, 0.01, 200);
    expect(briefDip.transition).toBeNull();
    expect(briefDip.state.active).toBe(true);

    const stopped = detectAudioActivity(briefDip.state, 0.01, 281);
    expect(stopped.transition).toBe("stopped");
    expect(stopped.state.active).toBe(false);
  });

  it("ignores invalid and below-threshold samples while inactive", () => {
    expect(detectAudioActivity({ active: false }, Number.NaN, 100).transition).toBeNull();
    expect(detectAudioActivity({ active: false }, 0.01, 200).transition).toBeNull();
  });
});
