import { chromium } from "playwright";

const stagingOrigin = "https://staging.oriental.mereka.io";
const expectedEmail = "qa.nebula@example.test";
const pendingCopy = "Reka heard this address. Say yes after the exact read-back, or edit it here to confirm it.";
const confirmedCopy = "Confirmed from your voice.";

async function run() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let leadPosts = 0;

  try {
    const context = await browser.newContext();
    await context.grantPermissions(["microphone"], { origin: stagingOrigin });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/leads") leadPosts += 1;
    });

    const healthResponse = await context.request.get(`${stagingOrigin}/api/health`);
    if (!healthResponse.ok()) throw new Error(`Staging health failed: ${healthResponse.status()}`);
    const health = (await healthResponse.json()) as { ok?: boolean; version?: string };
    if (!health.ok || !health.version) throw new Error("Staging health payload is incomplete");

    await page.goto(stagingOrigin, { waitUntil: "load" });
    await page.locator('header button[aria-label="Talk to Mereka"]').click();
    await page.getByRole("button", { name: "Start voice with Reka" }).click();
    await waitForListening(page, 45_000);

    await sendTyped(page, "My email is q a dot nebula at example dot test. Please capture it, but do not send.");
    await page.getByLabel("Email").waitFor({ state: "visible" });
    await page.waitForFunction(
      (email) => (document.querySelector<HTMLInputElement>('input[name="email"]')?.value ?? "") === email,
      expectedEmail,
      { timeout: 45_000 },
    );
    const pendingHint = page.getByText(pendingCopy, { exact: true });
    await pendingHint.waitFor({ state: "visible", timeout: 10_000 });
    const confirmationField = await pendingHint.evaluate(
      (hint) => hint.closest('[data-slot="form-item"]')?.querySelector("label")?.textContent?.trim() ?? "",
    );
    if (confirmationField !== "Email")
      throw new Error(`Confirmation hint appeared under ${confirmationField || "no field"}`);

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLElement>('[aria-label="Conversation transcript"] p')].some((entry) => {
          const line = entry.textContent?.toLowerCase() ?? "";
          return (
            line.startsWith("reka:") && line.includes("nebula") && line.includes("example") && line.includes("test")
          );
        }),
      undefined,
      { timeout: 60_000 },
    );

    await sendTyped(page, "Yes, that's exactly correct. Do not send it yet.");
    await page.getByText(confirmedCopy, { exact: true }).waitFor({ state: "visible", timeout: 45_000 });
    await page.getByText(pendingCopy, { exact: true }).waitFor({ state: "hidden", timeout: 10_000 });
    if ((await page.getByLabel("Email").inputValue()) !== expectedEmail) throw new Error("Confirmed email changed");
    if (leadPosts !== 0) throw new Error(`Probe unexpectedly submitted ${leadPosts} lead request(s)`);

    await page.getByRole("button", { name: "End voice" }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".voice-orb")?.dataset.status === "idle",
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    if (pageErrors.length || consoleErrors.length) {
      throw new Error(`Browser errors observed: page=${pageErrors.length} console=${consoleErrors.length}`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          target: stagingOrigin,
          version: health.version,
          capturedEmail: expectedEmail,
          exactReadbackObserved: true,
          voiceConfirmationObserved: true,
          confirmationField,
          leadPosts,
          pageErrors: pageErrors.length,
          consoleErrors: consoleErrors.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await browser.close();
  }
}

async function waitForListening(page: import("playwright").Page, timeout: number) {
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>(".voice-orb")?.dataset.status === "listening",
    undefined,
    { timeout },
  );
}

async function sendTyped(page: import("playwright").Page, message: string) {
  const composer = page.getByLabel("Type a message to Reka");
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send typed message" }).click();
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
