"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SegmentId } from "@/lib/segments";

// The dialog pulls in the whole voice stack (forms, zod, realtime runtime), so
// it is split out of the layout bundle and only mounted on first open.
const VoiceAgentDialog = dynamic(
  () => import("@/components/voice-agent/VoiceAgentDialog").then((module) => module.VoiceAgentDialog),
  { ssr: false },
);

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
  const [mounted, setMounted] = useState(false);
  const [intent, setIntent] = useState<SegmentId | undefined>();
  const [prefill, setPrefill] = useState<{ email?: string; mode?: VoiceMode } | undefined>();

  const openVoice = useCallback((nextIntent?: SegmentId, nextPrefill?: { email?: string; mode?: VoiceMode }) => {
    setIntent(nextIntent);
    setPrefill(nextPrefill);
    setMounted(true);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Warm the dialog chunk shortly after first paint so the first open feels instant.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import("@/components/voice-agent/VoiceAgentDialog");
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, []);

  const value = useMemo(() => ({ open: openVoice, close, turnstileSiteKey }), [openVoice, close, turnstileSiteKey]);

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {mounted ? (
        <VoiceAgentDialog
          intent={intent}
          onOpenChange={setOpen}
          open={open}
          prefill={prefill}
          turnstileSiteKey={turnstileSiteKey}
        />
      ) : null}
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
