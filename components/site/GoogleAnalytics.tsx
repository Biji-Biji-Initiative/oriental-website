"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";

const configuredMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const GA_MEASUREMENT_ID =
  configuredMeasurementId && isGaMeasurementId(configuredMeasurementId) ? configuredMeasurementId : undefined;
export const analyticsConsentStorageKey = "oriental_analytics_consent_v1";
export const analyticsConsentEvent = "oriental:analytics-consent";

type AnalyticsConsent = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Admin and API surfaces are internal — operator traffic must never pollute analytics. */
export function shouldTrackPath(pathname: string | null | undefined) {
  if (!pathname) return false;
  return !pathname.startsWith("/admin") && !pathname.startsWith("/api");
}

export function isAnalyticsConsent(value: string | null): value is AnalyticsConsent {
  return value === "granted" || value === "denied";
}

export function isGaMeasurementId(value: string) {
  return /^G-[A-Z0-9]{4,16}$/.test(value);
}

export function isGoogleAnalyticsCookieName(name: string) {
  return name === "_ga" || name.startsWith("_ga_");
}

export function analyticsPageLocation(origin: string, pathname: string) {
  return `${origin}${pathname}`;
}

/**
 * Explicit-consent GA4 loader + SPA page_view tracking. The public measurement
 * id is baked into the reviewed image and verified at the release boundary.
 * Mounted inside PublicChrome so it never loads on /admin; shouldTrackPath
 * double-guards client-side navigations. `send_page_view` is disabled — the
 * pathname effect emits every page_view (including the first).
 */
export function GoogleAnalytics() {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    const stored = readStoredConsent();
    setConsent(isAnalyticsConsent(stored) ? stored : null);
    if (stored === "denied") clearAnalyticsCookies();

    const syncConsent = (event: Event) => {
      const next = (event as CustomEvent<AnalyticsConsent>).detail;
      if (isAnalyticsConsent(next)) setConsent(next);
    };
    window.addEventListener(analyticsConsentEvent, syncConsent);
    return () => window.removeEventListener(analyticsConsentEvent, syncConsent);
  }, []);

  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      {consent === "granted" ? <GoogleAnalyticsLoader /> : null}
      {consent === null ? <AnalyticsConsentPrompt onConsent={setConsent} /> : null}
    </>
  );
}

function GoogleAnalyticsLoader() {
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_MEASUREMENT_ID || !shouldTrackPath(pathname)) return;
    // Queue-safe: define the canonical stub if gtag.js has not loaded yet —
    // entries flush when it does. gtag.js consumes the Arguments object from
    // dataLayer, so the stub must push `arguments`, never a rest array.
    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() {
        // biome-ignore lint/complexity/noArguments: gtag.js consumes the Arguments object from dataLayer
        window.dataLayer?.push(arguments);
      };
    }
    window.gtag("event", "page_view", {
      page_path: pathname,
      // Never send query strings or fragments: intake links may contain context.
      page_location: analyticsPageLocation(window.location.origin, pathname),
    });
  }, [pathname]);

  const measurementId = GA_MEASUREMENT_ID;
  if (!measurementId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', {
  send_page_view: false,
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false
});`}
      </Script>
    </>
  );
}

function AnalyticsConsentPrompt({ onConsent }: { onConsent: (consent: AnalyticsConsent) => void }) {
  function choose(consent: AnalyticsConsent) {
    writeStoredConsent(consent);
    if (consent === "denied") clearAnalyticsCookies();
    onConsent(consent);
  }

  return (
    <section
      aria-label="Analytics privacy choices"
      className="fixed right-3 bottom-3 left-3 z-[90] mx-auto max-w-2xl rounded-2xl border border-mk-off-black/15 bg-mk-paper p-4 text-mk-off-black shadow-2xl sm:right-5 sm:bottom-5 sm:left-auto sm:p-5"
    >
      <h2 className="text-sm font-semibold">Your privacy, your choice</h2>
      <p className="mt-1 text-xs leading-5 text-mk-off-black/68">
        We use optional Google Analytics only to understand public page usage. It stays off unless you allow it. Your
        enquiry and voice handoff work without analytics.{" "}
        <a className="font-semibold underline" href="/privacy">
          Read the privacy notice
        </a>
        .
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="min-h-10 rounded-full bg-mk-anchor-blue px-4 text-xs font-semibold text-white"
          onClick={() => choose("granted")}
          type="button"
        >
          Allow analytics
        </button>
        <button
          className="min-h-10 rounded-full border border-mk-off-black/20 px-4 text-xs font-semibold"
          onClick={() => choose("denied")}
          type="button"
        >
          Only necessary
        </button>
      </div>
    </section>
  );
}

export function AnalyticsConsentSettings() {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    const stored = readStoredConsent();
    setConsent(isAnalyticsConsent(stored) ? stored : null);
  }, []);

  function update(next: AnalyticsConsent) {
    writeStoredConsent(next);
    setConsent(next);
    window.dispatchEvent(new CustomEvent<AnalyticsConsent>(analyticsConsentEvent, { detail: next }));
    if (next === "denied" && window.gtag) {
      window.gtag("consent", "update", { analytics_storage: "denied" });
    }
    if (next === "denied") clearAnalyticsCookies();
  }

  return (
    <div className="rounded-2xl border border-mk-off-black/12 bg-white/60 p-5" id="analytics-choices">
      <h2 className="text-lg font-semibold">Analytics choice</h2>
      <p className="mt-2 text-sm leading-6 text-mk-off-black/68">
        Current choice: <strong>{consent === "granted" ? "Allowed" : consent === "denied" ? "Off" : "Not set"}</strong>.
        You can change it at any time; turning it off stops future analytics events on this site.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="min-h-10 rounded-full bg-mk-anchor-blue px-4 text-sm font-semibold text-white"
          onClick={() => update("granted")}
          type="button"
        >
          Allow analytics
        </button>
        <button
          className="min-h-10 rounded-full border border-mk-off-black/20 px-4 text-sm font-semibold"
          onClick={() => update("denied")}
          type="button"
        >
          Turn analytics off
        </button>
      </div>
    </div>
  );
}

function readStoredConsent() {
  try {
    return window.localStorage.getItem(analyticsConsentStorageKey);
  } catch {
    return null;
  }
}

function writeStoredConsent(consent: AnalyticsConsent) {
  try {
    window.localStorage.setItem(analyticsConsentStorageKey, consent);
  } catch {
    // Storage can be unavailable in hardened browsers. The in-memory choice
    // still applies for this page; the next visit fails closed and asks again.
  }
}

function clearAnalyticsCookies() {
  const names = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0] ?? "")
    .filter(isGoogleAnalyticsCookieName);
  const registrableDomain = window.location.hostname.split(".").slice(-2).join(".");
  for (const name of names) {
    // biome-ignore lint/suspicious/noDocumentCookie: explicit consent withdrawal must expire GA's first-party cookies
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    if (registrableDomain.includes(".")) {
      // biome-ignore lint/suspicious/noDocumentCookie: cover GA cookies scoped to the parent site domain
      document.cookie = `${name}=; Path=/; Domain=.${registrableDomain}; Max-Age=0; SameSite=Lax`;
    }
  }
}
