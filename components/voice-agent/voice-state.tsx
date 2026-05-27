"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { VoiceAgentDialog } from "@/components/voice-agent/VoiceAgentDialog";
import type { SegmentId } from "@/lib/segments";

type VoiceMode = "voice" | "form";

type VoiceContextValue = {
  open: (intent?: SegmentId, prefill?: { email?: string; mode?: VoiceMode }) => void;
  close: () => void;
  turnstileSiteKey?: string;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({
  children,
  turnstileSiteKey,
}: {
  children: React.ReactNode;
  turnstileSiteKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<SegmentId | undefined>();
  const [prefill, setPrefill] = useState<{ email?: string; mode?: VoiceMode } | undefined>();

  const openVoice = useCallback((nextIntent?: SegmentId, nextPrefill?: { email?: string; mode?: VoiceMode }) => {
    setIntent(nextIntent);
    setPrefill(nextPrefill);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ open: openVoice, close, turnstileSiteKey }), [openVoice, close, turnstileSiteKey]);

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <VoiceAgentDialog
        intent={intent}
        onOpenChange={setOpen}
        open={open}
        prefill={prefill}
        turnstileSiteKey={turnstileSiteKey}
      />
    </VoiceContext.Provider>
  );
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  return context;
}
