"use client";

import { type RefObject, useEffect, useRef } from "react";
import { type AudioActivityState, detectAudioActivity } from "@/lib/voice/audio-activity";
import { createAudioReactivityState, timeDomainRms, updateAudioReactivity } from "@/lib/voice/audio-reactivity";

type StreamSource = () => MediaStream | null;
type ActivityCallbacks = {
  onActivityStart?: (at: number) => void;
  onActivityStop?: (at: number) => void;
  onLevel?: (level: number) => void;
};

/**
 * Mirrors a live audio level onto a CSS custom property (0..1) on the target
 * element. Detection remains active under reduced-motion preferences; only
 * visual writes are suppressed. This keeps latency measurement independent of
 * animation while avoiding React re-renders at audio frame rate.
 */
function useStreamLevel(
  getStream: StreamSource,
  targetRef: RefObject<HTMLElement | null>,
  cssVar: string,
  active: boolean,
  callbacks: ActivityCallbacks = {},
) {
  const getStreamRef = useRef(getStream);
  getStreamRef.current = getStream;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const target = targetRef.current;
    if (!active || !target) return;
    if (typeof window.AudioContext === "undefined") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frame = 0;
    let pollTimer = 0;
    let cancelled = false;
    let activity: AudioActivityState = { active: false };

    const start = (stream: MediaStream) => {
      context = new AudioContext();
      void context.resume().catch(() => null);
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const waveform = new Uint8Array(analyser.fftSize);
      let visualEnvelope = createAudioReactivityState();
      let previousSampleAt = performance.now();
      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(bins);
        analyser.getByteTimeDomainData(waveform);
        let sum = 0;
        for (const value of bins) sum += value;
        const activityLevel = Math.min(1, (sum / bins.length / 255) * 2.4);
        const at = performance.now();
        visualEnvelope = updateAudioReactivity(
          visualEnvelope,
          activityLevel,
          timeDomainRms(waveform),
          (at - previousSampleAt) / 1_000,
        );
        previousSampleAt = at;
        const detected = detectAudioActivity(activity, activityLevel, at);
        activity = detected.state;
        callbacksRef.current.onLevel?.(visualEnvelope.level);
        if (detected.transition === "started") callbacksRef.current.onActivityStart?.(at);
        if (detected.transition === "stopped") callbacksRef.current.onActivityStop?.(at);
        if (!reduceMotion) target.style.setProperty(cssVar, visualEnvelope.level.toFixed(3));
        frame = requestAnimationFrame(tick);
      };
      tick();
    };

    // Streams attach asynchronously (WebRTC ontrack / getUserMedia), so poll
    // briefly until one with audio appears.
    const waitForStream = () => {
      if (cancelled) return;
      const stream = getStreamRef.current();
      if (stream instanceof MediaStream && stream.getAudioTracks().length > 0) {
        start(stream);
        return;
      }
      pollTimer = window.setTimeout(waitForStream, 250);
    };
    waitForStream();

    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
      cancelAnimationFrame(frame);
      source?.disconnect();
      void context?.close().catch(() => null);
      callbacksRef.current.onLevel?.(0);
      target.style.removeProperty(cssVar);
    };
  }, [active, cssVar, targetRef]);
}

/** Reka's output level → `--voice-level`, so the orb breathes and ripples with her voice. */
export function useVoiceAudioLevel(
  audioRef: RefObject<HTMLAudioElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  callbacks: ActivityCallbacks = {},
) {
  useStreamLevel(
    () => {
      const stream = audioRef.current?.srcObject;
      return stream instanceof MediaStream ? stream : null;
    },
    targetRef,
    "--voice-level",
    active,
    callbacks,
  );
}

/** The visitor's microphone level → `--user-level`, so the orb visibly listens. */
export function useMicAudioLevel(
  getLocalStream: StreamSource,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  callbacks: ActivityCallbacks = {},
) {
  useStreamLevel(getLocalStream, targetRef, "--user-level", active, callbacks);
}
