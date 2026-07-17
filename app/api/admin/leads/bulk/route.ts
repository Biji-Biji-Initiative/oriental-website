import { randomUUID } from "node:crypto";
import { adminLeadBulkAssignmentSchema } from "@/lib/schemas";
import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { bulkAssignAdminLeads } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "leads.bulk_assign");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }

  const raw = await request.json().catch(() => null);
  const parsed = adminLeadBulkAssignmentSchema.safeParse(raw);
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

  const requestId = normalizedRequestId(request.headers.get("x-request-id"));
  const result = await bulkAssignAdminLeads(parsed.data, { actor: auth.actor, requestId }).catch((error) => {
    logWarn("admin_lead.bulk_assignment_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" as const };
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "conflict"
          ? 409
          : result.reason === "invalid_workflow"
            ? 400
            : 503;
    return noStoreJson(
      {
        ok: false,
        error: result.reason,
        ...(result.reason !== "convex_failed" && "leadIds" in result ? { leadIds: result.leadIds } : {}),
      },
      { status },
    );
  }

  logInfo("admin_lead.bulk_assigned", {
    actor: auth.actor,
    count: result.count,
    owner: parsed.data.owner,
    requestId,
  });
  return noStoreJson({ ok: true, count: result.count });
}

function normalizedRequestId(value: string | null) {
  const candidate = value?.trim();
  return candidate && candidate.length <= 120 ? candidate : randomUUID();
}
