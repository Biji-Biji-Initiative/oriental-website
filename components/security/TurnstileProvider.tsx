"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

type TurnstileContextValue = {
  /** Compatibility shim: Turnstile is intentionally disabled for this microsite. */
  getToken: () => Promise<string>;
  ready: boolean;
};

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

export function TurnstileProvider({ children }: { children: React.ReactNode }) {
  const getToken = useCallback(async () => "", []);
  const value = useMemo(() => ({ getToken, ready: true }), [getToken]);

  return <TurnstileContext.Provider value={value}>{children}</TurnstileContext.Provider>;
}

export function useTurnstileToken() {
  const context = useContext(TurnstileContext);
  if (!context) {
    throw new Error("useTurnstileToken must be used within TurnstileProvider");
  }
  return context;
}
