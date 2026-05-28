"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { SegmentId } from "@/lib/segments";
import type { RealtimeOutboundEvent } from "@/lib/voice/client-events";
import { VOICE_SESSION_DEFAULTS } from "@/lib/voice/profile";
import type { RealtimeServerEvent } from "@/lib/voice/realtime-events";

export type VoiceConnectionStatus = "idle" | "connecting" | "listening";
export type VoiceCloseReason = "idle_timeout" | "max_duration" | "manual" | "error";

export type VoiceReviewMetadata = {
  id: string;
  token: string;
  sessionId: string;
  model?: string;
  voice?: string;
  speed?: number;
};

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

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) window.clearTimeout(maxTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
  }, []);

  const teardownVoice = useCallback(
    (reason: VoiceCloseReason = "manual") => {
      clearTimers();
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      connectionRef.current?.close();
      connectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      localStreamRef.current = null;
      setConnectionStatus("idle");
      onClose(reason);
    },
    [clearTimers, onClose],
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
    try {
      const turnstileToken = await getTurnstileToken();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const session = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: segment, turnstileToken }),
      }).then((response) => response.json());

      if (!session.ok) throw new Error(session.error ?? "voice_unavailable");
      if (session.review?.id && session.review?.token) {
        onSessionReady?.({
          id: session.review.id,
          token: session.review.token,
          sessionId: session.session_id,
          model: session.model,
          voice: session.voice,
          speed: session.speed,
        });
      }

      const peer = new RTCPeerConnection();
      connectionRef.current = peer;
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
        resetIdleTimer();
        armMaxTimer();
      };
      channel.onclose = () => {
        if (dataChannelRef.current === channel) dataChannelRef.current = null;
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
      if (!sdpResponse.ok) throw new Error("webrtc_failed");
      await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    } catch {
      teardownVoice("error");
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

  useEffect(() => teardownVoice, [teardownVoice]);

  return { connectVoice, connectionStatus, sendClientEvents, teardownVoice };
}
