"use client";

import { useEffect, useState } from "react";
import { BRAND_MOTION_ENABLED, isBrandMotionEnabled } from "@/lib/brand-motion";
import { MerekaTraceSpinner } from "./MerekaTraceSpinner";

export const MEREKA_LOADER_HOLD_MS = 450;
export const MEREKA_LOADER_EXIT_MS = 240;
export const merekaLoaderSessionKey = "oriental_mereka_entrance_seen_v1";

type LoaderPhase = "visible" | "leaving" | "hidden";

export function shouldShowMerekaSiteLoader(
  pathname: string,
  alreadySeen: boolean,
  reducedMotion: boolean,
  brandMotionPreview: boolean,
) {
  return (
    brandMotionPreview &&
    !alreadySeen &&
    !reducedMotion &&
    !pathname.startsWith("/admin") &&
    !pathname.startsWith("/api")
  );
}

/** Public, non-blocking, once-per-tab entrance treatment. */
export function MerekaSiteLoader({ buildFlag = BRAND_MOTION_ENABLED }: { buildFlag?: boolean } = {}) {
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
    const brandMotionEnabled = isBrandMotionEnabled(buildFlag, window.location.hostname);
    if (!shouldShowMerekaSiteLoader(window.location.pathname, alreadySeen, reducedMotion, brandMotionEnabled)) return;

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
  }, [buildFlag]);

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
