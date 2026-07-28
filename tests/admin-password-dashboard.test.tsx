import { createHmac } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionReviewPage from "@/app/admin/session-review/page";
import { GET as getMetrics } from "@/app/api/admin/metrics/route";
import { GET as getRawReview } from "@/app/api/admin/review/route";
import { adminCookieName, createAdminLoginSession, verifyAdminLoginCredential } from "@/lib/server/admin-auth";

const convex = vi.hoisted(() => ({
  getAdminAggregateMetrics: vi.fn(),
  getAdminLeadTable: vi.fn(),
  getAdminReviewDashboard: vi.fn(),
}));
const nextHeaders = vi.hoisted(() => ({
  cookieValue: "",
}));

vi.mock("@/lib/server/convex", () => convex);
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/session-review",
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === adminCookieName ? { value: nextHeaders.cookieValue } : undefined),
  })),
}));

const originalEnv = process.env;
const reviewToken = "admin-review-token-password-dashboard-test";
const password = "distinct-interactive-password";
const metrics = {
  activeLeads: 4,
  connectedSessions: 7,
  engagedSessions: 6,
  notificationDeliveryRate: 92,
  notificationFailures: 1,
  prewarmedSessions: 8,
  qualifiedLeads: 3,
  recentLeads: 12,
  reviewedSessions: 8,
  sessionsWithErrors: 2,
  submittedSessions: 5,
  urgentLeads: 1,
  voiceLeads: 6,
  voiceSubmitRate: 83,
};

describe("aggregate-only admin password dashboard", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ADMIN_REVIEW_ACTOR: "Password dashboard reviewer",
      ADMIN_REVIEW_PASSWORD_HMAC: createHmac("sha256", reviewToken)
        .update("oriental-admin-password:v1\0")
        .update(password)
        .digest("hex"),
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_TOKEN: reviewToken,
      NODE_ENV: "test",
    };
    const login = verifyAdminLoginCredential(password);
    if (!login.ok) throw new Error(`Test password login failed: ${login.reason}`);
    nextHeaders.cookieValue = createAdminLoginSession(login, Date.now()).cookie;
    convex.getAdminAggregateMetrics.mockReset();
    convex.getAdminLeadTable.mockReset();
    convex.getAdminReviewDashboard.mockReset();
    convex.getAdminAggregateMetrics.mockResolvedValue({
      ok: true,
      data: {
        generatedAt: Date.now(),
        metrics,
      },
    });
    convex.getAdminLeadTable.mockRejectedValue(new Error("password path touched raw lead table"));
    convex.getAdminReviewDashboard.mockRejectedValue(new Error("password path touched broad dashboard"));
  });

  afterEach(() => {
    cleanup();
    process.env = originalEnv;
  });

  it("renders only aggregate totals and never fetches the raw lead table", async () => {
    render(await SessionReviewPage({}));

    expect(screen.getByRole("heading", { name: "Aggregate overview" })).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.queryByText("must-never-render")).not.toBeInTheDocument();
    expect(screen.queryByText("What needs attention now")).not.toBeInTheDocument();
    expect(convex.getAdminAggregateMetrics).toHaveBeenCalledTimes(1);
    expect(convex.getAdminLeadTable).not.toHaveBeenCalled();
    expect(convex.getAdminReviewDashboard).not.toHaveBeenCalled();
  });

  it("allows the aggregate API but forbids raw review data for the same password session", async () => {
    const headers = { cookie: `${adminCookieName}=${nextHeaders.cookieValue}` };
    const aggregate = await getMetrics(new Request("http://localhost/api/admin/metrics", { headers }), undefined);
    expect(aggregate.status).toBe(200);
    await expect(aggregate.json()).resolves.toEqual({ ok: true, metrics });
    expect(convex.getAdminAggregateMetrics).toHaveBeenCalledTimes(1);
    expect(convex.getAdminLeadTable).not.toHaveBeenCalled();
    expect(convex.getAdminReviewDashboard).not.toHaveBeenCalled();

    const raw = await getRawReview(new Request("http://localhost/api/admin/review", { headers }), undefined);
    expect(raw.status).toBe(403);
    await expect(raw.json()).resolves.toEqual({ ok: false, error: "forbidden" });
  });
});
