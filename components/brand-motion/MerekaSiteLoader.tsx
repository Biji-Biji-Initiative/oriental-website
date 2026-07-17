"use client";

import { useEffect, useRef, useState } from "react";
import { MerekaTraceSpinner } from "./MerekaTraceSpinner";

const LOADER_HOLD_MS = 1_150;
const LOADER_EXIT_MS = 520;

type LoaderPhase = "visible" | "leaving" | "hidden";

/** Approved Mereka entrance treatment shared by staging and production. */
export function MerekaSiteLoader() {
  const [phase, setPhase] = useState<LoaderPhase>("visible");
  const previousOverflowRef = useRef("");

  useEffect(() => {
    previousOverflowRef.current = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const leaveTimer = window.setTimeout(() => setPhase("leaving"), LOADER_HOLD_MS);

    return () => {
      window.clearTimeout(leaveTimer);
      document.documentElement.style.overflow = previousOverflowRef.current;
    };
  }, []);

  useEffect(() => {
    if (phase !== "leaving") return;
    const hideTimer = window.setTimeout(() => {
      document.documentElement.style.overflow = previousOverflowRef.current;
      setPhase("hidden");
    }, LOADER_EXIT_MS);
    return () => window.clearTimeout(hideTimer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div aria-live="polite" className="brand-site-loader" data-phase={phase} role="status">
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
