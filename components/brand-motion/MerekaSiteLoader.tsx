"use client";

import { useEffect, useState } from "react";
import { MerekaTraceSpinner } from "./MerekaTraceSpinner";

export const MEREKA_LOADER_HOLD_MS = 450;
export const MEREKA_LOADER_EXIT_MS = 240;
export const merekaLoaderSessionKey = "oriental_mereka_entrance_seen_v1";

type LoaderPhase = "visible" | "leaving" | "hidden";

export function shouldShowMerekaSiteLoader(pathname: string, alreadySeen: boolean, reducedMotion: boolean) {
  return !alreadySeen && !reducedMotion && !pathname.startsWith("/admin") && !pathname.startsWith("/api");
}

/** Approved, non-blocking, once-per-tab public entrance treatment. */
export function MerekaSiteLoader() {
  const [phase, setPhase] = useState<LoaderPhase>("hidden");

  useEffect(() => {
    let alreadySeen = true;
    try {
      alreadySeen = window.sessionStorage.getItem(merekaLoaderSessionKey) === "true";
    } catch {
      // Hardened storage should fail open: never block access for decoration.
      return;
    }
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!shouldShowMerekaSiteLoader(window.location.pathname, alreadySeen, reducedMotion)) return;

    try {
      window.sessionStorage.setItem(merekaLoaderSessionKey, "true");
    } catch {
      // A quota/privacy write failure is not allowed to break page hydration.
      return;
    }
    setPhase("visible");
    const leaveTimer = window.setTimeout(() => setPhase("leaving"), MEREKA_LOADER_HOLD_MS);
    const hideTimer = window.setTimeout(() => setPhase("hidden"), MEREKA_LOADER_HOLD_MS + MEREKA_LOADER_EXIT_MS);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div aria-live="polite" className="brand-site-loader" data-input-blocking="false" data-phase={phase} role="status">
      <div aria-hidden className="brand-site-loader__atmosphere" />
      <div className="brand-site-loader__lockup">
        <MerekaTraceSpinner className="brand-site-loader__mark" />
        <div className="brand-site-loader__eyebrow">Mereka presents</div>
        <div className="brand-site-loader__title">Oriental Building</div>
        <span className="sr-only">Loading Oriental Building</span>
      </div>
      <div aria-hidden className="brand-site-loader__rule" />
    </div>
  );
}
