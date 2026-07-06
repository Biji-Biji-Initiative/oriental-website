import { describe, expect, it } from "vitest";
import {
  emptyTransportTelemetry,
  foldTransportStats,
  nextConnectionAction,
  recordTransition,
} from "@/lib/voice/transport-telemetry";

describe("nextConnectionAction", () => {
  it("treats failed as terminal regardless of grace", () => {
    expect(nextConnectionAction("failed", false)).toBe("teardown");
    expect(nextConnectionAction("failed", true)).toBe("teardown");
  });

  it("opens a grace window on the first disconnect, then waits it out", () => {
    expect(nextConnectionAction("disconnected", false)).toBe("start_grace");
    // A second disconnect event while the grace timer is already running must
    // not restart the window or double-count.
    expect(nextConnectionAction("disconnected", true)).toBe("none");
  });

  it("reports recovery only when returning to connected during a grace window", () => {
    expect(nextConnectionAction("connected", true)).toBe("recovered");
    // The initial successful connect (no grace open) is not a recovery.
    expect(nextConnectionAction("connected", false)).toBe("none");
  });

  it("ignores benign transitional states", () => {
    for (const state of ["new", "connecting", "closed"] as const) {
      expect(nextConnectionAction(state, false)).toBe("none");
      expect(nextConnectionAction(state, true)).toBe("none");
    }
  });
});

describe("recordTransition", () => {
  it("appends transitions oldest-first and caps the log at 60", () => {
    let telemetry = emptyTransportTelemetry();
    for (let i = 0; i < 65; i += 1) {
      telemetry = recordTransition(telemetry, i % 2 === 0 ? "disconnected" : "connected", 1000 + i);
    }
    expect(telemetry.transitions).toHaveLength(60);
    // Oldest five were dropped, so the window starts at the sixth transition.
    expect(telemetry.transitions[0]).toEqual({ state: "connected", at: 1005 });
    expect(telemetry.transitions.at(-1)).toEqual({ state: "disconnected", at: 1064 });
  });
});

describe("foldTransportStats", () => {
  it("records the latest sample and tracks worst-case network readings", () => {
    let telemetry = emptyTransportTelemetry();
    telemetry = foldTransportStats(telemetry, {
      at: 1,
      packetsLost: 5,
      packetsReceived: 95,
      jitterMs: 12,
      roundTripMs: 40,
    });
    telemetry = foldTransportStats(telemetry, {
      at: 2,
      packetsLost: 30,
      packetsReceived: 70,
      jitterMs: 8,
      roundTripMs: 90,
    });

    expect(telemetry.lastStats?.at).toBe(2);
    expect(telemetry.lastStats?.roundTripMs).toBe(90);
    // Worst-case keeps the peak jitter/RTT even though the last sample was better.
    expect(telemetry.worstStats?.maxJitterMs).toBe(12);
    expect(telemetry.worstStats?.maxRttMs).toBe(90);
    // 30 lost / (30 + 70) received = 30%.
    expect(telemetry.worstStats?.packetsLostPct).toBe(30);
  });

  it("tolerates missing fields without producing NaN or throwing", () => {
    const telemetry = foldTransportStats(emptyTransportTelemetry(), { at: 1 });
    expect(telemetry.lastStats).toEqual({
      at: 1,
      packetsLost: undefined,
      packetsReceived: undefined,
      jitterMs: undefined,
      roundTripMs: undefined,
    });
    expect(telemetry.worstStats).toEqual({});
  });
});
