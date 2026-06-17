"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_VOICE_VARIANT_ID, VOICE_VARIANTS } from "@/lib/voice/variants";
import { useVoice } from "./voice-state";

/** First-class visitor control for choosing Reka's voice register. */
export function VoiceVariantPicker() {
  const { voiceVariant, setVoiceVariant } = useVoice();
  const [collapsed, setCollapsed] = useState(false);

  const selectedVariant = voiceVariant || DEFAULT_VOICE_VARIANT_ID;
  const activeLabel = labelFor(selectedVariant);

  if (collapsed) {
    return (
      <button
        className="fixed bottom-5 left-5 z-40 rounded-full border border-white/15 bg-mk-off-black/90 px-3 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur transition hover:bg-mk-off-black"
        onClick={() => setCollapsed(false)}
        type="button"
      >
        Reka voice: {activeLabel}
      </button>
    );
  }

  return (
    <section
      aria-label="Choose Reka voice"
      className="fixed bottom-5 left-5 z-40 w-[min(300px,calc(100vw-40px))] rounded-xl border border-white/12 bg-mk-off-black/95 p-3 text-white shadow-2xl backdrop-blur"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase text-white/55">Reka voice</span>
        <button
          aria-label="Collapse voice picker"
          className="rounded-full px-2 py-1 text-xs text-white/50 transition hover:bg-white/10 hover:text-white"
          onClick={() => setCollapsed(true)}
          type="button"
        >
          Hide
        </button>
      </header>
      <div className="grid grid-cols-2 gap-1.5">
        {VOICE_VARIANTS.map((variant) => {
          const active = variant.id === selectedVariant;
          return (
            <button
              aria-pressed={active}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon",
                active
                  ? "border-mk-horizon/60 bg-mk-horizon/15"
                  : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]",
              )}
              key={variant.id}
              onClick={() => setVoiceVariant(variant.id)}
              type="button"
            >
              <div className="text-xs font-semibold leading-4">{shortLabel(variant.label)}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-white/55">{variant.blurb}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-white/42">
        Saved for this browser. Applies to the next voice start.
      </p>
    </section>
  );
}

function labelFor(id: string) {
  return VOICE_VARIANTS.find((variant) => variant.id === id)?.label ?? id;
}

function shortLabel(label: string) {
  return label.replace("Reka · ", "");
}
