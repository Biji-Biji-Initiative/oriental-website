"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";

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

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

/**
 * GA4 loader + SPA page_view tracking. The measurement id comes from
 * `/api/client-config` at runtime (never a NEXT_PUBLIC_ build inline), matching
 * this repo's rotatable-config contract: pages stay statically prerendered and
 * the id can change without an image rebuild. Renders nothing until the config
 * returns a valid id. Mounted inside PublicChrome so it never loads on /admin;
 * shouldTrackPath double-guards client-side navigations. `send_page_view` is
 * disabled — the pathname effect emits every page_view (including the first).
 */
export function GoogleAnalytics() {
  const pathname = usePathname();
  const [measurementId, setMeasurementId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/client-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((config: { gaMeasurementId?: string | null } | null) => {
        const id = config?.gaMeasurementId ?? "";
        if (!cancelled && GA_MEASUREMENT_ID_PATTERN.test(id)) setMeasurementId(id);
      })
      .catch(() => {
        // Analytics is never worth breaking the page over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!measurementId || !shouldTrackPath(pathname)) return;
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
    window.gtag("event", "page_view", { page_path: pathname, page_location: window.location.href });
  }, [measurementId, pathname]);

  if (!measurementId) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', { send_page_view: false });`}
      </Script>
    </>
  );
}
