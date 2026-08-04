export const BRAND_MOTION_PRODUCTION_HOST = "oriental.mereka.io";
export const BRAND_MOTION_STAGING_HOST = "staging.oriental.mereka.io";
// The Mereka M is the approved public identity. A build can opt out only for
// an emergency visual rollback; the old staging-preview switch is deliberately
// ignored so it cannot silently restore the legacy orb in production.
export const BRAND_MOTION_ENABLED = process.env.NEXT_PUBLIC_BRAND_MOTION_ENABLED !== "false";

export const MEREKA_MARK_WIDTH = 427.76;
export const MEREKA_MARK_HEIGHT = 342.13;
export const MEREKA_MARK_VIEWBOX = `0 0 ${MEREKA_MARK_WIDTH} ${MEREKA_MARK_HEIGHT}`;
export const MEREKA_MARK_DOT = { cx: 363.62, cy: 277.69, radius: 64.14 } as const;

// Canonical Mereka logomark geometry from bbbi-mereka-brand-assets. Keep this
// path byte-for-byte aligned with the approved SVG; both motion treatments use
// it as their measured silhouette rather than redrawing the M by eye.
export const MEREKA_MARK_PATH =
  "M356.93,128.09c.53,0,1.05,0,1.57.02,1.38.1,2.78.16,4.19.17.21,0,.43,0,.64,0,35.43,0,64.14-28.72,64.14-64.14S398.76,0,363.33,0c-28.15,0-52.06,18.13-60.7,43.36-.01.03-.02.07-.03.1-.42,1.59-.89,3.16-1.4,4.71-.03.1-.05.19-.07.29-11.25,34.08-43.36,58.67-81.2,58.67-.49,0-.98,0-1.47-.01-.14-.01-.29-.02-.44-.03-.47-.03-.94-.06-1.41-.08-.8-.04-1.59-.06-2.4-.07-.12,0-.23,0-.35,0-.02,0-.04,0-.06,0-.02,0-.05,0-.07,0s-.05,0-.07,0c-.02,0-.04,0-.06,0-.12,0-.24,0-.35,0-.8,0-1.6.03-2.4.07-.47.02-.94.05-1.41.08-.14,0-.29.01-.44.03-.49,0-.98.01-1.47.01-37.43,0-69.23-24.06-80.81-57.56-5.26-22.59-22.46-40.59-44.59-47-.2-.06-.41-.12-.61-.17-.61-.17-1.23-.34-1.85-.49-.48-.12-.97-.23-1.46-.34-.39-.09-.78-.18-1.18-.26-.97-.2-1.95-.37-2.93-.52-.08-.01-.17-.02-.25-.04-.99-.15-1.99-.28-2.99-.38h-.07c-2.19-.23-4.41-.36-6.66-.36C28.72,0,0,28.72,0,64.14c0,18.9,8.17,35.88,21.18,47.62,14.82,15.38,23.94,36.27,23.94,59.31s-9.4,44.59-24.62,60.03c-.69.7-1.39,1.39-2.11,2.06,0,0-.01,0-.02.02C7.09,244.75.14,260.56.14,277.98c0,35.42,28.72,64.14,64.14,64.14s64.14-28.72,64.14-64.14c0-17.42-6.95-33.23-18.23-44.79,0,0-.01-.01-.02-.02-.71-.68-1.42-1.36-2.11-2.06-15.23-15.44-24.62-36.64-24.62-60.03,0-14.41,3.58-27.99,9.88-39.9,26.74,7.38,48.22,27.41,57.6,53.26,5.63,26.6,27.75,47.1,55.16,50.33.03,0,.07,0,.1.01.68.08,1.37.15,2.06.2.34.03.68.05,1.02.08.55.04,1.09.07,1.64.1.75.03,1.51.05,2.27.06.16,0,.33.01.49.01.02,0,.05,0,.07,0s.05,0,.07,0c.16,0,.33-.01.49-.01.76,0,1.52-.02,2.27-.06.55-.02,1.1-.06,1.64-.1.34-.02.68-.05,1.02-.08.69-.06,1.38-.12,2.06-.2.03,0,.07,0,.1-.01,27.41-3.23,49.52-23.73,55.16-50.33,11.92-32.86,43.41-56.34,80.38-56.34Z";

export const MEREKA_NEBULA_PARTICLE_COUNT = 2_100;
export const MEREKA_TRACE_DURATION_MS = 2_600;

export function isBrandMotionHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized === BRAND_MOTION_PRODUCTION_HOST ||
    normalized === BRAND_MOTION_STAGING_HOST ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function isBrandMotionEnabled(buildFlag: boolean, hostname: string) {
  return buildFlag && isBrandMotionHost(hostname);
}
