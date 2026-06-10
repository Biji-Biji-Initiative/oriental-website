"use client";

import { type RefObject, useEffect, useRef } from "react";

type StreamSource = () => MediaStream | null;

/**
 * Mirrors a live audio level onto a CSS custom property (0..1) on the target
 * element. Writes styles directly — no React re-renders at audio frame rate —
 * and stays inert when the user prefers reduced motion.
 */
function useStreamLevel(
  getStream: StreamSource,
  targetRef: RefObject<HTMLElement | null>,
  cssVar: string,
  active: boolean,
) {
  const getStreamRef = useRef(getStream);
  getStreamRef.current = getStream;

  useEffect(() => {
    const target = targetRef.current;
    if (!active || !target) return;
    if (typeof window.AudioContext === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let frame = 0;
    let pollTimer = 0;
    let cancelled = false;

    const start = (stream: MediaStream) => {
      context = new AudioContext();
      void context.resume().catch(() => null);
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (cancelled) return;
        analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (const value of bins) sum += value;
        const level = Math.min(1, (sum / bins.length / 255) * 2.4);
        target.style.setProperty(cssVar, level.toFixed(3));
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
      target.style.removeProperty(cssVar);
    };
  }, [active, cssVar, targetRef]);
}

/** Reka's output level → `--voice-level`, so the orb breathes and ripples with her voice. */
export function useVoiceAudioLevel(
  audioRef: RefObject<HTMLAudioElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useStreamLevel(
    () => {
      const stream = audioRef.current?.srcObject;
      return stream instanceof MediaStream ? stream : null;
    },
    targetRef,
    "--voice-level",
    active,
  );
}

/** The visitor's microphone level → `--user-level`, so the orb visibly listens. */
export function useMicAudioLevel(
  getLocalStream: StreamSource,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useStreamLevel(getLocalStream, targetRef, "--user-level", active);
}
