"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function useTurnstile(action: string, siteKey?: string) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingRef = useRef<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [ready, setReady] = useState(!siteKey);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  const rejectPending = useCallback((error: Error) => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timeout);
    pendingRef.current.reject(error);
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    if (localDevelopmentToken()) {
      setReady(true);
      return;
    }
    if (!siteKey) {
      setReady(true);
      return;
    }
    if (!container) {
      setReady(false);
      return;
    }

    let mounted = true;

    loadTurnstileScript()
      .then(() => {
        if (!mounted || !window.turnstile || !container || widgetIdRef.current) return;
        try {
          widgetIdRef.current = window.turnstile.render(container, {
            sitekey: siteKey,
            action,
            appearance: "interaction-only",
            execution: "execute",
            callback: (token) => {
              if (!pendingRef.current) return;
              clearTimeout(pendingRef.current.timeout);
              pendingRef.current.resolve(token);
              pendingRef.current = null;
            },
            "error-callback": () => rejectPending(new Error("turnstile_error")),
            "expired-callback": () => rejectPending(new Error("turnstile_expired")),
          });
          setReady(Boolean(widgetIdRef.current));
        } catch {
          setReady(false);
        }
      })
      .catch(() => {
        setReady(false);
      });

    return () => {
      mounted = false;
      setReady(false);
      rejectPending(new Error("turnstile_unmounted"));
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, container, rejectPending, siteKey]);

  const execute = useCallback(async () => {
    const localToken = localDevelopmentToken();
    if (localToken) return localToken;

    if (!siteKey) {
      throw new Error("turnstile_unconfigured");
    }

    await loadTurnstileScript();
    const widgetId = widgetIdRef.current;
    if (!widgetId || !window.turnstile) throw new Error("turnstile_not_ready");

    window.turnstile.reset(widgetId);
    return await new Promise<string>((resolve, reject) => {
      rejectPending(new Error("turnstile_replaced"));
      pendingRef.current = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          rejectPending(new Error("turnstile_timeout"));
        }, 15_000),
      };
      window.turnstile?.execute(widgetId);
    });
  }, [rejectPending, siteKey]);

  return { containerRef, execute, ready };
}
