import { z } from "zod";
import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { getAdminLeadSlaSnapshot } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  maxUnownedHours: z.number().min(1).max(72).optional(),
});

/**
 * Operational SLA sweep, designed for an hourly cron. Alerts the ops Slack
 * channel (throttled + fingerprinted by ops-alerts) when leads are unowned
 * beyond the window or notifications have failed, so breaches surface without
 * anyone watching the console.
 */
export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "ops.sla_check");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_request" }, { status: 400 });
  const maxUnownedMs = (parsed.data.maxUnownedHours ?? 4) * 60 * 60 * 1000;

  const snapshot = await getAdminLeadSlaSnapshot(maxUnownedMs).catch((error) => {
    logWarn("admin_sla.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });
  if (!snapshot.ok) return noStoreJson({ ok: false, error: snapshot.reason }, { status: 503 });

  const { generatedAt: now, activeLeads, unownedBreaches, failedNotifications } = snapshot.data;

  let alerted = false;
  if (unownedBreaches.count > 0 || failedNotifications.count > 0) {
    const worstAgeH = unownedBreaches.oldestCreatedAt ? (now - unownedBreaches.oldestCreatedAt) / 3_600_000 : 0;
    const result = await sendOpsAlert({
      event: "lead_sla_breach",
      severity: failedNotifications.count > 0 ? "error" : "warning",
      summary:
        `${formatSlaCount(unownedBreaches)} lead(s) unowned beyond ${Math.round(maxUnownedMs / 3_600_000)}h` +
        `${
          failedNotifications.count > 0 ? ` · ${formatSlaCount(failedNotifications)} failed notification(s)` : ""
        } — ` +
        "assign owners in the admin console.",
      meta: {
        unowned: unownedBreaches.count,
        unownedCountIsLowerBound: unownedBreaches.truncated,
        failedNotifications: failedNotifications.count,
        failedNotificationCountIsLowerBound: failedNotifications.truncated,
        oldestUnownedHours: Math.round(worstAgeH * 10) / 10,
        console: "https://oriental.mereka.io/admin/session-review?view=leads&sort=attention",
      },
      fingerprint: `unowned=${formatSlaCount(unownedBreaches)}:` + `failed=${formatSlaCount(failedNotifications)}`,
    });
    alerted = result.ok === true;
  }

  logInfo("admin_sla.checked", {
    actor: auth.actor,
    unowned: unownedBreaches.count,
    unownedCountIsLowerBound: unownedBreaches.truncated,
    failedNotifications: failedNotifications.count,
    failedNotificationCountIsLowerBound: failedNotifications.truncated,
    alerted,
  });
  return noStoreJson({
    ok: true,
    unownedBreaches: unownedBreaches.count,
    failedNotifications: failedNotifications.count,
    activeLeads: activeLeads.count,
    truncated: {
      unownedBreaches: unownedBreaches.truncated,
      failedNotifications: failedNotifications.truncated,
      activeLeads: activeLeads.truncated,
    },
    alerted,
  });
}

function formatSlaCount(metric: { count: number; truncated: boolean }) {
  return `${metric.count}${metric.truncated ? "+" : ""}`;
}
