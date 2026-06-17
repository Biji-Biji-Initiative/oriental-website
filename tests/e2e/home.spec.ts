import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/voice/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        client_secret: { value: "e2e-client-secret", expires_at: Math.floor(Date.now() / 1000) + 300 },
        session_id: "sess_e2e",
        review: {
          id: "5a8c25b1-cd50-4e47-89bf-84947c805add",
          token: "review-token-that-is-long-enough-for-e2e",
        },
        model: "gpt-realtime-2",
        voice: "marin",
        speed: 1.22,
        variant: "kl-polished",
        limits: { max_duration_ms: 240000, idle_timeout_ms: 45000 },
      }),
    });
  });
});

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

test("voice variant picker appears, switches voice, and persists the selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Choose Reka voice/i }).click();
  const picker = page.getByRole("region", { name: /Choose Reka voice/i });
  await expect(picker).toBeVisible();
  const warmButton = picker.getByRole("button", { name: /^Warm\b/ });
  await warmButton.click();
  await expect(page.getByRole("button", { name: /Current voice: Reka · Warm/i })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        stored: window.localStorage.getItem("oriental.voiceVariant"),
        cookie: document.cookie,
      })),
    )
    .toMatchObject({ stored: "malay-warm", cookie: expect.stringContaining("oriental_voice_variant=malay-warm") });
});

test("voice prewarms on page load without Turnstile and with the selected variant", async ({ page }) => {
  const voiceSessionBodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/session")) {
      voiceSessionBodies.push(request.postDataJSON());
    }
  });

  await page.goto("/");

  await expect.poll(() => voiceSessionBodies.length).toBeGreaterThan(0);
  expect(voiceSessionBodies[0]).toMatchObject({ intent: "other", variant: "kl-polished" });
  expect(JSON.stringify(voiceSessionBodies[0])).not.toContain("turnstile");
});

test("talk CTA immediately enters the voice permission flow", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __voiceGetUserMediaCalled?: boolean };
    state.__voiceGetUserMediaCalled = false;
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: async (descriptor: PermissionDescriptor) =>
          ({ state: descriptor.name === "microphone" ? "prompt" : "granted" }) as PermissionStatus,
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          state.__voiceGetUserMediaCalled = true;
          throw new DOMException("Microphone denied in e2e", "NotAllowedError");
        },
      },
    });
  });

  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __voiceGetUserMediaCalled?: boolean }).__voiceGetUserMediaCalled,
      ),
    )
    .toBe(true);
  await expect(page.getByText(/Microphone access is blocked/i)).toBeVisible();
});
