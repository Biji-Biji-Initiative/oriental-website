export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  return Response.json(
    {
      ok: true,
      version: process.env.GIT_SHA ?? process.env.SOURCE_COMMIT ?? "local",
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      convex: Boolean(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
