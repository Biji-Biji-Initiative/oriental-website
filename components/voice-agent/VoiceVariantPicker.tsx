"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { VOICE_VARIANTS } from "@/lib/voice/variants";
import { useVoice } from "./voice-state";

/**
 * Floating QA control: lets the team A/B Reka's voice. Hidden unless the
 * runtime flag `VOICE_VARIANT_PICKER=true` is served by /api/client-config, so
 * it never appears for real visitors. The pick takes effect on the next call.
 */
export function VoiceVariantPicker() {
  const { voiceVariant, setVoiceVariant } = useVoice();
  const [enabled, setEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/client-config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { voiceVariantPicker?: boolean } | null) => {
        if (!cancelled && config?.voiceVariantPicker) setEnabled(true);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  // No selection = the site default voice (env) is used; don't fake-highlight one.
  const activeLabel = voiceVariant ? labelFor(voiceVariant) : "Site default";

  if (collapsed) {
    return (
      <button
        className="fixed bottom-5 left-5 z-40 rounded-full border border-white/15 bg-mk-off-black/90 px-3 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur"
        onClick={() => setCollapsed(false)}
        type="button"
      >
        🎙 Voice: {activeLabel}
      </button>
    );
  }

  return (
    <section
      aria-label="Voice variant picker (QA)"
      className="fixed bottom-5 left-5 z-40 w-[260px] rounded-2xl border border-white/12 bg-mk-off-black/95 p-3 text-white shadow-2xl backdrop-blur"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Voice A/B · QA</span>
        <button
          aria-label="Collapse voice picker"
          className="text-white/45 transition hover:text-white"
          onClick={() => setCollapsed(true)}
          type="button"
        >
          ✕
        </button>
      </header>
      <div className="grid gap-1.5">
        <button
          aria-pressed={!voiceVariant}
          className={cn(
            "rounded-xl border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon",
            !voiceVariant
              ? "border-mk-horizon/50 bg-mk-horizon/15"
              : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]",
          )}
          onClick={() => setVoiceVariant(undefined)}
          type="button"
        >
          <div className="text-sm font-semibold">Site default</div>
          <div className="mt-0.5 text-xs leading-4 text-white/55">The currently shipped voice (env).</div>
        </button>
        {VOICE_VARIANTS.map((variant) => {
          const active = variant.id === voiceVariant;
          return (
            <button
              aria-pressed={active}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon",
                active
                  ? "border-mk-horizon/50 bg-mk-horizon/15"
                  : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]",
              )}
              key={variant.id}
              onClick={() => setVoiceVariant(variant.id)}
              type="button"
            >
              <div className="text-sm font-semibold">{variant.label}</div>
              <div className="mt-0.5 text-xs leading-4 text-white/55">{variant.blurb}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-white/40">Applies to your next call. Team-only; flag-gated.</p>
    </section>
  );
}

function labelFor(id: string) {
  return VOICE_VARIANTS.find((variant) => variant.id === id)?.label ?? id;
}
