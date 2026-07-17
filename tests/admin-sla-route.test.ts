import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/sla-check/route";
import { getAdminReviewDashboard } from "@/lib/server/convex";
import { sendOpsAlert } from "@/lib/server/ops-alerts";

vi.mock("@/lib/server/convex", () => ({ getAdminReviewDashboard: vi.fn() }));
vi.mock("@/lib/server/ops-alerts", () => ({ sendOpsAlert: vi.fn() }));

const originalEnv = process.env;
const dashboardMock = vi.mocked(getAdminReviewDashboard);
const alertMock = vi.mocked(sendOpsAlert);

const HOUR = 60 * 60 * 1000;
const now = 1_800_000_000_000;

function dashboard(leads: Array<Record<string, unknown>>, failedNotifications = 0) {
  return {
    ok: true as const,
    data: {
      generatedAt: now,
      leads,
      queues: { failedNotifications: Array.from({ length: failedNotifications }, (_, i) => ({ leadId: `f${i}` })) },
    },
  } as unknown as Awaited<ReturnType<typeof getAdminReviewDashboard>>;
}

describe("admin SLA check route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "viewer",
    };
    alertMock.mockResolvedValue({ ok: true, transport: "slack_bot" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("stays quiet when every active lead is owned within the window", async () => {
    dashboardMock.mockResolvedValue(
      dashboard([
        { leadId: "a", status: "new", owner: "Chewi", createdAt: now - 30 * HOUR },
        { leadId: "b", status: "new", owner: "", createdAt: now - 1 * HOUR },
        { leadId: "c", status: "archived", owner: "", createdAt: now - 90 * HOUR },
      ]),
    );

    const response = await POST(slaRequest({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, unownedBreaches: 0, alerted: false });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("alerts on unowned leads beyond the window and failed notifications", async () => {
    dashboardMock.mockResolvedValue(
      dashboard(
        [
          { leadId: "a", status: "new", owner: "", createdAt: now - 6 * HOUR },
          { leadId: "b", status: "reviewing", owner: " ", createdAt: now - 26 * HOUR },
        ],
        1,
      ),
    );

    const response = await POST(slaRequest({ maxUnownedHours: 4 }));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      unownedBreaches: 2,
      failedNotifications: 1,
      alerted: true,
    });
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({ event: "lead_sla_breach", severity: "error" }));
  });

  it("requires admin auth", async () => {
    const response = await POST(new Request("http://localhost/api/admin/sla-check", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(dashboardMock).not.toHaveBeenCalled();
  });
});

function slaRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/sla-check", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-review-token-123456789",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
