import { z } from "zod";
import { normalizeAdminLeadStatus } from "@/lib/admin-workflow";
import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { getAdminReviewDashboard } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  maxUnownedHours: z.number().min(1).max(72).optional(),
});

const ACTIVE_EXEMPT = new Set(["qualified", "archived"]);

/**
 * Operational SLA sweep, designed for an hourly cron. Alerts the ops Slack
 * channel (throttled + fingerprinted by ops-alerts) when leads are unowned
 * beyond the window or notifications have failed, so breaches surface without
 * anyone watching the console.
 */
export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "dashboard.read");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, { status: 400 });
  const maxUnownedMs = (parsed.data.maxUnownedHours ?? 4) * 60 * 60 * 1000;

  const dashboard = await getAdminReviewDashboard(75).catch((error) => {
    logWarn("admin_sla.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });
  if (!dashboard.ok) return noStoreJson({ ok: false, error: dashboard.reason }, { status: 503 });

  const now = dashboard.data.generatedAt;
  const active = dashboard.data.leads.filter((lead) => !ACTIVE_EXEMPT.has(normalizeAdminLeadStatus(lead.status)));
  const unownedBreaches = active.filter((lead) => !lead.owner?.trim() && now - lead.createdAt > maxUnownedMs);
  const failedNotifications = dashboard.data.queues.failedNotifications.length;

  let alerted = false;
  if (unownedBreaches.length > 0 || failedNotifications > 0) {
    const worstAgeH = Math.max(...unownedBreaches.map((lead) => now - lead.createdAt), 0) / 3_600_000;
    const result = await sendOpsAlert({
      event: "lead_sla_breach",
      severity: failedNotifications > 0 ? "error" : "warning",
      summary:
        `${unownedBreaches.length} lead(s) unowned beyond ${Math.round(maxUnownedMs / 3_600_000)}h` +
        `${failedNotifications > 0 ? ` · ${failedNotifications} failed notification(s)` : ""} — ` +
        "assign owners in the admin console.",
      meta: {
        unowned: unownedBreaches.length,
        failedNotifications,
        oldestUnownedHours: Math.round(worstAgeH * 10) / 10,
        console: "https://oriental.mereka.io/admin/session-review?view=leads&sort=attention",
      },
      fingerprint: `unowned=${unownedBreaches.length}:failed=${failedNotifications}`,
    });
    alerted = result.ok === true;
  }

  logInfo("admin_sla.checked", {
    actor: auth.actor,
    unowned: unownedBreaches.length,
    failedNotifications,
    alerted,
  });
  return noStoreJson({
    ok: true,
    unownedBreaches: unownedBreaches.length,
    failedNotifications,
    activeLeads: active.length,
    alerted,
  });
}
