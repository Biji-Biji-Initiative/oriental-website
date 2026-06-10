"use client";

import { type RefObject, useEffect } from "react";

/**
 * Mirrors the live output audio level onto a CSS custom property
 * (`--voice-level`, 0..1) on the target element, so the orb can breathe with
 * Reka's actual voice. Writes styles directly — no React re-renders at audio
 * frame rate — and stays inert when the user prefers reduced motion.
 */
export function useVoiceAudioLevel(
  audioRef: RefObject<HTMLAudioElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
) {
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
        target.style.setProperty("--voice-level", level.toFixed(3));
        frame = requestAnimationFrame(tick);
      };
      tick();
    };

    // The remote stream is attached asynchronously by the WebRTC ontrack
    // handler, so poll briefly until it appears.
    const waitForStream = () => {
      const stream = audioRef.current?.srcObject;
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
      target.style.removeProperty("--voice-level");
    };
  }, [active, audioRef, targetRef]);
}
