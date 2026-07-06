"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { SegmentId } from "@/lib/segments";
import type { RealtimeOutboundEvent } from "@/lib/voice/client-events";
import { VOICE_SESSION_DEFAULTS } from "@/lib/voice/profile";
import type { RealtimeServerEvent } from "@/lib/voice/realtime-events";

export type VoiceConnectionStatus = "idle" | "requesting_mic" | "connecting" | "listening";
export type VoiceCloseReason =
  | "idle_timeout"
  | "max_duration"
  | "manual"
  | "error"
  | "voice_limit_reached"
  | "mic_denied"
  | "session_failed"
  | "webrtc_failed"
  | "disconnected";

export type VoiceReviewMetadata = {
  id: string;
  token: string;
  sessionId: string;
  model?: string;
  voice?: string;
  speed?: number;
  variant?: string | null;
  prewarmedAt?: number;
  connectStartedAt?: number;
  connectedAt?: number;
  firstEventAt?: number;
};

type VoiceSessionResponse = {
  ok?: boolean;
  error?: string;
  client_secret?: { value?: string; expires_at?: number };
  session_id?: string;
  review?: { id?: string; token?: string };
  model?: string;
  voice?: string;
  speed?: number;
  variant?: string | null;
  limits?: { max_duration_ms?: number; idle_timeout_ms?: number };
};

class VoiceConnectionFailure extends Error {
  constructor(readonly reason: VoiceCloseReason) {
    super(reason);
  }
}

type UseRealtimeVoiceSessionArgs = {
  audioRef: RefObject<HTMLAudioElement | null>;
  onClose: (reason: VoiceCloseReason) => void;
  onEvent: (event: RealtimeServerEvent, channel: RTCDataChannel) => void;
  /** Called shortly before the idle cutoff so the agent can say a goodbye. */
  onIdleWarning?: () => void;
  onSessionReady?: (metadata: VoiceReviewMetadata) => void;
  segment: SegmentId;
  /** Optional QA voice variant id, resolved server-side at mint time. */
  variant?: string;
};

const prewarmSessionHeadroomMs = 30_000;
const sessionMintTimeoutMs = 12_000;
const sdpExchangeTimeoutMs = 15_000;

export function useRealtimeVoiceSession({
  audioRef,
  onClose,
  onEvent,
  onIdleWarning,
  onSessionReady,
  segment,
  variant,
}: UseRealtimeVoiceSessionArgs) {
  const [connectionStatus, setConnectionStatus] = useState<VoiceConnectionStatus>("idle");
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const idleWarningTimerRef = useRef<number | null>(null);
  const idleClosingRef = useRef(false);
  const connectGateRef = useRef(false);
  const maxTimerRef = useRef<number | null>(null);
  // Session policy from the server, falling back to compiled defaults.
  const limitsRef = useRef({
    maxDurationMs: VOICE_SESSION_DEFAULTS.maxDurationMs,
    idleTimeoutMs: VOICE_SESSION_DEFAULTS.idleTimeoutMs,
  });
  const statusRef = useRef<VoiceConnectionStatus>("idle");
  const onIdleWarningRef = useRef(onIdleWarning);
  onIdleWarningRef.current = onIdleWarning;
  // Read at mint time (not a mint dep) so changing the variant never rebuilds
  // the connect machinery; the prewarm cache is invalidated on mismatch instead.
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const segmentRef = useRef(segment);
  segmentRef.current = segment;

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (idleWarningTimerRef.current) window.clearTimeout(idleWarningTimerRef.current);
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    idleWarningTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const teardownVoice = useCallback(
    (reason: VoiceCloseReason = "manual") => {
      const hadActiveSession =
        statusRef.current !== "idle" ||
        Boolean(dataChannelRef.current) ||
        Boolean(connectionRef.current) ||
        Boolean(localStreamRef.current);
      if (!hadActiveSession) return;
      clearTimers();
      idleClosingRef.current = false;
      const channel = dataChannelRef.current;
      dataChannelRef.current = null;
      channel?.close();
      const connection = connectionRef.current;
      connectionRef.current = null;
      connection?.close();
      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      localStreamRef.current = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      setConnectionStatus("idle");
      statusRef.current = "idle";
      onClose(reason);
    },
    [audioRef, clearTimers, onClose],
  );

  const resetIdleTimer = useCallback(() => {
    // While the goodbye is playing, the agent's own audio events must not extend the session.
    if (idleClosingRef.current) return;
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (idleWarningTimerRef.current) window.clearTimeout(idleWarningTimerRef.current);
    const idleTimeoutMs = limitsRef.current.idleTimeoutMs;
    const graceMs = Math.min(VOICE_SESSION_DEFAULTS.idleGoodbyeGraceMs, idleTimeoutMs);
    idleWarningTimerRef.current = window.setTimeout(() => {
      idleClosingRef.current = true;
      onIdleWarningRef.current?.();
    }, idleTimeoutMs - graceMs);
    idleTimerRef.current = window.setTimeout(() => {
      teardownVoice("idle_timeout");
    }, idleTimeoutMs);
  }, [teardownVoice]);

  const sendClientEvents = useCallback((events: RealtimeOutboundEvent | RealtimeOutboundEvent[]) => {
    const channel = dataChannelRef.current;
    if (channel?.readyState !== "open") return false;
    for (const event of Array.isArray(events) ? events : [events]) {
      channel.send(JSON.stringify(event));
    }
    return true;
  }, []);

  const armMaxTimer = useCallback(() => {
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = window.setTimeout(() => {
      teardownVoice("max_duration");
    }, limitsRef.current.maxDurationMs);
  }, [teardownVoice]);

  const setStatus = useCallback((status: VoiceConnectionStatus) => {
    setConnectionStatus(status);
    statusRef.current = status;
  }, []);

  const acquireMicStream = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new VoiceConnectionFailure("mic_denied");
    }
    // The session may have been torn down while the prompt was open or after a
    // parallel mint failure; never leave an unowned live microphone behind.
    if (statusRef.current === "idle") {
      for (const track of stream.getTracks()) track.stop();
      throw new VoiceConnectionFailure("manual");
    }
    // Referenced immediately so teardown stops the tracks even if the
    // session mint racing alongside fails.
    localStreamRef.current = stream;
    return stream;
  }, []);

  const mintVoiceSession = useCallback(async () => {
    const sessionResponse = await fetchWithTimeout(
      "/api/voice/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: segmentRef.current, variant: variantRef.current }),
      },
      sessionMintTimeoutMs,
    ).catch(() => {
      throw new VoiceConnectionFailure("session_failed");
    });
    const session = (await sessionResponse.json().catch(() => null)) as VoiceSessionResponse | null;
    if (session?.error === "voice_limit_reached" || sessionResponse.status === 429) {
      throw new VoiceConnectionFailure("voice_limit_reached");
    }
    const clientSecret = session?.client_secret?.value;
    if (!sessionResponse.ok || session?.ok !== true || !clientSecret) {
      throw new VoiceConnectionFailure("session_failed");
    }
    limitsRef.current = {
      maxDurationMs: positiveOr(session.limits?.max_duration_ms, VOICE_SESSION_DEFAULTS.maxDurationMs),
      idleTimeoutMs: positiveOr(session.limits?.idle_timeout_ms, VOICE_SESSION_DEFAULTS.idleTimeoutMs),
    };
    return { ...session, client_secret: { ...session.client_secret, value: clientSecret } };
  }, []);

  type MintedSession = Awaited<ReturnType<typeof mintVoiceSession>>;
  const prewarmedRef = useRef<{
    session: MintedSession;
    mintedAt: number;
    segment: SegmentId;
    variant: string | undefined;
  } | null>(null);
  const prewarmPromiseRef = useRef<Promise<void> | null>(null);
  const activePrewarmedAtRef = useRef<number | undefined>(undefined);
  const firstEventAtRef = useRef<number | undefined>(undefined);

  const emitSessionReady = useCallback(
    (session: MintedSession, extras: Omit<Partial<VoiceReviewMetadata>, "id" | "token" | "sessionId"> = {}) => {
      if (!session.review?.id || !session.review?.token) return;
      onSessionReady?.({
        id: session.review.id,
        token: session.review.token,
        sessionId: session.session_id ?? session.review.id,
        model: session.model,
        voice: session.voice,
        speed: session.speed,
        variant: session.variant ?? null,
        ...extras,
      });
    },
    [onSessionReady],
  );

  const takePrewarmedSession = useCallback((): MintedSession | null => {
    const cached = prewarmedRef.current;
    if (!cached) return null;
    prewarmedRef.current = null;
    // A session prewarmed under a different segment or voice variant is stale for
    // the current opening context — discard it so the first turn is grounded.
    if (cached.segment !== segmentRef.current || cached.variant !== variantRef.current) return null;
    // expires_at is unix seconds from OpenAI; leave headroom for the SDP
    // handshake. Fall back to the documented 300s TTL when it is absent.
    const expiresAtMs =
      cached.session.client_secret.expires_at && cached.session.client_secret.expires_at > 0
        ? cached.session.client_secret.expires_at * 1000
        : cached.mintedAt + 270_000;
    if (expiresAtMs <= Date.now() + 20_000) return null;
    activePrewarmedAtRef.current = cached.mintedAt;
    return cached.session;
  }, []);

  /**
   * Mint the ephemeral session in the background so returning visitors do not
   * wait on OpenAI client-secret creation. First-time visitors still spend no
   * voice quota until they grant microphone access in the explicit start flow.
   */
  const prewarmVoiceSession = useCallback(() => {
    if (statusRef.current !== "idle") return;
    if (prewarmPromiseRef.current) return;
    const cached = prewarmedRef.current;
    if (cached) {
      const expiresAtMs = sessionExpiresAtMs(cached.session, cached.mintedAt);
      const stillFresh =
        cached.segment === segmentRef.current &&
        cached.variant === variantRef.current &&
        expiresAtMs > Date.now() + prewarmSessionHeadroomMs;
      if (stillFresh) return;
      prewarmedRef.current = null;
    }
    const segmentAtMint = segmentRef.current;
    const variantAtMint = variantRef.current;
    prewarmPromiseRef.current = queryMicrophonePermission()
      .then((permission) => {
        if (permission !== "granted" || statusRef.current !== "idle") return null;
        return mintVoiceSession();
      })
      .then((session) => {
        if (!session) return;
        const mintedAt = Date.now();
        prewarmedRef.current = { session, mintedAt, segment: segmentAtMint, variant: variantAtMint };
        emitSessionReady(session, { prewarmedAt: mintedAt });
      })
      .catch(() => null)
      .then(() => {
        prewarmPromiseRef.current = null;
      });
  }, [emitSessionReady, mintVoiceSession]);

  const obtainVoiceSession = useCallback(async (): Promise<MintedSession> => {
    const cached = takePrewarmedSession();
    if (cached) return cached;
    if (prewarmPromiseRef.current) {
      await prewarmPromiseRef.current;
      const settled = takePrewarmedSession();
      if (settled) return settled;
    }
    activePrewarmedAtRef.current = undefined;
    return mintVoiceSession();
  }, [mintVoiceSession, takePrewarmedSession]);

  const connectVoice = useCallback(async () => {
    // Guard on refs, not React state: a double-click during the permission
    // query would otherwise start two connect flows and spend quota twice.
    if (connectGateRef.current || statusRef.current !== "idle") return;
    connectGateRef.current = true;
    const connectStartedAt = Date.now();
    firstEventAtRef.current = undefined;
    try {
      const permission = await queryMicrophonePermission();
      // Fail fast on a known denial: no token mint, no spent voice quota.
      if (permission === "denied") throw new VoiceConnectionFailure("mic_denied");

      let stream: MediaStream;
      let session: MintedSession;
      if (permission === "granted") {
        // Returning visitor: the mic opens silently, so mint in parallel.
        setStatus("connecting");
        const streamPromise = acquireMicStream();
        // Pre-attach a handler so a late mic rejection after a mint failure
        // cannot surface as an unhandled promise rejection.
        streamPromise.catch(() => null);
        [stream, session] = await Promise.all([streamPromise, obtainVoiceSession()]);
      } else {
        // First visit: surface the browser prompt immediately, and only spend
        // the daily voice quota once the microphone is actually granted —
        // unless a prewarmed session already spent it.
        setStatus("requesting_mic");
        stream = await acquireMicStream();
        setStatus("connecting");
        session = await obtainVoiceSession();
      }

      emitSessionReady(session, { prewarmedAt: activePrewarmedAtRef.current, connectStartedAt });

      const peer = new RTCPeerConnection();
      connectionRef.current = peer;
      peer.onconnectionstatechange = () => {
        if (
          connectionRef.current === peer &&
          statusRef.current === "listening" &&
          (peer.connectionState === "failed" || peer.connectionState === "disconnected")
        ) {
          teardownVoice("disconnected");
        }
      };
      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
      });
      peer.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (audioRef.current && remoteStream) {
          audioRef.current.srcObject = remoteStream;
        }
      };

      const channel = peer.createDataChannel("oai-events");
      dataChannelRef.current = channel;
      channel.onopen = () => {
        setStatus("listening");
        emitSessionReady(session, {
          prewarmedAt: activePrewarmedAtRef.current,
          connectStartedAt,
          connectedAt: Date.now(),
        });
        resetIdleTimer();
        armMaxTimer();
      };
      channel.onclose = () => {
        const wasCurrentChannel = dataChannelRef.current === channel;
        if (wasCurrentChannel) {
          dataChannelRef.current = null;
          if (statusRef.current === "listening") teardownVoice("disconnected");
        }
      };
      channel.onmessage = (event) => {
        let parsed: RealtimeServerEvent | null = null;
        try {
          parsed = JSON.parse(event.data) as RealtimeServerEvent;
        } catch {
          // Non-JSON data channel messages are ignored.
        }
        if (parsed?.type === "input_audio_buffer.speech_started") {
          // The user came back during the goodbye window; resume the normal idle cycle.
          idleClosingRef.current = false;
        }
        if (!firstEventAtRef.current) {
          firstEventAtRef.current = Date.now();
          emitSessionReady(session, {
            prewarmedAt: activePrewarmedAtRef.current,
            connectStartedAt,
            firstEventAt: firstEventAtRef.current,
          });
        }
        resetIdleTimer();
        if (parsed) onEvent(parsed, channel);
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetchWithTimeout(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.client_secret.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
        sdpExchangeTimeoutMs,
      ).catch(() => {
        throw new VoiceConnectionFailure("webrtc_failed");
      });
      if (connectionRef.current !== peer || statusRef.current === "idle") throw new VoiceConnectionFailure("manual");
      if (!sdpResponse.ok) throw new VoiceConnectionFailure("webrtc_failed");
      const answerSdp = await sdpResponse.text();
      if (connectionRef.current !== peer || statusRef.current === "idle") throw new VoiceConnectionFailure("manual");
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp }).catch(() => {
        throw new VoiceConnectionFailure(statusRef.current === "idle" ? "manual" : "webrtc_failed");
      });
    } catch (error) {
      teardownVoice(error instanceof VoiceConnectionFailure ? error.reason : "error");
    } finally {
      connectGateRef.current = false;
    }
  }, [
    acquireMicStream,
    armMaxTimer,
    audioRef,
    emitSessionReady,
    obtainVoiceSession,
    onEvent,
    resetIdleTimer,
    setStatus,
    teardownVoice,
  ]);

  useEffect(() => {
    statusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => teardownVoice, [teardownVoice]);

  const getLocalStream = useCallback(() => localStreamRef.current, []);

  return { connectVoice, connectionStatus, getLocalStream, prewarmVoiceSession, sendClientEvents, teardownVoice };
}

function positiveOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sessionExpiresAtMs(session: { client_secret: { expires_at?: number } }, mintedAt: number) {
  return session.client_secret.expires_at && session.client_secret.expires_at > 0
    ? session.client_secret.expires_at * 1000
    : mintedAt + 270_000;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function queryMicrophonePermission(): Promise<PermissionState> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state;
  } catch {
    // Permissions API unavailable (e.g. Firefox for microphone): fall back to
    // the prompt-first path, which is safe everywhere.
    return "prompt";
  }
}
