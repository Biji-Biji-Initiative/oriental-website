"use client";

import { useEffect, useState } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import type { SegmentId } from "@/lib/segments";
import { cn } from "@/lib/utils";

type RailContext = { label: string; intent?: SegmentId };

const defaultContext: RailContext = { label: "Talk to Mereka" };

// The invitation follows what the visitor is reading, so opening voice lands
// on the right segment without a single unsolicited sound.
const sectionContexts: Record<string, RailContext> = {
  ecosystem: { label: "Ask Reka about the ecosystem", intent: "other" },
  facilities: { label: "Ask Reka about the spaces", intent: "tenancy" },
  partners: { label: "Ask Reka about partnering", intent: "community" },
  timeline: { label: "Ask Reka about the timeline", intent: "other" },
};

export function VoiceRail() {
  const [visible, setVisible] = useState(false);
  const [context, setContext] = useState<RailContext>(defaultContext);
  const voice = useVoice();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 720);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = Object.keys(sectionContexts)
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (sections.length === 0) return;

    // Observer callbacks only carry the entries that changed, so track all
    // currently visible sections to avoid resetting while one is still on screen.
    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibility.set(entry.target.id, entry.intersectionRatio);
          else visibility.delete(entry.target.id);
        }
        const [topSection] = [...visibility.entries()].sort((a, b) => b[1] - a[1]);
        setContext(topSection ? (sectionContexts[topSection[0]] ?? defaultContext) : defaultContext);
      },
      { rootMargin: "-30% 0px -45% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      className={cn(
        "fixed bottom-5 right-5 z-40 flex translate-y-6 items-center gap-3 rounded-full border border-white/18 bg-mk-off-black px-4 py-3 text-sm font-semibold text-white opacity-0 shadow-2xl transition duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mk-anchor-blue",
        visible && "translate-y-0 opacity-100",
      )}
      onClick={() => voice.open(context.intent)}
      type="button"
    >
      <span className="orb-breathe inline-flex">
        <MiniOrb size={30} />
      </span>
      {context.label}
    </button>
  );
}
