import { readEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  return Response.json(
    {
      ok: true,
      version: readEnv("GIT_SHA") ?? readEnv("SOURCE_COMMIT") ?? "local",
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      convex: Boolean(readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL")),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
