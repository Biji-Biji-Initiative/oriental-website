export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, non-secret configuration the browser needs at runtime. Served from a
 * route handler (instead of being rendered into the page) so the pages
 * themselves stay statically prerendered while env values remain rotatable
 * without a rebuild.
 */
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

function gaMeasurementId() {
  const value = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "";
  return GA_MEASUREMENT_ID_PATTERN.test(value) ? value : null;
}

export async function GET(request?: Request) {
  const hostname = request ? new URL(request.url).hostname.toLowerCase() : "";
  const canonicalStaging = hostname === "staging.oriental.mereka.io";
  return Response.json(
    {
      turnstileSiteKey: null,
      gaMeasurementId: gaMeasurementId(),
      // Variant selection is a QA tool, not a production default. Keeping it
      // opt-in prevents voice/persona changes from contaminating latency trials.
      voiceVariantPicker: canonicalStaging && process.env.VOICE_VARIANT_PICKER === "true",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
