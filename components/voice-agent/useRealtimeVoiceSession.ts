"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { SegmentId } from "@/lib/segments";
import type { RealtimeOutboundEvent } from "@/lib/voice/client-events";
import { VOICE_SESSION_DEFAULTS } from "@/lib/voice/profile";
import type { RealtimeServerEvent } from "@/lib/voice/realtime-events";

export type VoiceConnectionStatus = "idle" | "connecting" | "listening";
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
  onSessionReady?: (metadata: VoiceReviewMetadata) => void;
  segment: SegmentId;
};

export function useRealtimeVoiceSession({
  audioRef,
  getTurnstileToken,
  onClose,
  onEvent,
  onSessionReady,
  segment,
}: UseRealtimeVoiceSessionArgs) {
  const [connectionStatus, setConnectionStatus] = useState<VoiceConnectionStatus>("idle");
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const statusRef = useRef<VoiceConnectionStatus>("idle");

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const teardownVoice = useCallback(
    (reason: VoiceCloseReason = "manual") => {
      clearTimers();
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
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
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

  const connectVoice = useCallback(async () => {
    if (connectionStatus !== "idle") return;
    setConnectionStatus("connecting");
    statusRef.current = "connecting";
    try {
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
      if (!sessionResponse.ok || session?.ok !== true || !session.client_secret?.value) {
        throw new VoiceConnectionFailure("session_failed");
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new VoiceConnectionFailure("mic_denied");
      }
      localStreamRef.current = stream;

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
        resetIdleTimer();
        try {
          onEvent(JSON.parse(event.data) as RealtimeServerEvent, channel);
        } catch {
          // Non-JSON data channel messages are ignored.
        }
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
    }
  }, [
    armMaxTimer,
    audioRef,
    connectionStatus,
    getTurnstileToken,
    onEvent,
    onSessionReady,
    resetIdleTimer,
    segment,
    teardownVoice,
  ]);

  useEffect(() => {
    statusRef.current = connectionStatus;
  }, [connectionStatus]);

  useEffect(() => teardownVoice, [teardownVoice]);

  return { connectVoice, connectionStatus, sendClientEvents, teardownVoice };
}
