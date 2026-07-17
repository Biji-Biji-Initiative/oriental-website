import { expect, type Page, test } from "@playwright/test";

function visibleDialogEmail(page: Page) {
  return page.getByRole("dialog").locator('input[type="email"]:visible');
}

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

test("entrance brand motion never blocks immediate public interaction", async ({ page }) => {
  await page.goto("/");
  const loader = page.locator(".brand-site-loader");
  await expect(loader).toBeVisible();
  await expect(loader).toHaveCSS("pointer-events", "none");
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).not.toBe("hidden");
  await page.locator('header button[aria-label="Talk to Mereka"]').click({ timeout: 700 });
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("renders the Oriental microsite and opens the collaborative intake workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Reimagining/i })).toBeVisible();
  await expect(page.locator('header [data-mereka-mark="true"]')).toBeVisible();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".mereka-nebula")).toBeVisible();
  await expect(page.getByText("Send your enquiry", { exact: true })).toBeVisible();
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

test("hero fits the first viewport and leaves the next section visible", async ({ page }) => {
  const viewports = [
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Reimagining/i })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const hero = document.querySelector(".hero-section")?.getBoundingClientRect();
      const next = document.querySelector("#vision")?.getBoundingClientRect();
      return {
        heroBottom: Math.round(hero?.bottom ?? 0),
        nextTop: Math.round(next?.top ?? 0),
        viewportHeight: window.innerHeight,
        horizontalOverflow: Math.max(0, document.body.scrollWidth - document.documentElement.clientWidth),
      };
    });

    expect(metrics.horizontalOverflow).toBe(0);
    expect(metrics.heroBottom).toBeLessThanOrEqual(metrics.viewportHeight - 8);
    expect(metrics.nextTop).toBeLessThanOrEqual(metrics.viewportHeight - 8);
  }
});

test("faq page nav links point home and the talk CTA opens the form workspace", async ({ page, isMobile }) => {
  await page.goto("/faq");

  if (isMobile) {
    await page.getByRole("button", { name: "Open menu" }).click();
    const mobileNav = page.getByRole("navigation", { name: "Mobile section menu" });
    await expect(mobileNav.getByRole("link", { name: "Vision" })).toHaveAttribute("href", "/#vision");
    await expect(mobileNav.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/#timeline");
    await mobileNav.getByRole("button", { name: "Talk to Mereka" }).click();
  } else {
    await expect(page.locator("header").getByRole("link", { name: "Vision" })).toHaveAttribute("href", "/#vision");
    await expect(page.locator("header").getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/#timeline");
    await page.getByRole("button", { name: "Talk to Mereka" }).last().click();
  }
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(isMobile ? page.getByRole("dialog") : page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByText(/every-visit option to remember the mic/i)).toBeVisible();
  await expect(page.getByText(/One-time access will ask again later/i)).toBeVisible();
});

test("facilities use the current supplied space images and aligned labels", async ({ page }) => {
  await page.goto("/#facilities");

  await expect(page.getByRole("button", { name: /Public Commons & Community Lounge/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Academy of Tomorrow Learning Studios/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Flexible Event Spaces/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Technology Showcase & Demo Lab/i })).toBeVisible();

  const imageSources = await page
    .locator("#facilities img")
    .evaluateAll((images) =>
      images.map((image) =>
        decodeURIComponent((image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src),
      ),
    );

  expect(imageSources).toEqual(
    expect.arrayContaining([
      expect.stringContaining("/assets/spaces/public-commons-community-lounge"),
      expect.stringContaining("/assets/spaces/flexible-event-spaces-forum"),
      expect.stringContaining("/assets/spaces/technology-showcase-demo-lab"),
    ]),
  );
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
  await visibleDialogEmail(page).fill("asha@example.com");
  await page.getByLabel("Organisation").fill("Future Lab");
  await page.getByLabel("What would you build with Mereka?").fill("We want to run AI literacy demos.");

  await page.getByRole("button", { name: "Send enquiry" }).first().dblclick();
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
  await visibleDialogEmail(page).fill("mei@example.com");
  await page.getByLabel("Organisation").fill("Fresh Typed Org");
  await page.getByLabel("What would you build with Mereka?").fill("A last-moment typed brief for the handoff.");
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await expect(page.getByRole("heading", { name: /Sent to/i })).toBeVisible();
  expect(submittedBody).toMatchObject({
    source: "form",
    entryPoint: "hero_primary",
    entryMethod: "form",
    submissionMethod: "handoff_button",
    fieldProvenance: {
      name: { method: "form", lastInput: "form" },
      email: { method: "form", lastInput: "form" },
      org: { method: "form", lastInput: "form" },
      message: { method: "form", lastInput: "form" },
    },
    form: {
      name: "Mei Ling",
      email: "mei@example.com",
      org: "Fresh Typed Org",
      message: "A last-moment typed brief for the handoff.",
    },
  });
});

test("typed-only handoff edits survive closing and reopening the workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Tell us why/i }).click();
  await page.getByLabel("Name").fill("Nur Aina");
  await visibleDialogEmail(page).fill("aina@example.com");
  await page.getByLabel("Organisation").fill("Community Studio");
  await page.getByLabel("What would you build with Mereka?").fill("A typed-only circular design programme.");

  await page.locator('[data-slot="dialog-close"]').click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: /Tell us why/i }).click();

  await expect(page.getByLabel("Name")).toHaveValue("Nur Aina");
  await expect(visibleDialogEmail(page)).toHaveValue("aina@example.com");
  await expect(page.getByLabel("Organisation")).toHaveValue("Community Studio");
  await expect(page.getByLabel("What would you build with Mereka?")).toHaveValue(
    "A typed-only circular design programme.",
  );
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
  await visibleDialogEmail(page).fill("asha@example.com");
  await page.getByLabel("Organisation").fill("Future Lab");
  await page.getByLabel("What would you build with Mereka?").fill("We want to run AI literacy demos.");
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await expect(page.getByText("Saved, but notifications need attention.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Asha");
});

test("voice variant picker appears, switches voice, and persists the selection", async ({ page }) => {
  await page.goto("/?voices=1");
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

test("expanded staging voice picker stays reachable in a short landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?voices=1");
  await page.getByRole("button", { name: /Choose Reka voice/i }).click();

  const picker = page.getByRole("region", { name: /Choose Reka voice/i });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse voice picker" })).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      picker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }),
    )
    .toBe(true);
});

test("page-load voice warmup does not mint a session before microphone permission", async ({ page }) => {
  const voiceSessionBodies: unknown[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: async (descriptor: PermissionDescriptor) =>
          ({ state: descriptor.name === "microphone" ? "prompt" : "granted" }) as PermissionStatus,
      },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/session")) {
      voiceSessionBodies.push(request.postDataJSON());
    }
  });

  await page.goto("/");
  await page.waitForTimeout(1200);

  expect(voiceSessionBodies).toHaveLength(0);
});

test("voice prewarms on page load for returning microphone permission without Turnstile", async ({
  page,
  context,
  baseURL,
}) => {
  const voiceSessionBodies: unknown[] = [];
  await context.grantPermissions(["microphone"], { origin: baseURL ?? "http://localhost:3000" });
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

test("ending a consumed prewarm does not mint an unused replacement", async ({ page, context, baseURL }) => {
  let voiceSessionMints = 0;
  await context.grantPermissions(["microphone"], { origin: baseURL ?? "http://localhost:3000" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => new MediaStream(),
      },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/voice/session")) voiceSessionMints += 1;
  });
  await page.route("https://api.openai.com/v1/realtime/calls", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota" } }),
    });
  });

  await page.goto("/");
  await expect.poll(() => voiceSessionMints).toBe(1);
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  await page.getByRole("button", { name: "Start voice with Reka" }).click();
  await expect(page.getByText("Live voice is temporarily unavailable.")).toBeVisible();

  await page.waitForTimeout(750);
  expect(voiceSessionMints).toBe(1);
});

test("talk CTA opens the partner dialog without requesting the microphone", async ({ page, isMobile }) => {
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
  await expect(isMobile ? page.getByRole("dialog") : page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __voiceGetUserMediaCalled?: boolean }).__voiceGetUserMediaCalled,
      ),
    )
    .toBe(false);

  await page.getByRole("button", { name: "Start voice with Reka" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __voiceGetUserMediaCalled?: boolean }).__voiceGetUserMediaCalled,
      ),
    )
    .toBe(true);
  await expect(page.getByText(/Microphone access is blocked/i)).toBeVisible();
});

test("voice intake stays contained and resets scroll across short responsive viewports", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const viewports = [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 390 },
    { width: 1024, height: 600 },
    { width: 1024, height: 651 },
    { width: 1024, height: 675 },
    { width: 1024, height: 700 },
    { width: 1280, height: 651 },
    { width: 1280, height: 675 },
    { width: 1280, height: 720 },
    { width: 1440, height: 651 },
    { width: 1440, height: 690 },
    { width: 1440, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.locator('[data-slot="dialog-content"]').evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          const close = dialog.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.getBoundingClientRect();
          const layout = dialog.querySelector<HTMLElement>("[data-voice-dialog-layout]");
          const primaryAction = dialog.querySelector<HTMLElement>("[data-voice-primary-action]");
          const primaryRect = primaryAction?.getBoundingClientRect();
          const primaryScrollHost = window.innerWidth >= 1024 ? primaryAction?.closest<HTMLElement>("main") : layout;
          const primaryRegion = primaryScrollHost?.getBoundingClientRect();
          const compactThreePane =
            window.innerWidth < 1024 ||
            Boolean(
              layout &&
                layout.scrollHeight <= layout.clientHeight + 1 &&
                getComputedStyle(layout).gridTemplateColumns.split(" ").length === 3 &&
                [...layout.children].every(
                  (region) =>
                    getComputedStyle(region).overflowY === "auto" && region.clientHeight === layout.clientHeight,
                ),
            );
          return {
            dialogFits:
              rect.left >= -1 &&
              rect.top >= -1 &&
              rect.right <= window.innerWidth + 1 &&
              rect.bottom <= window.innerHeight + 1,
            closeFits: Boolean(
              close &&
                close.left >= rect.left &&
                close.top >= rect.top &&
                close.right <= rect.right &&
                close.bottom <= rect.bottom,
            ),
            compactThreePane,
            paneTopsAlign:
              window.innerWidth < 1024 ||
              Boolean(
                layout &&
                  [...layout.children].every(
                    (region) => Math.abs(region.getBoundingClientRect().top - layout.getBoundingClientRect().top) <= 1,
                  ),
              ),
            primaryActionInitiallyVisible: Boolean(
              primaryRect &&
                primaryRegion &&
                primaryScrollHost &&
                primaryScrollHost.scrollTop <= 1 &&
                primaryRect.top >= Math.max(rect.top, primaryRegion.top) - 1 &&
                primaryRect.bottom <= Math.min(rect.bottom, primaryRegion.bottom) + 1,
            ),
            noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          };
        }),
      )
      .toEqual({
        dialogFits: true,
        closeFits: true,
        compactThreePane: true,
        paneTopsAlign: true,
        primaryActionInitiallyVisible: true,
        noPageOverflow: true,
      });
    await expect(page.getByRole("button", { name: "Start voice with Reka" })).toBeInViewport({ ratio: 1 });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-voice-dialog-layout]").evaluate((layout) => {
    layout.scrollTop = layout.scrollHeight;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.locator("[data-voice-dialog-layout]").evaluate((layout) => layout.scrollTop)).toBe(0);
});

test("email correction stays beside voice controls across the 1024px breakpoint", async ({ page }) => {
  let leadPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/leads")) leadPosts += 1;
  });

  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1023, height: 600 },
    { width: 1024, height: 390 },
    { width: 1024, height: 600 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator('header button[aria-label="Talk to Mereka"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(150);
    await expect(dialog.locator('input[type="email"]:visible')).toHaveCount(1);
    if (viewport.width >= 1024) {
      await expect
        .poll(() =>
          dialog.evaluate((element) => {
            const email = element.querySelector<HTMLInputElement>('input[name="email"]');
            const name = element.querySelector<HTMLInputElement>('input[name="name"]');
            if (!email || !name) return false;
            return Boolean(email.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING);
          }),
        )
        .toBe(true);
    }

    const email = visibleDialogEmail(page);
    await email.focus();
    await email.fill("asha@example.com");

    await expect(email).toBeFocused();
    await expect(page.locator("[data-voice-primary-action]")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Send enquiry" })).toBeEnabled();
    await expect
      .poll(() =>
        dialog.locator("[data-voice-dialog-layout]").evaluate((layout) => ({
          horizontal: layout.scrollLeft,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        })),
      )
      .toEqual({ horizontal: 0, pageOverflow: false });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  const quickEmail = visibleDialogEmail(page);
  await quickEmail.fill("not-an-email");
  await quickEmail.blur();
  const quickCapture = page.locator("[data-email-quick-capture]");
  const quickHelp = page.locator("#voice-quick-email-help");
  await expect(quickCapture).toHaveAttribute("data-email-state", "invalid");
  await expect(quickHelp).toHaveText(/Enter a valid email/i);
  await expect(quickHelp).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  const dialog = page.getByRole("dialog");
  const mobileEmail = dialog.getByLabel("Email to follow up");
  await page.waitForTimeout(150);
  await mobileEmail.click();
  await expect(mobileEmail).toBeFocused();

  await page.setViewportSize({ width: 1024, height: 600 });
  const desktopEmail = dialog.getByLabel("Email", { exact: true });
  await expect(desktopEmail).toBeVisible();
  await expect(desktopEmail).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileEmail).toBeVisible();
  await expect(mobileEmail).toBeFocused();

  expect(leadPosts).toBe(0);
});

test("a maximum-length live caption keeps the voice action in the initial short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Stage the exact live-caption/composer DOM shape without opening a real
  // microphone or WebRTC session; this test owns only the responsive contract.
  await page.locator("[data-voice-session-stage]").evaluate((stage) => {
    const headline = stage.querySelector<HTMLElement>("[data-voice-stage-headline]");
    const guidance = stage.querySelector<HTMLElement>("[data-voice-mic-guidance]");
    const topics = stage.querySelector<HTMLElement>("[data-voice-stage-topics]");
    if (!headline || !guidance || !topics) throw new Error("Voice stage fixture is incomplete");

    headline.removeAttribute("data-voice-stage-headline");
    headline.setAttribute("data-voice-stage-caption", "");
    headline.textContent =
      "Here is a deliberately long live answer that exercises the full caption budget while Reka is speaking, so the visitor can still end the call immediately without scrolling through a transcript-sized block of text. This final sentence fills the remaining space.";

    const composer = document.createElement("form");
    composer.setAttribute("data-voice-stage-composer", "");
    composer.className = "mt-6 flex h-11 w-full max-w-xl gap-2";
    topics.before(composer);
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 1024, height: 390 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.locator('[data-slot="dialog-content"]').evaluate((dialog) => {
          const layout = dialog.querySelector<HTMLElement>("[data-voice-dialog-layout]");
          const action = dialog.querySelector<HTMLElement>("[data-voice-primary-action]");
          const caption = dialog.querySelector<HTMLElement>("[data-voice-stage-caption]");
          const scrollHost = window.innerWidth >= 1024 ? action?.closest<HTMLElement>("main") : layout;
          if (!action || !caption || !scrollHost) return null;
          const dialogRect = dialog.getBoundingClientRect();
          const hostRect = scrollHost.getBoundingClientRect();
          const actionRect = action.getBoundingClientRect();
          const captionStyle = getComputedStyle(caption);
          return {
            actionFits:
              actionRect.top >= Math.max(dialogRect.top, hostRect.top) - 1 &&
              actionRect.bottom <= Math.min(dialogRect.bottom, hostRect.bottom) + 1,
            captionClamp: captionStyle.getPropertyValue("-webkit-line-clamp"),
            initialScroll: scrollHost.scrollTop,
          };
        }),
      )
      .toEqual({ actionFits: true, captionClamp: "2", initialScroll: 0 });
    await expect(page.locator("[data-voice-primary-action]")).toBeInViewport({ ratio: 1 });
  }
});

test("mobile dialog source order, first focus, and tuner contrast stay voice-first", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/");
  await page.locator('header button[aria-label="Talk to Mereka"]').click();
  const dialog = page.getByRole("dialog");
  const layout = page.locator("[data-voice-dialog-layout]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();

  await expect
    .poll(() =>
      layout.evaluate((element) =>
        [...element.children].map((child) => {
          if (child.matches("[data-voice-primary-region]")) return "voice";
          if (child.matches("[data-voice-partner-region]")) return "partner";
          return child.tagName.toLowerCase();
        }),
      ),
    )
    .toEqual(["voice", "partner", "aside"]);

  await page.waitForTimeout(150);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Switch Reka voice to Reka · Polished" })).toBeFocused();
  await expect.poll(() => layout.evaluate((element) => element.scrollTop)).toBe(0);

  const tunerContrast = await page.locator("[data-voice-tuner-label]").evaluate((label) => {
    const parse = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: channels[0] ?? 0, g: channels[1] ?? 0, b: channels[2] ?? 0, a: channels[3] ?? 1 };
    };
    const background = parse(
      getComputedStyle(label.closest('[data-slot="dialog-content"]') as Element).backgroundColor,
    );
    const foreground = parse(getComputedStyle(label).color);
    const composite = {
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    };
    const lighter = Math.max(luminance(composite), luminance(background));
    const darker = Math.min(luminance(composite), luminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  });
  expect(tunerContrast).toBeGreaterThanOrEqual(4.5);
});
