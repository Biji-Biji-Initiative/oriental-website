"use client";

import type { ComponentPropsWithoutRef } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useVoice } from "@/components/voice-agent/voice-state";
import type { SegmentId } from "@/lib/segments";
import { cn } from "@/lib/utils";

type VoiceButtonProps = ComponentPropsWithoutRef<"button"> & {
  intent?: SegmentId;
  prefill?: { email?: string; mode?: "voice" | "form" };
  orb?: boolean;
};

export function VoiceButton({
  children,
  className,
  intent,
  prefill,
  orb = true,
  type = "button",
  ...props
}: VoiceButtonProps) {
  const voice = useVoice();
  return (
    <button
      className={cn(
        "group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white px-4 py-3 text-left text-sm font-semibold text-mk-off-black shadow-[0_18px_60px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:bg-mk-horizon focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mk-anchor-blue",
        className,
      )}
      onClick={() => voice.open(intent, prefill)}
      type={type}
      {...props}
    >
      {orb ? <MiniOrb /> : null}
      {children}
    </button>
  );
}
