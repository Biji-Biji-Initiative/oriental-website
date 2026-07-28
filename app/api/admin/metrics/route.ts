import { withAdminPermission } from "@/lib/server/admin-route";
import { getAdminReviewDashboard } from "@/lib/server/convex";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAdminPermission("dashboard.aggregate", async () => {
  const dashboard = await getAdminReviewDashboard(75).catch(() => ({ ok: false as const, reason: "convex_failed" }));
  if (!dashboard.ok) return noStoreJson({ ok: false, error: dashboard.reason }, { status: 503 });
  return noStoreJson({ ok: true, metrics: dashboard.data.metrics });
});
