import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { applyDataRetention } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "ops.retention");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }

  const result = await applyDataRetention(Date.now()).catch((error) => {
    logWarn("admin_retention.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" as const };
  });
  if (!result.ok) return noStoreJson({ ok: false, error: result.reason }, { status: 503 });

  logInfo("admin_retention.applied", {
    actor: auth.actor,
    ...result.deleted,
    redactedLeadTranscripts: result.redacted.leadTranscripts,
    hasMore: result.hasMore,
  });
  return noStoreJson({ ok: true, deleted: result.deleted, redacted: result.redacted, hasMore: result.hasMore });
}
