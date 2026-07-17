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

  it("learns steady nonzero RMS room noise and returns the visual envelope to rest", () => {
    let state = createAudioReactivityState();
    let peakLevel = 0;

    for (let frame = 0; frame < 900; frame += 1) {
      state = updateAudioReactivity(state, 0.08, 0.043, 1 / 60);
      peakLevel = Math.max(peakLevel, state.level);
    }

    expect(peakLevel).toBeGreaterThan(0.35);
    expect(state.noiseFloor).toBeGreaterThan(0.11);
    expect(state.noiseFloor).toBeLessThanOrEqual(1);
    expect(state.level).toBeLessThan(0.01);
  });

  it("has no permanent-activation band within the bounded analyser range", () => {
    let state = createAudioReactivityState();

    for (let frame = 0; frame < 1_500; frame += 1) {
      state = updateAudioReactivity(state, 0.42, 0.18, 1 / 60);
    }

    expect(state.noiseFloor).toBeGreaterThan(0.49);
    expect(state.level).toBeLessThan(0.01);

    for (let frame = 0; frame < 12; frame += 1) {
      state = updateAudioReactivity(state, 0.065, 0.022, 1 / 60);
    }
    expect(state.level).toBeGreaterThan(0.28);
  });

  it("does not repeatedly rebase on ordinary fluctuating RMS room noise", () => {
    let state = createAudioReactivityState();
    const tailLevels: number[] = [];

    for (let frame = 0; frame < 1_800; frame += 1) {
      const rms = 0.043 + Math.sin((frame / 120) * Math.PI * 2) * 0.006;
      state = updateAudioReactivity(state, 0.08, rms, 1 / 60);
      if (frame >= 1_200) tailLevels.push(state.level);
    }

    const meanTailLevel = tailLevels.reduce((sum, level) => sum + level, 0) / tailLevels.length;
    const orderedTailLevels = [...tailLevels].sort((left, right) => left - right);
    expect(meanTailLevel).toBeLessThan(0.05);
    expect(orderedTailLevels[Math.floor(orderedTailLevels.length * 0.95)]).toBeLessThan(0.13);
    expect(state.noiseFloor).toBeGreaterThan(0.09);
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
    const state = updateAudioReactivity({ level: Number.NaN, noiseFloor: Number.NaN }, Number.NaN, Infinity, Infinity);
    expect(state.level).toBe(0);
    expect(state.noiseFloor).toBeGreaterThanOrEqual(0);
  });
});
