import { z } from "zod";
import { withAdminPermission } from "@/lib/server/admin-route";
import { deletePersonalData, getPrivacyDeletionPlan } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { normalizePrivacyEmail } from "@/lib/server/privacy";
import { deleteAddressablePrivacyCopies, privacyManualCleanupCounts } from "@/lib/server/privacy-downstream";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
  confirmation: z.literal("DELETE"),
  reason: z.enum(["data_subject_request", "consent_withdrawn", "operator_correction"]),
  requestId: z.string().uuid(),
  manualCopiesConfirmedDeleted: z.boolean().default(false),
});

export const DELETE = withAdminPermission("privacy.delete", async (request, auth) => {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, { status: 400 });

  const email = normalizePrivacyEmail(parsed.data.email);
  const plan = await getPrivacyDeletionPlan(email).catch((error) => {
    logWarn("admin_privacy_delete.plan_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false as const, reason: "convex_failed" as const };
  });
  if (!plan.ok) return noStoreJson({ ok: false, error: plan.reason }, { status: 503 });
  if (!plan.complete) {
    return noStoreJson({ ok: false, error: "normalization_in_progress", retryable: true }, { status: 409 });
  }

  const manualCleanup = privacyManualCleanupCounts(plan);
  const hasManualCopies = Object.values(manualCleanup).some((count) => count > 0);
  if (hasManualCopies && !parsed.data.manualCopiesConfirmedDeleted) {
    return noStoreJson({ ok: false, error: "manual_cleanup_required", manualCleanup }, { status: 409 });
  }

  const downstream = await deleteAddressablePrivacyCopies(plan);
  if (!downstream.ok) {
    logWarn("admin_privacy_delete.downstream_failed", { failures: downstream.failures });
    return noStoreJson(
      { ok: false, error: "downstream_cleanup_failed", failures: downstream.failures },
      { status: 502 },
    );
  }

  const result = await deletePersonalData({
    email,
    reason: parsed.data.reason,
    requestId: parsed.data.requestId,
    actor: auth.actor,
    downstreamCleanupComplete: true,
  }).catch((error) => {
    logWarn("admin_privacy_delete.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" as const };
  });
  if (!result.ok) return noStoreJson({ ok: false, error: result.reason }, { status: 503 });
  if (!result.complete) {
    logInfo("admin_privacy_delete.incomplete", {
      actor: auth.actor,
      requestId: parsed.data.requestId,
      deletedLeads: result.deleted.leads,
      deletedVoiceSessions: result.deleted.voiceSessions,
      deletedLeadEvents: result.deleted.leadEvents,
      manualCopiesConfirmedDeleted: parsed.data.manualCopiesConfirmedDeleted,
    });
    return noStoreJson(
      {
        ok: false,
        error: "deletion_incomplete",
        retryable: true,
        deleted: result.deleted,
        complete: false,
      },
      { status: 409 },
    );
  }

  logInfo("admin_privacy_delete.completed", {
    actor: auth.actor,
    requestId: parsed.data.requestId,
    deletedLeads: result.deleted.leads,
    deletedVoiceSessions: result.deleted.voiceSessions,
    deletedLeadEvents: result.deleted.leadEvents,
    manualCopiesConfirmedDeleted: parsed.data.manualCopiesConfirmedDeleted,
  });
  return noStoreJson({ ok: true, deleted: result.deleted, complete: true });
});
