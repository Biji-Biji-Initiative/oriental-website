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
  | "verification_failed"
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
};

type VoiceSessionResponse = {
  ok?: boolean;
  error?: string;
  client_secret?: { value?: string };
  session_id?: string;
  review?: { id?: string; token?: string };
  model?: string;
  voice?: string;
  speed?: number;
};

class VoiceConnectionFailure extends Error {
  constructor(readonly reason: VoiceCloseReason) {
    super(reason);
  }
}

type UseRealtimeVoiceSessionArgs = {
  audioRef: RefObject<HTMLAudioElement | null>;
  getTurnstileToken: () => Promise<string>;
  onClose: (reason: VoiceCloseReason) => void;
  onEvent: (event: RealtimeServerEvent, channel: RTCDataChannel) => void;
  /** Called shortly before the idle cutoff so the agent can say a goodbye. */
  onIdleWarning?: () => void;
  onSessionReady?: (metadata: VoiceReviewMetadata) => void;
  segment: SegmentId;
};

export function useRealtimeVoiceSession({
  audioRef,
  getTurnstileToken,
  onClose,
  onEvent,
  onIdleWarning,
  onSessionReady,
  segment,
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
  const statusRef = useRef<VoiceConnectionStatus>("idle");
  const onIdleWarningRef = useRef(onIdleWarning);
  onIdleWarningRef.current = onIdleWarning;

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
    const graceMs = Math.min(VOICE_SESSION_DEFAULTS.idleGoodbyeGraceMs, VOICE_SESSION_DEFAULTS.idleTimeoutMs);
    idleWarningTimerRef.current = window.setTimeout(() => {
      idleClosingRef.current = true;
      onIdleWarningRef.current?.();
    }, VOICE_SESSION_DEFAULTS.idleTimeoutMs - graceMs);
    idleTimerRef.current = window.setTimeout(() => {
      teardownVoice("idle_timeout");
    }, VOICE_SESSION_DEFAULTS.idleTimeoutMs);
  }, [teardownVoice]);

  const sendClientEvents = useCallback((events: RealtimeOutboundEvent | RealtimeOutboundEvent[]) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    for (const event of Array.isArray(events) ? events : [events]) {
      channel.send(JSON.stringify(event));
    }
    return true;
  }, []);

  const armMaxTimer = useCallback(() => {
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    maxTimerRef.current = window.setTimeout(() => {
      teardownVoice("max_duration");
    }, VOICE_SESSION_DEFAULTS.maxDurationMs);
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
    let turnstileToken = "";
    try {
      turnstileToken = await getTurnstileToken();
    } catch {
      throw new VoiceConnectionFailure("verification_failed");
    }

    const sessionResponse = await fetch("/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: segment, turnstileToken }),
    });
    const session = (await sessionResponse.json().catch(() => null)) as VoiceSessionResponse | null;
    if (session?.error === "turnstile_failed") throw new VoiceConnectionFailure("verification_failed");
    if (session?.error === "voice_limit_reached" || sessionResponse.status === 429) {
      throw new VoiceConnectionFailure("voice_limit_reached");
    }
    const clientSecret = session?.client_secret?.value;
    if (!sessionResponse.ok || session?.ok !== true || !clientSecret) {
      throw new VoiceConnectionFailure("session_failed");
    }
    return { ...session, client_secret: { ...session.client_secret, value: clientSecret } };
  }, [getTurnstileToken, segment]);

  const connectVoice = useCallback(async () => {
    // Guard on refs, not React state: a double-click during the permission
    // query would otherwise start two connect flows and spend quota twice.
    if (connectGateRef.current || statusRef.current !== "idle") return;
    connectGateRef.current = true;
    try {
      const permission = await queryMicrophonePermission();
      // Fail fast on a known denial: no token mint, no spent voice quota.
      if (permission === "denied") throw new VoiceConnectionFailure("mic_denied");

      let stream: MediaStream;
      let session: Awaited<ReturnType<typeof mintVoiceSession>>;
      if (permission === "granted") {
        // Returning visitor: the mic opens silently, so mint in parallel.
        setStatus("connecting");
        const streamPromise = acquireMicStream();
        // Pre-attach a handler so a late mic rejection after a mint failure
        // cannot surface as an unhandled promise rejection.
        streamPromise.catch(() => null);
        [stream, session] = await Promise.all([streamPromise, mintVoiceSession()]);
      } else {
        // First visit: surface the browser prompt immediately, and only spend
        // the daily voice quota once the microphone is actually granted.
        setStatus("requesting_mic");
        stream = await acquireMicStream();
        setStatus("connecting");
        session = await mintVoiceSession();
      }

      if (session.review?.id && session.review?.token) {
        onSessionReady?.({
          id: session.review.id,
          token: session.review.token,
          sessionId: session.session_id ?? session.review.id,
          model: session.model,
          voice: session.voice,
          speed: session.speed,
        });
      }

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
        setConnectionStatus("listening");
        statusRef.current = "listening";
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
        resetIdleTimer();
        if (parsed) onEvent(parsed, channel);
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.client_secret.value}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) throw new VoiceConnectionFailure("webrtc_failed");
      await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    } catch (error) {
      teardownVoice(error instanceof VoiceConnectionFailure ? error.reason : "error");
    } finally {
      connectGateRef.current = false;
    }
  }, [
    acquireMicStream,
    armMaxTimer,
    audioRef,
    mintVoiceSession,
    onEvent,
    onSessionReady,
    resetIdleTimer,
    setStatus,
    teardownVoice,
  ]);

  useEffect(() => {
    statusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => teardownVoice, [teardownVoice]);

  const getLocalStream = useCallback(() => localStreamRef.current, []);

  return { connectVoice, connectionStatus, getLocalStream, sendClientEvents, teardownVoice };
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
