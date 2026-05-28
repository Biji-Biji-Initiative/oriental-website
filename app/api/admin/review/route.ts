import { verifyAdminRequest } from "@/lib/server/admin-auth";
import { getAdminReviewDashboard } from "@/lib/server/convex";
import { logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = verifyAdminRequest(request);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const dashboard = await getAdminReviewDashboard(75).catch((error) => {
    logWarn("admin_review.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });
  if (!dashboard.ok) return noStoreJson({ ok: false, error: dashboard.reason }, { status: 503 });
  return noStoreJson({ ok: true, ...dashboard.data });
}
