import { withAdminPermission } from "@/lib/server/admin-route";
import { getAdminApplicationLogs } from "@/lib/server/convex";
import { logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdminPermission("ops.logs.read", async (request) => {
  const requestedLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
  const result = await getAdminApplicationLogs(limit).catch((error) => {
    logWarn("admin_logs.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });
  if (!result.ok) return noStoreJson({ ok: false, error: result.reason }, { status: 503 });
  return noStoreJson({ ok: true, logs: result.logs });
});
