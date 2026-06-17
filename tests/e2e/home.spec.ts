import { expect, test } from "@playwright/test";

test("renders the Oriental microsite and opens the collaborative intake workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Reimagining/i })).toBeVisible();
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Handoff details")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await page.getByRole("button", { name: "The spaces" }).click();
  await expect(page.getByText("Oriental note")).toBeVisible();
});

test("mobile menu opens sections and closes after navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile section menu" })).toBeVisible();

  await page.getByRole("link", { name: "Spaces" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile section menu" })).toBeHidden();
  await expect(page.locator("#facilities")).toBeInViewport();
});

test("timeline responds to keyboard focus", async ({ page }) => {
  await page.goto("/#timeline");
  await page.getByRole("button", { name: /Renovation and Early Activation/i }).focus();
  await expect(page.locator(".timeline")).toHaveAttribute("data-progress", "3");
});

test("lead form prevents duplicate posts while submission is pending", async ({ page }) => {
  let leadRequests = 0;
  let releaseLead: (() => void) | undefined;
  const leadGate = new Promise<void>((resolve) => {
    releaseLead = resolve;
  });

  await page.route("**/api/leads", async (route) => {
    leadRequests += 1;
    await leadGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "lead_test",
        persisted: false,
        notifications: {
          email: { ok: false, skipped: true },
          slack: { ok: false, skipped: true },
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await page.getByLabel("Name").fill("Asha");
  await page.getByLabel("Email").fill("asha@example.com");
  await page.getByLabel("Organisation").fill("Future Lab");
  await page.getByLabel("What would you bring to Oriental?").fill("We want to run AI literacy demos.");

  await page.getByRole("button", { name: "Send complete handoff" }).first().dblclick();
  await expect.poll(() => leadRequests).toBe(1);

  releaseLead?.();
  await expect(page.getByRole("heading", { name: /Sent to/i })).toBeVisible();
});

test("lead form submits the latest typed handoff values", async ({ page }) => {
  let submittedBody: unknown;

  await page.route("**/api/leads", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        id: "lead_latest_values",
        persisted: false,
        notifications: {
          email: { ok: false, skipped: true },
          slack: { ok: false, skipped: true },
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await page.getByLabel("Name").fill("Mei Ling");
  await page.getByLabel("Email").fill("mei@example.com");
  await page.getByLabel("Organisation").fill("Fresh Typed Org");
  await page.getByLabel("What would you bring to Oriental?").fill("A last-moment typed brief for the handoff.");
  await page.getByRole("button", { name: "Send complete handoff" }).click();

  await expect(page.getByRole("heading", { name: /Sent to/i })).toBeVisible();
  expect(submittedBody).toMatchObject({
    source: "form",
    form: {
      name: "Mei Ling",
      email: "mei@example.com",
      org: "Fresh Typed Org",
      message: "A last-moment typed brief for the handoff.",
    },
  });
});

test("lead form surfaces a partial failure when the lead saves but notifications fail", async ({ page }) => {
  await page.route("**/api/leads", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "notification_failed",
        id: "lead_partial",
        persisted: true,
        notifications: {
          email: { ok: false, error: "smtp_down" },
          slack: { ok: false, error: "slack_http_error" },
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await page.getByLabel("Name").fill("Asha");
  await page.getByLabel("Email").fill("asha@example.com");
  await page.getByLabel("Organisation").fill("Future Lab");
  await page.getByLabel("What would you bring to Oriental?").fill("We want to run AI literacy demos.");
  await page.getByRole("button", { name: "Send complete handoff" }).click();

  await expect(page.getByText("Saved, but notifications need attention.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Asha");
});

test("voice variant picker stays hidden unless the QA flag is served", async ({ page }) => {
  // Default config (no flag): the floating QA picker must not render for visitors.
  await page.route("**/api/client-config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ turnstileSiteKey: null, voiceVariantPicker: false }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: /Voice variant picker/i })).toHaveCount(0);
});

test("voice variant picker appears and switches voice when flagged on", async ({ page }) => {
  await page.route("**/api/client-config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ turnstileSiteKey: null, voiceVariantPicker: true }),
    });
  });
  await page.goto("/");
  const picker = page.getByRole("region", { name: /Voice variant picker/i });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Reka · Warm/i }).click();
  await expect(picker.getByRole("button", { name: /Reka · Warm/i })).toHaveAttribute("aria-pressed", "true");
});
