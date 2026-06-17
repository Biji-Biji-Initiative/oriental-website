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
      voiceVariantPicker: true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
