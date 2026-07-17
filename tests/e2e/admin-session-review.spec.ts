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
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3011",
        value: createAdminSessionCookie(),
      },
    ]);
    await page.goto("/admin/session-review");

    await expect(page.getByRole("heading", { name: "Enquiry CRM" })).toBeVisible();
  });

  test("turns the default overview into an executive enquiry command center", async ({ page }, testInfo) => {
    const command = page.locator("[data-command-center]");
    await expect(
      command.getByRole("heading", { name: "2 open enquiries need a clear owner and outcome." }),
    ).toBeVisible();
    await expect(command.getByText("Do this next", { exact: true })).toBeVisible();
    await expect(command.getByRole("link", { name: "Open highest-priority record" })).toBeVisible();

    const kpis = command.locator("[data-command-kpis]");
    await expect(kpis.getByText("Open pipeline", { exact: true })).toBeVisible();
    await expect(kpis.getByText("Assignment", { exact: true })).toBeVisible();
    await expect(kpis.getByText("Delivery health", { exact: true })).toBeVisible();
    await expect(kpis.getByText("Qualified", { exact: true })).toBeVisible();

    const queue = command.locator("[data-command-action-queue]");
    await expect(queue.getByRole("heading", { name: "What needs attention now" })).toBeVisible();
    const desktop = testInfo.project.name !== "mobile";
    if (desktop) {
      await expect(queue.getByRole("columnheader", { name: "Customer" })).toBeVisible();
      await expect(queue.locator('tr[data-lead-id="lead-critical-1"]')).toBeVisible();
    } else {
      await expect(queue.getByRole("table")).toBeHidden();
      await expect(queue.locator('article[data-lead-id="lead-critical-1"]')).toBeVisible();
    }

    await expect(command.getByRole("heading", { name: "Can the team act without guessing?" })).toBeVisible();
    await expect(command.getByRole("heading", { name: "Accounts, people, and repeat demand" })).toBeVisible();
    await expect(command.getByRole("heading", { name: "Where demand comes from" })).toBeVisible();
    await expect(command.getByRole("heading", { name: "Conversation quality and recoverable demand" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("opens the highest-priority enquiry from the executive action", async ({ page }) => {
    await page.getByRole("link", { name: "Open highest-priority record" }).click();
    await expect(page).toHaveURL(/view=leads.*lead=lead-critical-1.*#crm-record/);
    await expect(page.locator("#crm-record").getByRole("heading", { name: "Aisha Rahman" })).toBeVisible();
  });

  test("shows a CRM table and a complete interaction record on the enquiries view", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=leads");
    const table = page.locator("[data-crm-table]");
    await expect(page.getByRole("heading", { name: "Enquiry pipeline" })).toBeVisible();
    const desktop = testInfo.project.name !== "mobile";
    if (desktop) {
      await expect(table.getByRole("columnheader", { name: "Contact" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Request" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Pipeline" })).toBeVisible();
      await expect(table.locator("tbody tr").first()).toHaveAttribute("data-lead-id", "lead-closed-3");
    } else {
      await expect(table).toBeHidden();
      await expect(page.locator('article[data-lead-id="lead-closed-3"]')).toBeVisible();
    }

    const voiceRow = page.locator(`${desktop ? "tr" : "article"}[data-lead-id="lead-critical-1"]`);
    await expect(voiceRow.getByText("Aisha Rahman")).toBeVisible();
    await expect(voiceRow.getByText("We want a technology partnership", { exact: false })).toBeVisible();
    await voiceRow
      .getByRole("link", { name: desktop ? "Open Aisha Rahman enquiry record" : "Open CRM record" })
      .click();

    const record = page.locator("#crm-record");
    await expect(record.getByRole("heading", { name: "Aisha Rahman" })).toBeVisible();
    await expect(record.getByText("What they want")).toBeVisible();
    await expect(record.getByText("aisha@example.test")).toBeVisible();
    await expect(record.locator('[data-eval-dimension="routing"]').getByText("4/5")).toBeVisible();
    await expect(record.locator('[data-eval-dimension="capture"]').getByText("5/5")).toBeVisible();
    await expect(record.locator('[data-eval-dimension="quality"]').getByText("2/5")).toBeVisible();
    await expect(record.getByText("Frustration", { exact: true })).toBeVisible();
    await expect(record.getByText(/lower is better for frustration/i)).toBeVisible();
    await expect(record.getByText("ClickUp failed", { exact: true }).first()).toBeVisible();
    const accountHistory = record.locator("#related-enquiries");
    await expect(accountHistory.getByText("2 account enquiries")).toBeVisible();
    await expect(accountHistory.getByText("Daniel Lim")).toBeVisible();
  });

  test("shows account portfolio and owner workload as CRM tables", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=leads");
    await expect(page.getByRole("heading", { name: "Account portfolio & ownership" })).toBeVisible();
    await expect(page.getByText("1 account", { exact: true })).toBeVisible();
    const multiEnquiry = page.getByText("Multi-enquiry", { exact: true }).locator("..");
    await expect(multiEnquiry.getByText("1", { exact: true })).toBeVisible();

    if (testInfo.project.name !== "mobile") {
      const accounts = page.locator("[data-account-table]");
      await expect(accounts.getByRole("columnheader", { name: "Organization" })).toBeVisible();
      await expect(accounts.getByRole("row").filter({ hasText: "Impact Robotics Lab" })).toContainText("2");
      const owners = page.locator("[data-owner-table]");
      await expect(owners.getByRole("columnheader", { name: "Owner" })).toBeVisible();
      await expect(owners.getByRole("row").filter({ hasText: "Unassigned" })).toBeVisible();
    }
  });

  test("sorts the queue by operator attention when requested", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=leads&sort=attention#crm-workspace");
    await expect(page.getByLabel("Sort")).toHaveValue("attention");
    if (testInfo.project.name === "mobile") {
      await expect(page.locator('article[data-lead-id="lead-critical-1"]')).toBeVisible();
    } else {
      await expect(page.locator("[data-crm-table] tbody tr").first()).toHaveAttribute(
        "data-lead-id",
        "lead-critical-1",
      );
    }
  });

  test("opens the exact ClickUp task from a synced CRM record", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=leads&lead=lead-priority-2#crm-record");
    const record = page.locator("#crm-record");
    const links = record.getByRole("link", { name: "Open ClickUp task" });
    await expect(links.first()).toHaveAttribute("href", "https://app.clickup.com/t/task_impact_2");
    if (testInfo.project.name !== "mobile") await expect(links.first()).toBeVisible();
  });

  test("renders the operator queues without horizontal overflow", async ({ page }) => {
    await page.goto("/admin/session-review?view=all");
    await expect(page.getByRole("heading", { name: "Search enquiries" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enquiry pipeline" })).toBeVisible();
    await expect(page.getByText("CRM data")).toBeVisible();
    await expect(page.getByText("Aisha Rahman").filter({ visible: true }).first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("filters queue rows from URL search params", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=leads&q=Aisha&source=voice#crm-workspace");

    await expect(page.getByText("Filtered queue view")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enquiry pipeline" })).toBeVisible();
    const filteredRow = page.locator(
      `${testInfo.project.name === "mobile" ? "article" : "tr"}[data-lead-id="lead-critical-1"]`,
    );
    await expect(filteredRow.getByText("Aisha Rahman")).toBeVisible();
    await expect(page.locator("[data-crm-table] tbody tr")).toHaveCount(1);
    const excludedQueueRow = page.locator(
      `${testInfo.project.name === "mobile" ? "article" : "tr"}[data-lead-id="lead-priority-2"]`,
    );
    await expect(excludedQueueRow).toBeHidden();
  });

  test("explains Reka evaluation scores in an operator-facing register", async ({ page }, testInfo) => {
    await page.goto("/admin/session-review?view=reka#reka-quality");

    await expect(page.getByRole("heading", { name: "Reka evaluations" })).toBeVisible();
    await expect(page.getByText("1 of 2 saved voice sessions")).toBeVisible();
    await expect(page.getByText(/higher is better except frustration/i)).toBeVisible();
    await expect(page.getByText("1 = smooth · 5 = severe visitor friction")).toBeVisible();

    const evaluation =
      testInfo.project.name === "mobile"
        ? page.locator("#reka-quality article").filter({ hasText: "Aisha Rahman" })
        : page.locator("[data-eval-table] tbody tr").filter({ hasText: "Aisha Rahman" });
    await expect(evaluation).toBeVisible();
    await expect(evaluation.getByText("4/5").first()).toBeVisible();
    await expect(evaluation.getByText("5/5")).toBeVisible();
    await expect(evaluation.getByText("2/5")).toBeVisible();
    await expect(evaluation.getByRole("link", { name: "Open CRM record" })).toBeVisible();
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

  test("submits a workflow update from the CRM record", async ({ page }, testInfo) => {
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

    await page.goto("/admin/session-review?view=leads&lead=lead-critical-1#crm-record");
    const card = page.locator("#crm-record");
    await page.waitForLoadState("networkidle");
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
