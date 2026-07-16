/**
 * Pure helpers for WebRTC transport resilience + observability.
 *
 * The voice session used to tear down the moment the peer connection reported
 * `"disconnected"`. That state is *transient* in WebRTC — a brief packet-loss
 * burst or WiFi roam trips it, and ICE usually recovers to `"connected"` on its
 * own within a few seconds. Treating it as terminal killed calls mid-sentence.
 *
 * These helpers encode the recovery decision (testable, no DOM) and accumulate
 * the diagnostics needed to answer "why did it drop for this user" — packet
 * loss, jitter, RTT, ICE-state transitions, and whether the visitor was
 * speaking when it happened.
 */

export type VoiceTransportStats = {
  at: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitterMs?: number;
  roundTripMs?: number;
};

export type VoiceTransportTelemetry = {
  /** Number of bounded SDP retries after an upstream Realtime capacity 429. */
  realtimeBusyRetryCount: number;
  /** Number of times the connection dropped to a recoverable `disconnected`. */
  disconnectCount: number;
  /** Number of times it climbed back to `connected` after a disconnect. */
  recoveryCount: number;
  /** Number of ICE restarts attempted during recovery. */
  iceRestartCount: number;
  /** Whether the visitor was mid-utterance at the moment the session closed. */
  wasSpeakingAtClose?: boolean;
  /** Epoch timestamp for the first remote media track, when one arrived. */
  remoteTrackReceivedAt?: number;
  /** Bounded log of connection-state transitions, oldest first. */
  transitions: Array<{ state: string; at: number }>;
  /** Most recent getStats sample. */
  lastStats?: VoiceTransportStats;
  /** Worst-case network readings observed across the session. */
  worstStats?: { packetsLostPct?: number; maxJitterMs?: number; maxRttMs?: number };
};

export type ConnectionAction = "none" | "start_grace" | "recovered" | "teardown";

const MAX_TRANSITIONS = 60;

export function emptyTransportTelemetry(): VoiceTransportTelemetry {
  return {
    realtimeBusyRetryCount: 0,
    disconnectCount: 0,
    recoveryCount: 0,
    iceRestartCount: 0,
    transitions: [],
  };
}

/**
 * Decide what to do on a connection-state change.
 * - `failed` is terminal → tear down.
 * - `disconnected` is recoverable → open a grace window (unless one is open).
 * - `connected` while a grace window is open → we recovered.
 * Everything else (new/connecting/closed, or benign steady state) → do nothing.
 */
export function nextConnectionAction(state: RTCPeerConnectionState, graceActive: boolean): ConnectionAction {
  if (state === "failed") return "teardown";
  if (state === "disconnected") return graceActive ? "none" : "start_grace";
  if (state === "connected") return graceActive ? "recovered" : "none";
  return "none";
}

export function recordTransition(
  telemetry: VoiceTransportTelemetry,
  state: string,
  at: number,
): VoiceTransportTelemetry {
  const transitions = [...telemetry.transitions, { state, at }].slice(-MAX_TRANSITIONS);
  return { ...telemetry, transitions };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Fold a fresh getStats sample into the running telemetry, tracking worst-case. */
export function foldTransportStats(
  telemetry: VoiceTransportTelemetry,
  sample: VoiceTransportStats,
): VoiceTransportTelemetry {
  const worst = { ...(telemetry.worstStats ?? {}) };
  if (typeof sample.jitterMs === "number") {
    worst.maxJitterMs = Math.max(worst.maxJitterMs ?? 0, round(sample.jitterMs));
  }
  if (typeof sample.roundTripMs === "number") {
    worst.maxRttMs = Math.max(worst.maxRttMs ?? 0, round(sample.roundTripMs));
  }
  if (typeof sample.packetsLost === "number" && typeof sample.packetsReceived === "number") {
    const denom = sample.packetsLost + sample.packetsReceived;
    if (denom > 0) {
      worst.packetsLostPct = Math.max(worst.packetsLostPct ?? 0, round((sample.packetsLost / denom) * 100));
    }
  }
  return {
    ...telemetry,
    lastStats: {
      at: sample.at,
      packetsLost: sample.packetsLost,
      packetsReceived: sample.packetsReceived,
      jitterMs: typeof sample.jitterMs === "number" ? round(sample.jitterMs) : undefined,
      roundTripMs: typeof sample.roundTripMs === "number" ? round(sample.roundTripMs) : undefined,
    },
    worstStats: worst,
  };
}

/**
 * Read a compact network sample from a live peer connection. Never throws —
 * telemetry must never break the call.
 */
type RtcStatSample = {
  type?: string;
  kind?: string;
  nominated?: boolean;
  selected?: boolean;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
};

export async function sampleTransportStats(peer: RTCPeerConnection, at: number): Promise<VoiceTransportStats> {
  try {
    const report = await peer.getStats();
    let inbound: RtcStatSample | undefined;
    let remoteInbound: RtcStatSample | undefined;
    let pair: RtcStatSample | undefined;
    report.forEach((entry) => {
      const stat = entry as RtcStatSample;
      if (stat.type === "inbound-rtp" && stat.kind === "audio") inbound = stat;
      else if (stat.type === "remote-inbound-rtp") remoteInbound = stat;
      else if (stat.type === "candidate-pair" && (stat.nominated || stat.selected)) pair = stat;
    });
    const rtt = pair?.currentRoundTripTime ?? remoteInbound?.roundTripTime;
    const jitter = inbound?.jitter;
    return {
      at,
      packetsLost: numberOrUndefined(inbound?.packetsLost ?? remoteInbound?.packetsLost),
      packetsReceived: numberOrUndefined(inbound?.packetsReceived),
      jitterMs: typeof jitter === "number" ? jitter * 1000 : undefined,
      roundTripMs: typeof rtt === "number" ? rtt * 1000 : undefined,
    };
  } catch {
    return { at };
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
