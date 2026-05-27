"use client";

import { useEffect, useState } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import { cn } from "@/lib/utils";

export function VoiceRail() {
  const [visible, setVisible] = useState(false);
  const voice = useVoice();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 720);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      className={cn(
        "fixed bottom-5 right-5 z-40 flex translate-y-6 items-center gap-3 rounded-full border border-white/18 bg-mk-off-black px-4 py-3 text-sm font-semibold text-white opacity-0 shadow-2xl transition duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mk-anchor-blue",
        visible && "translate-y-0 opacity-100",
      )}
      onClick={() => voice.open()}
      type="button"
    >
      <MiniOrb size={30} />
      Talk to Mereka
    </button>
  );
}
