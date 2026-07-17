export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, non-secret configuration the browser needs at runtime. Served from a
 * route handler (instead of being rendered into the page) so the pages
 * themselves stay statically prerendered while env values remain rotatable
 * without a rebuild.
 */
export async function GET() {
  return Response.json(
    {
      turnstileSiteKey: null,
      // Variant selection is a QA tool, not a production default. Keeping it
      // opt-in prevents voice/persona changes from contaminating latency trials.
      voiceVariantPicker: process.env.VOICE_VARIANT_PICKER === "true",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
