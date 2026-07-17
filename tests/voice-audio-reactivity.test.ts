import { describe, expect, it } from "vitest";
import { createAudioReactivityState, timeDomainRms, updateAudioReactivity } from "@/lib/voice/audio-reactivity";

describe("voice audio visual envelope", () => {
  it("turns quiet speech into a visible response", () => {
    let state = createAudioReactivityState();
    for (let frame = 0; frame < 12; frame += 1) {
      state = updateAudioReactivity(state, 0.065, 0.022, 1 / 60);
    }
    expect(state.level).toBeGreaterThan(0.28);
  });

  it("learns steady room noise without leaving the orb permanently active", () => {
    for (const steadySignal of [0.035, 0.045, 0.06, 0.08]) {
      let state = createAudioReactivityState();
      for (let frame = 0; frame < 600; frame += 1) {
        state = updateAudioReactivity(state, steadySignal, 0, 1 / 60);
      }
      expect(state.noiseFloor).toBeGreaterThan(steadySignal * 0.85);
      expect(state.level).toBeLessThan(0.04);
    }
  });

  it("converges sustained loud room noise to an inactive visual over a long capture", () => {
    for (const steadySignal of [0.12, 0.16, 0.2]) {
      let state = createAudioReactivityState();
      for (let frame = 0; frame < 7_200; frame += 1) {
        state = updateAudioReactivity(state, steadySignal, 0, 1 / 60);
      }
      expect(state.noiseFloor).toBeGreaterThan(steadySignal * 0.98);
      expect(state.gateOpen).toBe(false);
      expect(state.level).toBe(0);
    }
  });

  it("uses separate open and close thresholds to avoid visual chatter", () => {
    const open = updateAudioReactivity({ level: 0.4, noiseFloor: 0.05, gateOpen: true }, 0.062, 0, 1 / 60);
    const closed = updateAudioReactivity({ level: 0, noiseFloor: 0.05, gateOpen: false }, 0.062, 0, 1 / 60);

    expect(open.gateOpen).toBe(true);
    expect(closed.gateOpen).toBe(false);
  });

  it("attacks faster than it releases and then returns to rest", () => {
    let state = createAudioReactivityState();
    state = updateAudioReactivity(state, 0.2, 0.06, 1 / 60);
    const attacked = state.level;
    state = updateAudioReactivity(state, 0, 0, 1 / 60);
    expect(state.level).toBeGreaterThan(attacked * 0.85);
    for (let frame = 0; frame < 180; frame += 1) {
      state = updateAudioReactivity(state, 0, 0, 1 / 60);
    }
    expect(state.level).toBeLessThan(0.001);
  });

  it("computes RMS and clamps invalid input safely", () => {
    expect(timeDomainRms(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(timeDomainRms(new Uint8Array([0, 255]))).toBeGreaterThan(0.99);
    const state = updateAudioReactivity(
      { level: Number.NaN, noiseFloor: Number.NaN, gateOpen: false },
      Number.NaN,
      Infinity,
      Infinity,
    );
    expect(state.level).toBe(0);
    expect(state.noiseFloor).toBeGreaterThanOrEqual(0);
  });
});
