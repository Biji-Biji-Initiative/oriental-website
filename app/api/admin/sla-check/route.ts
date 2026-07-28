import { z } from "zod";
import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { getAdminLeadSlaSnapshot, getAdminOrphanedVoiceSessions } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
import { noStoreJson } from "@/lib/server/security";
import { DEFAULT_ORPHAN_STALE_MINUTES, MIN_ORPHAN_STALE_MINUTES } from "@/lib/voice/session-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORPHAN_SWEEP_TIMEOUT_MS = 5_000;

const requestSchema = z.object({
  maxUnownedHours: z.number().min(1).max(72).optional(),
  // A voice session that connected but never recorded a close is either still
  // live or lost its final snapshot to a network death. The schema floor is
  // derived from the longest valid call, goodbye grace, and two heartbeats.
  maxVoiceStaleMinutes: z.number().min(MIN_ORPHAN_STALE_MINUTES).max(1440).optional(),
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
  const maxVoiceStaleMs = (parsed.data.maxVoiceStaleMinutes ?? DEFAULT_ORPHAN_STALE_MINUTES) * 60 * 1000;

  const snapshot = await getAdminLeadSlaSnapshot(maxUnownedMs).catch((error) => {
    logWarn("admin_sla.convex_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });
  if (!snapshot.ok) return noStoreJson({ ok: false, error: snapshot.reason }, { status: 503 });

  const { generatedAt: now, activeLeads, unownedBreaches, failedNotifications } = snapshot.data;

  // Orphaned voice sessions (connected, never closed) are the signature of a
  // dropped call whose final snapshot never reached us. Surface them here so
  // the invisible failures become visible, but never let their lookup fail the
  // core lead SLA sweep.
  const orphanSweep = await orphanSweepWithDeadline(maxVoiceStaleMs);
  let orphanedVoiceSessions: Extract<typeof orphanSweep, { ok: true }>["data"]["orphaned"] | null = null;
  let orphanSweepUnavailableReason: string | null = null;
  if (!orphanSweep.ok) {
    orphanSweepUnavailableReason = orphanSweep.reason;
  } else if (orphanSweep.data.migrationPending) {
    orphanSweepUnavailableReason = "migration_pending";
  } else {
    orphanedVoiceSessions = orphanSweep.data.orphaned;
  }
  const orphanSweepAvailable = orphanSweepUnavailableReason === null;
  if (!orphanSweepAvailable) {
    logWarn("admin_sla.orphan_sweep_failed", { reason: orphanSweepUnavailableReason });
  }

  let alerted = false;
  const orphanCount = orphanedVoiceSessions?.count ?? null;
  if (unownedBreaches.count > 0 || failedNotifications.count > 0 || (orphanCount ?? 0) > 0) {
    const worstAgeH = unownedBreaches.oldestCreatedAt ? (now - unownedBreaches.oldestCreatedAt) / 3_600_000 : 0;
    const summaryParts: string[] = [];
    if (unownedBreaches.count > 0) {
      summaryParts.push(
        `${formatSlaCount(unownedBreaches)} lead(s) unowned beyond ${Math.round(maxUnownedMs / 3_600_000)}h`,
      );
    }
    if (failedNotifications.count > 0) {
      summaryParts.push(`${formatSlaCount(failedNotifications)} failed notification(s)`);
    }
    if (orphanedVoiceSessions && orphanedVoiceSessions.count > 0) {
      summaryParts.push(`${formatSlaCount(orphanedVoiceSessions)} voice session(s) dropped without a close snapshot`);
    }
    const result = await sendOpsAlert({
      event: "lead_sla_breach",
      severity: failedNotifications.count > 0 ? "error" : "warning",
      summary: `${summaryParts.join(" · ")} — review in the admin console.`,
      meta: {
        unowned: unownedBreaches.count,
        unownedCountIsLowerBound: unownedBreaches.truncated,
        failedNotifications: failedNotifications.count,
        failedNotificationCountIsLowerBound: failedNotifications.truncated,
        orphanedVoiceSessions: orphanCount,
        orphanedVoiceSessionsIsLowerBound: orphanedVoiceSessions?.truncated ?? null,
        oldestUnownedHours: Math.round(worstAgeH * 10) / 10,
        console: "https://oriental.mereka.io/admin/session-review?view=leads&sort=attention",
      },
      fingerprint:
        `unowned=${formatSlaCount(unownedBreaches)}:` +
        `failed=${formatSlaCount(failedNotifications)}:` +
        `orphaned=${orphanedVoiceSessions ? formatSlaCount(orphanedVoiceSessions) : "na"}`,
    });
    alerted = result.ok === true;
  }

  logInfo("admin_sla.checked", {
    actor: auth.actor,
    unowned: unownedBreaches.count,
    unownedCountIsLowerBound: unownedBreaches.truncated,
    failedNotifications: failedNotifications.count,
    failedNotificationCountIsLowerBound: failedNotifications.truncated,
    orphanedVoiceSessions: orphanCount,
    orphanSweepAvailable,
    orphanSweepUnavailableReason,
    alerted,
  });
  return noStoreJson({
    ok: true,
    unownedBreaches: unownedBreaches.count,
    failedNotifications: failedNotifications.count,
    activeLeads: activeLeads.count,
    orphanedVoiceSessions: orphanCount,
    orphanSweepAvailable,
    orphanSweepUnavailableReason,
    truncated: {
      unownedBreaches: unownedBreaches.truncated,
      failedNotifications: failedNotifications.truncated,
      activeLeads: activeLeads.truncated,
      orphanedVoiceSessions: orphanedVoiceSessions?.truncated ?? null,
    },
    alerted,
  });
}

async function orphanSweepWithDeadline(maxVoiceStaleMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getAdminOrphanedVoiceSessions(maxVoiceStaleMs).catch((error) => ({
        ok: false as const,
        reason: error instanceof Error ? "query_failed" : "unexpected_failure",
      })),
      new Promise<{ ok: false; reason: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ ok: false, reason: "timeout" }), ORPHAN_SWEEP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatSlaCount(metric: { count: number; truncated: boolean }) {
  return `${metric.count}${metric.truncated ? "+" : ""}`;
}
