"use client";

import { useVoice } from "@/components/voice-agent/voice-state";

export function FaqTalkCta() {
  const voice = useVoice();

  return (
    <button
      className="font-semibold text-mk-anchor-blue underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mk-anchor-blue"
      onClick={() => voice.open(undefined, { autoStart: false, mode: "form" })}
      type="button"
    >
      Talk to Mereka
    </button>
  );
}
