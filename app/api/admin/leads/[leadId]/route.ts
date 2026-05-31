import { adminLeadWorkflowSchema } from "@/lib/schemas";
import { verifyAdminRequest } from "@/lib/server/admin-auth";
import { updateAdminLeadWorkflow } from "@/lib/server/convex";
import { logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: RouteContext<"/api/admin/leads/[leadId]">) {
  const auth = verifyAdminRequest(request);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const raw = await request.json().catch(() => null);
  const parsed = adminLeadWorkflowSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_payload" }, { status: 400 });

  const { leadId } = await context.params;
  const result = await updateAdminLeadWorkflow(decodeURIComponent(leadId), parsed.data).catch((error) => {
    logWarn("admin_lead.workflow_update_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 503;
    return noStoreJson({ ok: false, error: result.reason }, { status });
  }

  return noStoreJson({ ok: true });
}
