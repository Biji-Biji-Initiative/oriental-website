import { expect, test } from "@playwright/test";

const adminPassword = process.env.E2E_ADMIN_SHARED_PASSWORD ?? process.env.ADMIN_REVIEW_TOKEN;

test.describe("admin session review console", () => {
  test.beforeEach(async ({ page }) => {
    const password = adminPassword;
    test.skip(!password, "Set ADMIN_REVIEW_TOKEN or E2E_ADMIN_SHARED_PASSWORD to run admin E2E.");
    const token = password ?? "";
    const login = await page.request.post("/api/admin/login", { data: { token } });
    expect(login.ok()).toBe(true);
    await page.goto("/admin/session-review");

    await expect(page.getByRole("heading", { name: "Operations console" })).toBeVisible();
  });

  test("renders the operator queues without horizontal overflow", async ({ page }) => {
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByText("Next best action")).toBeVisible();
    await expect(page.getByText("Lead action queue")).toBeVisible();
    await expect(page.getByText("Recoverable voice leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Notification recovery", { exact: true })).toBeVisible();
    await expect(page.getByText("Aisha Rahman").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps deep diagnostics collapsed until requested", async ({ page }) => {
    const diagnostics = page.locator("#voice-diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(page.getByText("Realtime snapshots for QA")).toBeHidden();

    await diagnostics.locator(":scope > summary").click();

    await expect(page.getByText("Realtime snapshots for QA")).toBeVisible();
    await expect(page.getByText("Review first")).toBeVisible();
    await expect(page.locator("#voice-voice-critical-1")).toBeVisible();
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
