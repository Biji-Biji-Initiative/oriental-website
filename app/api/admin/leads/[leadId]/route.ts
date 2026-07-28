import { randomUUID } from "node:crypto";
import { adminLeadWorkflowSchema } from "@/lib/schemas";
import { withAdminPermission } from "@/lib/server/admin-route";
import { updateAdminLeadWorkflow } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withAdminPermission(
  "leads.update",
  async (request, auth, context: RouteContext<"/api/admin/leads/[leadId]">) => {
    const raw = await request.json().catch(() => null);
    const parsed = adminLeadWorkflowSchema.safeParse(raw);
    if (!parsed.success) {
      return noStoreJson(
        {
          ok: false,
          error: "invalid_payload",
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]),
          ),
        },
        { status: 400 },
      );
    }

    const { leadId } = await context.params;
    const requestId = normalizedRequestId(request.headers.get("x-request-id"));
    const result = await updateAdminLeadWorkflow(decodeURIComponent(leadId), parsed.data, {
      actor: auth.actor,
      requestId,
    }).catch((error) => {
      logWarn("admin_lead.workflow_update_failed", { error: error instanceof Error ? error.message : "unknown" });
      return { ok: false as const, reason: "convex_failed" };
    });

    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "conflict"
            ? 409
            : result.reason === "invalid_workflow" || result.reason === "archive_boundary"
              ? 400
              : 503;
      return noStoreJson(
        {
          ok: false,
          error: result.reason,
          ...(result.reason === "conflict" && "currentRevision" in result
            ? { currentRevision: result.currentRevision }
            : {}),
        },
        { status },
      );
    }

    logInfo("admin_lead.workflow_updated", {
      leadId: decodeURIComponent(leadId),
      status: parsed.data.status,
      priority: parsed.data.priority,
      ownerAssigned: parsed.data.owner.trim().length > 0,
      noteAdded: Boolean(parsed.data.note?.trim()),
      requestId,
      revision: result.revision,
    });

    return noStoreJson({ ok: true, changed: result.changed, revision: result.revision });
  },
);

function normalizedRequestId(value: string | null) {
  const candidate = value?.trim();
  return candidate && candidate.length <= 120 ? candidate : randomUUID();
}
