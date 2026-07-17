"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

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

/**
 * GA4 loader + SPA page_view tracking. Renders nothing unless
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is configured. Mounted inside PublicChrome so
 * it never loads on /admin routes; shouldTrackPath double-guards client-side
 * navigations. `send_page_view` is disabled in config — the pathname effect
 * emits every page_view (including the first) so soft navigations are counted.
 */
export function GoogleAnalytics() {
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
    window.gtag("event", "page_view", { page_path: pathname, page_location: window.location.href });
  }, [pathname]);

  if (!GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });`}
      </Script>
    </>
  );
}
