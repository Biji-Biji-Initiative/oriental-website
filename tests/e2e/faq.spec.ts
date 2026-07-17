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

test("FAQ renders and the inline Talk to Mereka CTA opens the form-first dialog without the microphone", async ({
  page,
  isMobile,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __voiceGetUserMediaCalled?: boolean };
    state.__voiceGetUserMediaCalled = false;
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

  await page.goto("/faq");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.locator("main").getByRole("button", { name: "Talk to Mereka" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(isMobile ? page.getByRole("dialog") : page.getByLabel("Name")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __voiceGetUserMediaCalled?: boolean }).__voiceGetUserMediaCalled,
      ),
    )
    .toBe(false);
});
