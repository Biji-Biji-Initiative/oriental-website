import { createHmac } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionReviewPage from "@/app/admin/session-review/page";
import { GET as getMetrics } from "@/app/api/admin/metrics/route";
import { GET as getRawReview } from "@/app/api/admin/review/route";
import { adminCookieName, createAdminLoginSession, verifyAdminLoginCredential } from "@/lib/server/admin-auth";
import adminDashboardFixture from "@/tests/fixtures/admin-dashboard.critical.json";

const convex = vi.hoisted(() => ({
  getAdminAggregateMetrics: vi.fn(),
  getAdminApplicationLogs: vi.fn(),
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

describe("full-access admin password dashboard", () => {
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
    convex.getAdminApplicationLogs.mockReset();
    convex.getAdminLeadTable.mockReset();
    convex.getAdminReviewDashboard.mockReset();
    convex.getAdminAggregateMetrics.mockResolvedValue({
      ok: true,
      data: {
        generatedAt: Date.now(),
        metrics,
      },
    });
    convex.getAdminLeadTable.mockRejectedValue(new Error("lead-table fallback fixture"));
    convex.getAdminApplicationLogs.mockResolvedValue({ ok: true, logs: [] });
    convex.getAdminReviewDashboard.mockResolvedValue({
      ok: true,
      data: adminDashboardFixture,
    });
  });

  afterEach(() => {
    cleanup();
    process.env = originalEnv;
  });

  it("renders customer records and exposes admin mutation controls", async () => {
    render(await SessionReviewPage({ searchParams: Promise.resolve({ view: "leads" }) }));

    expect(screen.getByRole("heading", { name: "Enquiry pipeline" })).toBeVisible();
    expect(screen.getAllByText("Aisha Rahman").length).toBeGreaterThan(0);
    expect(screen.getAllByText("aisha@example.test").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Aggregate overview" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-admin-workflow-form]")).not.toBeNull();
    expect(screen.getByLabelText("Select all visible enquiries")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Actions for/u }).length).toBeGreaterThan(0);
    expect(convex.getAdminAggregateMetrics).not.toHaveBeenCalled();
    expect(convex.getAdminLeadTable).toHaveBeenCalledTimes(1);
    expect(convex.getAdminReviewDashboard).toHaveBeenCalledTimes(1);
  });

  it("allows aggregate compatibility and raw review reads for the same password session", async () => {
    const headers = { cookie: `${adminCookieName}=${nextHeaders.cookieValue}` };
    const aggregate = await getMetrics(new Request("http://localhost/api/admin/metrics", { headers }), undefined);
    expect(aggregate.status).toBe(200);
    await expect(aggregate.json()).resolves.toEqual({ ok: true, metrics });

    const raw = await getRawReview(new Request("http://localhost/api/admin/review", { headers }), undefined);
    expect(raw.status).toBe(200);
    const body = (await raw.json()) as {
      ok: boolean;
      leads: Array<{ email: string; leadId: string }>;
      voiceSessions: Array<{ reviewId: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.leads).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: "aisha@example.test", leadId: "lead-critical-1" })]),
    );
    expect(body.voiceSessions.length).toBeGreaterThan(0);
  });
});
