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

export type VoicePrefill = { email?: string; mode?: VoiceMode; autoStart?: boolean };

const VOICE_VARIANT_STORAGE_KEY = "oriental.voiceVariant";

type VoiceContextValue = {
  open: (intent?: SegmentId, prefill?: VoicePrefill) => void;
  close: () => void;
  /** Hover/focus on a talk CTA: mount the dialog and pre-mint a session so the tap is instant. */
  prewarm: () => void;
  /** QA voice variant id (undefined = env default), set by the floating picker. */
  voiceVariant: string | undefined;
  setVoiceVariant: (variantId: string | undefined) => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [intent, setIntent] = useState<SegmentId | undefined>();
  const [prefill, setPrefill] = useState<VoicePrefill | undefined>();
  const [prewarmSignal, setPrewarmSignal] = useState(0);
  const [voiceVariant, setVoiceVariantState] = useState<string | undefined>();

  // Persist the team's QA pick so it survives reloads during a tasting session.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VOICE_VARIANT_STORAGE_KEY);
      if (stored) setVoiceVariantState(stored);
    } catch {
      // localStorage unavailable (private mode / SSR) — fall back to env default.
    }
  }, []);

  const setVoiceVariant = useCallback((variantId: string | undefined) => {
    setVoiceVariantState(variantId);
    try {
      if (variantId) window.localStorage.setItem(VOICE_VARIANT_STORAGE_KEY, variantId);
      else window.localStorage.removeItem(VOICE_VARIANT_STORAGE_KEY);
    } catch {
      // Non-fatal: the in-memory selection still applies for this session.
    }
  }, []);

  const openVoice = useCallback((nextIntent?: SegmentId, nextPrefill?: VoicePrefill) => {
    setIntent(nextIntent);
    setPrefill(nextPrefill);
    setMounted(true);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const prewarm = useCallback(() => {
    setMounted(true);
    setPrewarmSignal((signal) => signal + 1);
  }, []);

  // Warm the dialog chunk shortly after first paint so the first open feels instant.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import("@/components/voice-agent/VoiceAgentDialog");
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, []);

  const value = useMemo(
    () => ({ open: openVoice, close, prewarm, voiceVariant, setVoiceVariant }),
    [openVoice, close, prewarm, voiceVariant, setVoiceVariant],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {mounted ? (
        <VoiceAgentDialog
          intent={intent}
          onOpenChange={setOpen}
          open={open}
          prefill={prefill}
          prewarmSignal={prewarmSignal}
          voiceVariant={voiceVariant}
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
