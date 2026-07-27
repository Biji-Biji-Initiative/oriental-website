import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/sla-check/route";
import { getAdminLeadSlaSnapshot, getAdminOrphanedVoiceSessions } from "@/lib/server/convex";
import { sendOpsAlert } from "@/lib/server/ops-alerts";

vi.mock("@/lib/server/convex", () => ({ getAdminLeadSlaSnapshot: vi.fn(), getAdminOrphanedVoiceSessions: vi.fn() }));
vi.mock("@/lib/server/ops-alerts", () => ({ sendOpsAlert: vi.fn() }));

const originalEnv = process.env;
const snapshotMock = vi.mocked(getAdminLeadSlaSnapshot);
const orphanMock = vi.mocked(getAdminOrphanedVoiceSessions);
const alertMock = vi.mocked(sendOpsAlert);

function orphanSweep(count = 0, truncated = false) {
  return {
    ok: true as const,
    data: { generatedAt: now, orphaned: { count, truncated, rows: [] } },
  } as Awaited<ReturnType<typeof getAdminOrphanedVoiceSessions>>;
}

const HOUR = 60 * 60 * 1000;
const now = 1_800_000_000_000;

function snapshot(input?: {
  active?: number;
  activeTruncated?: boolean;
  unowned?: number;
  unownedTruncated?: boolean;
  failed?: number;
  failedTruncated?: boolean;
  oldestCreatedAt?: number;
}) {
  return {
    ok: true as const,
    data: {
      generatedAt: now,
      activeLeads: { count: input?.active ?? 0, truncated: input?.activeTruncated ?? false },
      unownedBreaches: {
        count: input?.unowned ?? 0,
        truncated: input?.unownedTruncated ?? false,
        ...(input?.oldestCreatedAt === undefined ? {} : { oldestCreatedAt: input.oldestCreatedAt }),
      },
      failedNotifications: { count: input?.failed ?? 0, truncated: input?.failedTruncated ?? false },
    },
  } as Awaited<ReturnType<typeof getAdminLeadSlaSnapshot>>;
}

describe("admin SLA check route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
      OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789",
    };
    alertMock.mockResolvedValue({ ok: true, transport: "slack_bot" });
    orphanMock.mockResolvedValue(orphanSweep(0));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("stays quiet when every active lead is owned within the window", async () => {
    snapshotMock.mockResolvedValue(snapshot({ active: 2 }));

    const response = await POST(slaRequest({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      unownedBreaches: 0,
      activeLeads: 2,
      truncated: { activeLeads: false, unownedBreaches: false, failedNotifications: false },
      alerted: false,
    });
    expect(snapshotMock).toHaveBeenCalledWith(4 * HOUR);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("alerts on indexed SLA lower bounds without presenting truncated counts as exact", async () => {
    snapshotMock.mockResolvedValue(
      snapshot({
        active: 250,
        activeTruncated: true,
        unowned: 250,
        unownedTruncated: true,
        failed: 1,
        oldestCreatedAt: now - 26 * HOUR,
      }),
    );

    const response = await POST(slaRequest({ maxUnownedHours: 4 }));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      unownedBreaches: 250,
      failedNotifications: 1,
      truncated: { activeLeads: true, unownedBreaches: true, failedNotifications: false },
      alerted: true,
    });
    expect(alertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "lead_sla_breach",
        severity: "error",
        summary: expect.stringContaining("250+ lead(s) unowned"),
        meta: expect.objectContaining({ unowned: 250, unownedCountIsLowerBound: true, oldestUnownedHours: 26 }),
      }),
    );
  });

  it("alerts on orphaned voice sessions even when leads are all healthy", async () => {
    snapshotMock.mockResolvedValue(snapshot({ active: 3 }));
    orphanMock.mockResolvedValue(orphanSweep(2));

    const response = await POST(slaRequest({}));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      unownedBreaches: 0,
      orphanedVoiceSessions: 2,
      alerted: true,
    });
    expect(orphanMock).toHaveBeenCalledWith(30 * 60 * 1000);
    expect(alertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("2 voice session(s) dropped without a close snapshot"),
        meta: expect.objectContaining({ orphanedVoiceSessions: 2 }),
      }),
    );
  });

  it("still reports lead SLA when the orphan sweep is unavailable", async () => {
    snapshotMock.mockResolvedValue(snapshot({ active: 1 }));
    orphanMock.mockRejectedValue(new Error("convex down"));

    const response = await POST(slaRequest({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeLeads: 1,
      orphanedVoiceSessions: 0,
      alerted: false,
    });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("rejects interactive review credentials because the sweep can post to Slack", async () => {
    const response = await POST(slaRequest({}, "admin-review-token-123456789"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "forbidden" });
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("requires admin auth", async () => {
    const response = await POST(new Request("http://localhost/api/admin/sla-check", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(snapshotMock).not.toHaveBeenCalled();
  });
});

function slaRequest(body: Record<string, unknown>, token = "ops-automation-token-123456789") {
  return new Request("http://localhost/api/admin/sla-check", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
