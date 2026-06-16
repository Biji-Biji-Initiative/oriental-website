import { readEnv } from "@/lib/env";

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
      turnstileSiteKey: readEnv("TURNSTILE_SITE_KEY") || readEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY") || null,
      // QA-only: floating voice variant picker for the team to A/B Reka's voice.
      voiceVariantPicker: readEnv("VOICE_VARIANT_PICKER") === "true",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
