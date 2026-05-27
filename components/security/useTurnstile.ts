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

function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("turnstile_server_context"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("turnstile_script_failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_script_failed"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function localDevelopmentToken() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ? "local-dev" : null;
}

export function useTurnstile(action: string) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingRef = useRef<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [ready, setReady] = useState(!siteKey);

  const rejectPending = useCallback((error: Error) => {
    if (!pendingRef.current) return;
    clearTimeout(pendingRef.current.timeout);
    pendingRef.current.reject(error);
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let mounted = true;

    loadTurnstileScript()
      .then(() => {
        if (!mounted || !window.turnstile || !containerRef.current || widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
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
        setReady(true);
      })
      .catch(() => {
        setReady(false);
      });

    return () => {
      mounted = false;
      rejectPending(new Error("turnstile_unmounted"));
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, rejectPending, siteKey]);

  const execute = useCallback(async () => {
    if (!siteKey) {
      const token = localDevelopmentToken();
      if (token) return token;
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
