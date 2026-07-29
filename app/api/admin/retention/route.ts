import { withAdminPermission } from "@/lib/server/admin-route";
import { applyDataRetention } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAdminPermission("ops.retention", async (_request, auth) => {
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
});
