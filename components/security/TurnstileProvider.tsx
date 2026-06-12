"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type TurnstileWidgetId = string;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "always" | "execute" | "interaction-only";
      execution: "render" | "execute";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ) => TurnstileWidgetId;
  execute: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function waitForTurnstileApi() {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15_000;

    function check() {
      if (window.turnstile) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("turnstile_api_timeout"));
        return;
      }
      window.setTimeout(check, 50);
    }

    check();
  });
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("turnstile_server_context"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const resolveWhenReady = () => {
      waitForTurnstileApi().then(resolve).catch(reject);
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (existing) {
      existing.addEventListener("load", resolveWhenReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("turnstile_script_failed")), { once: true });
      resolveWhenReady();
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = resolveWhenReady;
    script.onerror = () => reject(new Error("turnstile_script_failed"));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function localDevelopmentToken() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ? "local-dev" : null;
}

// Cloudflare tokens live 300s; never hand out one older than 4 minutes so the
// server-side verify cannot race the expiry.
const TOKEN_FRESH_MS = 240_000;
const EXECUTE_TIMEOUT_MS = 15_000;

type TokenWaiter = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: number;
};

type TurnstileContextValue = {
  /** Resolves a fresh single-use token, pre-warmed at page load when possible. */
  getToken: () => Promise<string>;
  ready: boolean;
};

const TurnstileContext = createContext<TurnstileContextValue | null>(null);

/**
 * One Turnstile widget for the whole page, warmed while the visitor is still
 * reading. Tokens are minted ahead of need and replenished on consumption, so
 * voice start and form submits never wait on (or display) a challenge at the
 * moment of action. When Cloudflare does require interaction, the checkbox
 * appears in a fixed slot at the bottom of the viewport — outside any dialog.
 */
export function TurnstileProvider({ children }: { children: React.ReactNode }) {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const warmTokenRef = useRef<{ value: string; mintedAt: number } | null>(null);
  const waitersRef = useRef<TokenWaiter[]>([]);
  const executingRef = useRef(false);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  // The site key is fetched at runtime (not server-rendered) so the pages stay
  // statically prerendered and the key stays rotatable without a rebuild.
  useEffect(() => {
    let cancelled = false;
    const load = async (attempt: number) => {
      try {
        const response = await fetch("/api/client-config");
        if (!response.ok) throw new Error(`client_config_${response.status}`);
        const config: { turnstileSiteKey?: string | null } = await response.json();
        if (cancelled) return;
        setSiteKey(config.turnstileSiteKey || null);
        setConfigLoaded(true);
      } catch {
        if (cancelled) return;
        if (attempt < 3) {
          window.setTimeout(() => void load(attempt + 1), 1_000 * (attempt + 1));
        } else {
          setConfigLoaded(true);
        }
      }
    };
    void load(0);
    return () => {
      cancelled = true;
    };
  }, []);

  const startExecute = useCallback(() => {
    if (executingRef.current) return;
    const widgetId = widgetIdRef.current;
    if (!widgetId || !window.turnstile) return;
    executingRef.current = true;
    window.turnstile.reset(widgetId);
    window.turnstile.execute(widgetId);
  }, []);

  useEffect(() => {
    if (localDevelopmentToken() || !siteKey || !container) return;

    let mounted = true;

    loadTurnstileScript()
      .then(() => {
        if (!mounted || !window.turnstile || widgetIdRef.current) return;
        try {
          widgetIdRef.current = window.turnstile.render(container, {
            sitekey: siteKey,
            action: "oriental-intake",
            appearance: "interaction-only",
            execution: "execute",
            callback: (token) => {
              executingRef.current = false;
              const waiter = waitersRef.current.shift();
              if (waiter) {
                window.clearTimeout(waiter.timeout);
                waiter.resolve(token);
                // More callers in line: each needs its own single-use token.
                if (waitersRef.current.length > 0) startExecute();
                return;
              }
              warmTokenRef.current = { value: token, mintedAt: Date.now() };
            },
            "error-callback": () => {
              executingRef.current = false;
              const failed = waitersRef.current.splice(0);
              for (const waiter of failed) {
                window.clearTimeout(waiter.timeout);
                waiter.reject(new Error("turnstile_error"));
              }
            },
            "expired-callback": () => {
              // The warm token aged out before anyone used it; mint the next
              // one only while the tab is actually visible.
              warmTokenRef.current = null;
              if (document.visibilityState === "visible") startExecute();
            },
          });
          setWidgetReady(Boolean(widgetIdRef.current));
          // Pre-warm: mint the first token while the visitor is still reading,
          // so any interactive challenge happens now — not mid-action.
          startExecute();
        } catch {
          setWidgetReady(false);
        }
      })
      .catch(() => {
        setWidgetReady(false);
      });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!warmTokenRef.current && waitersRef.current.length === 0) startExecute();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisible);
      setWidgetReady(false);
      executingRef.current = false;
      warmTokenRef.current = null;
      const orphaned = waitersRef.current.splice(0);
      for (const waiter of orphaned) {
        window.clearTimeout(waiter.timeout);
        waiter.reject(new Error("turnstile_unmounted"));
      }
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [container, siteKey, startExecute]);

  const getToken = useCallback(async () => {
    const localToken = localDevelopmentToken();
    if (localToken) return localToken;

    if (configLoaded && !siteKey) throw new Error("turnstile_unconfigured");

    const warm = warmTokenRef.current;
    if (warm && Date.now() - warm.mintedAt < TOKEN_FRESH_MS) {
      warmTokenRef.current = null;
      // Replenish in the background so the next action is instant too.
      startExecute();
      return warm.value;
    }

    return await new Promise<string>((resolve, reject) => {
      const waiter: TokenWaiter = {
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          const index = waitersRef.current.indexOf(waiter);
          if (index >= 0) waitersRef.current.splice(index, 1);
          reject(new Error("turnstile_timeout"));
        }, EXECUTE_TIMEOUT_MS),
      };
      waitersRef.current.push(waiter);
      startExecute();
    });
  }, [configLoaded, siteKey, startExecute]);

  const ready = Boolean(localDevelopmentToken()) || (configLoaded && !siteKey) || widgetReady;

  const value = useMemo(() => ({ getToken, ready }), [getToken, ready]);

  return (
    <TurnstileContext.Provider value={value}>
      {children}
      {/* Fixed page-level slot: invisible until Cloudflare expands a challenge
          into it. Stays clickable above an open dialog (z-index over the
          overlay, pointer-events restored under Radix's body lock). */}
      <div className="turnstile-anchor" ref={containerRef} />
    </TurnstileContext.Provider>
  );
}

export function useTurnstileToken() {
  const context = useContext(TurnstileContext);
  if (!context) {
    throw new Error("useTurnstileToken must be used within TurnstileProvider");
  }
  return context;
}
