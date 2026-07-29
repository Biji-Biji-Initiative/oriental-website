import { withAdminPermission } from "@/lib/server/admin-route";
import { getAdminAggregateMetrics } from "@/lib/server/convex";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdminPermission("dashboard.aggregate", async () => {
  const aggregate = await getAdminAggregateMetrics(75).catch(() => ({
    ok: false as const,
    reason: "convex_failed",
  }));
  if (!aggregate.ok) return noStoreJson({ ok: false, error: aggregate.reason }, { status: 503 });
  return noStoreJson({ ok: true, metrics: aggregate.data.metrics });
});
