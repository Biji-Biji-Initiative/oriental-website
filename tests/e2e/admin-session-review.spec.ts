import { expect, test } from "@playwright/test";
import { adminCookieName, createAdminSessionCookie } from "../../lib/server/admin-auth";

const adminPassword = process.env.E2E_ADMIN_SHARED_PASSWORD ?? process.env.ADMIN_REVIEW_TOKEN;

test.describe("admin session review console", () => {
  test.beforeEach(async ({ context, page }) => {
    const password = adminPassword;
    test.skip(!password, "Set ADMIN_REVIEW_TOKEN or E2E_ADMIN_SHARED_PASSWORD to run admin E2E.");
    await context.addCookies([
      {
        expires: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        httpOnly: true,
        name: adminCookieName,
        sameSite: "Lax",
        secure: false,
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
        value: createAdminSessionCookie(),
      },
    ]);
    await page.goto("/admin/session-review");

    await expect(page.getByRole("heading", { name: "Oriental intake cockpit" })).toBeVisible();
  });

  test("shows the newest enquiries and explains interaction evaluations on the default view", async ({ page }) => {
    const latest = page.locator("#latest-enquiries");
    await expect(latest.getByRole("heading", { name: "Latest enquiries" })).toBeVisible();
    await expect(latest.getByText("What they want").first()).toBeVisible();
    await expect(latest.locator("article").first()).toHaveAttribute("data-lead-id", "lead-closed-3");

    const voiceEnquiry = latest.locator('[data-lead-id="lead-critical-1"]');
    await expect(voiceEnquiry.getByText("Aisha Rahman")).toBeVisible();
    await expect(voiceEnquiry.getByText("We want a technology partnership", { exact: false })).toBeVisible();
    await expect(voiceEnquiry.getByText("Routing", { exact: true })).toBeVisible();
    await expect(voiceEnquiry.locator('[data-eval-dimension="routing"]').getByText("4/5")).toBeVisible();
    await expect(voiceEnquiry.getByText("Capture", { exact: true })).toBeVisible();
    await expect(voiceEnquiry.locator('[data-eval-dimension="capture"]').getByText("5/5")).toBeVisible();
    await expect(voiceEnquiry.getByText("Quality", { exact: true })).toBeVisible();
    await expect(voiceEnquiry.locator('[data-eval-dimension="quality"]').getByText("2/5")).toBeVisible();
    await expect(voiceEnquiry.getByText("Frustration", { exact: true })).toBeVisible();
    await expect(voiceEnquiry.getByText(/lower is better for frustration/i)).toBeVisible();
    await expect(voiceEnquiry.getByRole("link", { name: "aisha@example.test" })).toHaveAttribute(
      "href",
      "mailto:aisha%40example.test",
    );

    const formEnquiry = latest.locator('[data-lead-id="lead-priority-2"]');
    await expect(formEnquiry.getByText("Evaluation not applicable")).toBeVisible();
  });

  test("renders the operator queues without horizontal overflow", async ({ page }) => {
    await page.goto("/admin/session-review?view=all");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByText("Next best action")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Find a handoff" })).toBeVisible();
    await expect(page.getByText("Lead action queue")).toBeVisible();
    await expect(page.getByText("Recoverable voice leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Notification recovery", { exact: true })).toBeVisible();
    await expect(page.getByText("Aisha Rahman").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("filters queue rows from URL search params", async ({ page }) => {
    await page.goto("/admin/session-review?view=leads&q=Aisha&source=voice#work-queues");

    await expect(page.getByText("Filtered queue view")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lead action queue" })).toBeVisible();
    await expect(page.getByText("Aisha Rahman").first()).toBeVisible();
    await expect(page.getByText("Bonobo").first()).toBeHidden();
  });

  test("keeps deep diagnostics collapsed until requested", async ({ page }) => {
    await page.goto("/admin/session-review?view=all");
    const diagnostics = page.locator("#voice-diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(page.getByText("Realtime snapshots for QA")).toBeHidden();

    await diagnostics.locator(":scope > summary").click();

    await expect(page.getByText("Realtime snapshots for QA")).toBeVisible();
    await expect(page.getByText("Review first")).toBeVisible();
    await expect(page.locator("#voice-voice-critical-1")).toBeVisible();
  });

  test("labels Realtime first-output timing without claiming speaker playback latency", async ({ page }) => {
    await page.goto("/admin/session-review?view=all");
    const diagnostics = page.locator("#voice-diagnostics");
    await diagnostics.locator(":scope > summary").click();

    const session = page.locator("#voice-voice-critical-1");
    await session.locator(":scope > summary").click();

    await expect(session.getByText("Conversation latency")).toBeVisible();
    await expect(session.getByText("420ms").first()).toBeVisible();
    await expect(session.getByText(/does not prove physical speaker output/i)).toBeVisible();
  });

  test("shows exact tap-to-live timing separately from the local arm cue", async ({ page }) => {
    await page.goto("/admin/session-review?view=all");
    const diagnostics = page.locator("#voice-diagnostics");
    await diagnostics.locator(":scope > summary").click();

    await expect(page.getByText("Tap to live p50/p95: 480ms / 480ms")).toBeVisible();
    await expect(page.getByText("Arm cue scheduling p95: 4ms")).toBeVisible();
  });

  test("submits a workflow update from a collapsed lead card", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Workflow mutation smoke runs once on desktop.");
    let sawWorkflowUpdate = false;
    await page.route("**/api/admin/leads/lead-critical-1", async (route) => {
      expect(route.request().method()).toBe("PATCH");
      const payload = route.request().postDataJSON() as {
        note: string;
        owner: string;
        priority: string;
        status: string;
      };
      expect(payload.owner).toBe("Gurpreet");
      expect(payload.priority).toBe("urgent");
      expect(payload.status).toBe("reviewing");
      expect(payload.note).toContain("Called");
      sawWorkflowUpdate = true;
      await route.fulfill({ contentType: "application/json", json: { ok: true } });
    });

    await page.goto("/admin/session-review?view=leads");
    const card = page.locator("#lead-lead-critical-1");
    await page.waitForLoadState("networkidle");
    await card.locator("details", { hasText: "Update workflow" }).locator("summary").click();
    await page.waitForTimeout(1000);
    const form = card.locator("form").first();
    const owner = form.getByLabel("Owner");
    await owner.fill("Gurpreet");
    await expect(owner).toHaveValue("Gurpreet");
    await form.getByLabel("Status").selectOption("reviewing");
    await form.getByPlaceholder("Add a short handoff note or next action").fill("Called and assigned follow-up.");
    await form.getByRole("button", { name: /save workflow/i }).click();

    await expect.poll(() => sawWorkflowUpdate).toBe(true);
  });
});
