"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_VOICE_VARIANT_ID, VOICE_VARIANTS } from "@/lib/voice/variants";
import { useVoice } from "./voice-state";
import { readTunerFlag } from "./voice-tuner";

/** Team tuning control for choosing Reka's voice register. */
export function VoiceVariantPicker() {
  const { voiceVariant, setVoiceVariant } = useVoice();
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const selectedVariant = voiceVariant || DEFAULT_VOICE_VARIANT_ID;
  const activeLabel = labelFor(selectedVariant);

  useEffect(() => {
    let active = true;
    setHydrated(true);
    void readTunerFlag().then((next) => {
      if (active) setEnabled(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!enabled) return null;

  if (!expanded) {
    return (
      <button
        aria-label={`Choose Reka voice. Current voice: ${activeLabel}. ${VOICE_VARIANTS.length} voices available.`}
        className="fixed bottom-5 left-5 z-40 inline-flex max-w-[calc(100vw-40px)] items-center gap-2.5 rounded-full border border-mk-off-black/12 bg-white/92 px-3.5 py-2 text-left text-mk-off-black shadow-2xl backdrop-blur transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-anchor-blue disabled:cursor-wait disabled:opacity-70 sm:left-auto sm:right-5 sm:bottom-20 sm:gap-3 sm:py-2.5"
        disabled={!hydrated}
        data-voice-global-picker
        onClick={() => setExpanded(true)}
        type="button"
      >
        <span
          aria-hidden
          className="size-3 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fff,#8eb2f2_35%,#1f3f7c_72%)] shadow-[0_0_18px_rgba(142,178,242,0.72)]"
        />
        <span className="min-w-0">
          <span className="hidden text-[11px] font-semibold uppercase text-mk-off-black/50 sm:block">Reka voice</span>
          <span className="block truncate text-[11px] font-semibold sm:text-xs">
            {shortLabel(activeLabel)} · {VOICE_VARIANTS.length} voices
          </span>
        </span>
      </button>
    );
  }

  return (
    <section
      aria-label="Choose Reka voice"
      className="fixed bottom-5 left-5 z-40 max-h-[min(620px,calc(100svh-40px))] w-[min(320px,calc(100vw-40px))] overflow-y-auto rounded-xl border border-mk-off-black/12 bg-white/96 p-3 text-mk-off-black shadow-2xl backdrop-blur sm:left-auto sm:right-5 sm:bottom-20"
      data-voice-global-picker
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase text-mk-off-black/50">
          Reka voice · {shortLabel(activeLabel)}
        </span>
        <button
          aria-label="Collapse voice picker"
          className="rounded-full px-2 py-1 text-xs text-mk-off-black/50 transition hover:bg-mk-off-black/8 hover:text-mk-off-black"
          onClick={() => setExpanded(false)}
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
                  ? "border-mk-anchor-blue/50 bg-mk-horizon/55"
                  : "border-mk-off-black/10 bg-mk-off-black/[0.03] hover:border-mk-off-black/25 hover:bg-mk-off-black/[0.06]",
              )}
              key={variant.id}
              onClick={() => {
                setVoiceVariant(variant.id);
                setExpanded(false);
              }}
              type="button"
            >
              <div className="text-xs font-semibold leading-4">{shortLabel(variant.label)}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-mk-off-black/58">{variant.blurb}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-mk-off-black/46">
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
