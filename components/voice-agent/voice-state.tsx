"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { playArmCue } from "@/components/voice-agent/live-chime";
import { trackIntakeEvent } from "@/lib/client-analytics";
import type { SegmentId } from "@/lib/segments";
import type { VoiceEntryMethod, VoiceEntryPoint } from "@/lib/voice/interaction-attribution";
import { revokePrefillRequestEmail } from "@/lib/voice/prefill-request";
import { DEFAULT_VOICE_VARIANT_ID, VOICE_VARIANT_IDS, type VoiceVariantId } from "@/lib/voice/variants";

// The dialog pulls in the whole voice stack (forms, zod, realtime runtime), so
// it is split out of the layout bundle and mounted shortly after first paint.
const VoiceAgentDialog = dynamic(
  () => import("@/components/voice-agent/VoiceAgentDialog").then((module) => module.VoiceAgentDialog),
  { ssr: false },
);

type VoiceMode = "voice" | "form";

export type VoicePrefill = {
  email?: string;
  mode?: VoiceMode;
  autoStart?: boolean;
  /** Internal monotonic duration only; no wall-clock tap timestamp is retained. */
  activation?: ReturnType<typeof playArmCue>;
  /** Bounded CTA attribution; no page text or visitor data is retained. */
  entryPoint?: VoiceEntryPoint;
  /** How the intake was explicitly opened, independent of its CTA surface. */
  entryMethod?: VoiceEntryMethod;
};

type VoiceOpenRequest = {
  id: number;
  prefill?: VoicePrefill;
};

const VOICE_VARIANT_STORAGE_KEY = "oriental.voiceVariant";
const VOICE_VARIANT_COOKIE = "oriental_voice_variant";
const VOICE_VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type VoiceContextValue = {
  open: (intent?: SegmentId, prefill?: VoicePrefill) => void;
  close: () => void;
  /** Mount the dialog and pre-mint a Realtime session so the next tap is faster. */
  prewarm: () => void;
  /** Selected Reka voice register, persisted in this browser. */
  voiceVariant: VoiceVariantId | undefined;
  setVoiceVariant: (variantId: VoiceVariantId | undefined) => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [intent, setIntent] = useState<SegmentId | undefined>();
  const [openRequest, setOpenRequest] = useState<VoiceOpenRequest | undefined>();
  const nextOpenRequestIdRef = useRef(1);
  const [prewarmSignal, setPrewarmSignal] = useState(0);
  const [voiceVariant, setVoiceVariantState] = useState<VoiceVariantId | undefined>(DEFAULT_VOICE_VARIANT_ID);

  // Persist the visitor's voice pick so it survives reloads and return visits.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VOICE_VARIANT_STORAGE_KEY) || readCookie(VOICE_VARIANT_COOKIE);
      const nextVariant = normalizeVoiceVariant(stored);
      setVoiceVariantState(nextVariant);
      window.localStorage.setItem(VOICE_VARIANT_STORAGE_KEY, nextVariant);
      writeVoiceVariantCookie(nextVariant);
    } catch {
      // localStorage/cookies unavailable — the in-memory default still applies.
    }
  }, []);

  const setVoiceVariant = useCallback((variantId: VoiceVariantId | undefined) => {
    const nextVariant = normalizeVoiceVariant(variantId);
    setVoiceVariantState(nextVariant);
    try {
      window.localStorage.setItem(VOICE_VARIANT_STORAGE_KEY, nextVariant);
      writeVoiceVariantCookie(nextVariant);
    } catch {
      // Non-fatal: the in-memory selection still applies for this session.
    }
  }, []);

  const openVoice = useCallback((nextIntent?: SegmentId, nextPrefill?: VoicePrefill) => {
    const activation = nextPrefill?.autoStart ? playArmCue() : undefined;
    const entryMethod = resolveEntryMethod(nextPrefill);
    trackIntakeEvent("intake_open", {
      entry_point: nextPrefill?.entryPoint ?? "unknown",
      entry_method: entryMethod,
      intended_mode: nextPrefill?.autoStart ? "voice" : (nextPrefill?.mode ?? "form"),
    });
    const requestId = nextOpenRequestIdRef.current++;
    setIntent(nextIntent);
    setOpenRequest({
      id: requestId,
      prefill: nextPrefill ? { ...nextPrefill, activation, entryMethod } : { entryMethod },
    });
    setMounted(true);
    setOpen(true);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setOpenRequest(undefined);
  }, []);

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);

  // Prefill PII is a one-shot opening instruction. Compare-and-swap by request
  // id so a late clear/close from call A can never erase a newer call B.
  const revokePrefill = useCallback((requestId: number) => {
    setOpenRequest((current) => revokePrefillRequestEmail(current, requestId));
  }, []);

  const prewarm = useCallback(() => {
    setMounted(true);
    setPrewarmSignal((signal) => signal + 1);
  }, []);

  // Load the dialog bundle shortly after first paint. The prewarm signal only
  // mints a Realtime session for returning visitors whose browser already has
  // microphone permission; first-time visitors spend no voice quota until consent.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      preconnect("https://api.openai.com");
      setMounted(true);
      void import("@/components/voice-agent/VoiceAgentDialog");
      setPrewarmSignal((signal) => signal + 1);
    }, 650);
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
          onOpenChange={handleOpenChange}
          onPrefillRevoked={revokePrefill}
          open={open}
          prefill={openRequest?.prefill}
          prefillRequestId={openRequest?.id}
          prewarmSignal={prewarmSignal}
          voiceVariant={voiceVariant}
        />
      ) : null}
    </VoiceContext.Provider>
  );
}

function resolveEntryMethod(prefill: VoicePrefill | undefined): VoiceEntryMethod {
  if (prefill?.entryMethod) return prefill.entryMethod;
  if (prefill?.email) return "email_capture";
  if (prefill?.autoStart) return "voice_button";
  return "form";
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length);
}

function normalizeVoiceVariant(variantId: string | null | undefined): VoiceVariantId {
  const decoded = variantId ? decodeURIComponent(variantId) : undefined;
  return decoded && (VOICE_VARIANT_IDS as readonly string[]).includes(decoded)
    ? (decoded as VoiceVariantId)
    : DEFAULT_VOICE_VARIANT_ID;
}

function writeVoiceVariantCookie(variantId: VoiceVariantId) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: first-party preference cookie; Cookie Store API is not universal.
  document.cookie = `${VOICE_VARIANT_COOKIE}=${encodeURIComponent(variantId)}; Path=/; Max-Age=${VOICE_VARIANT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  return context;
}
