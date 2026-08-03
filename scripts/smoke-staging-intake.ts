import { chromium, type Route } from "playwright";
import { readEnv } from "../lib/env";
import { voiceReviewSnapshotSchema } from "../lib/schemas";
import { createVoiceSmokeProof, VOICE_SMOKE_PROOF_HEADER } from "../lib/server/voice-smoke-proof";

const stagingOrigin = "https://staging.oriental.mereka.io";
const expectedEmail = "qa.nebula@example.test";
const pendingCopy = "Reka heard this address. Say yes after the exact read-back, or edit it here to confirm it.";
const capturedCopy = "Captured from your voice · edit anytime.";
const smokeSigningSecret = requireSmokeSigningSecret();

function requireSmokeSigningSecret() {
  const secret = readEnv("IP_HASH_SECRET");
  if (!secret) throw new Error("IP_HASH_SECRET is required to identify the staging intake smoke securely");
  return secret;
}

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
  const sessionMintStatuses: number[] = [];
  const realtimeCallStatuses: number[] = [];
  let attemptedLeadPosts = 0;
  let rejectUpstreamFailure: ((error: Error) => void) | undefined;
  const upstreamFailure = new Promise<never>((_, reject) => {
    rejectUpstreamFailure = reject;
  });

  try {
    const context = await browser.newContext();
    await context.grantPermissions(["microphone"], { origin: stagingOrigin });
    const page = await context.newPage();
    await page.route("**/api/voice/session", (route) => continueSyntheticSession(route));
    await page.route("**/api/leads", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || new URL(request.url()).origin !== stagingOrigin) return route.continue();
      attemptedLeadPosts += 1;
      await route.abort("blockedbyclient");
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname === "/api/voice/session") sessionMintStatuses.push(response.status());
      if (url.host === "api.openai.com" && url.pathname === "/v1/realtime/calls") {
        realtimeCallStatuses.push(response.status());
        if (response.status() >= 400) {
          rejectUpstreamFailure?.(new Error(`OpenAI Realtime call failed with HTTP ${response.status()}`));
        }
      }
    });

    const healthResponse = await context.request.get(`${stagingOrigin}/api/health`);
    if (!healthResponse.ok()) throw new Error(`Staging health failed: ${healthResponse.status()}`);
    const health = (await healthResponse.json()) as { ok?: boolean; version?: string };
    if (!health.ok || !health.version) throw new Error("Staging health payload is incomplete");

    await page.goto(stagingOrigin, { waitUntil: "load" });
    await page.locator('header button[aria-label="Talk to Mereka"]').click();
    const terminalDebugResponse = page
      .waitForResponse(isTerminalAvailabilitySnapshot, { timeout: 60_000 })
      .catch(() => null);
    await page.getByRole("button", { name: "Start voice with Reka" }).click();
    try {
      await Promise.race([waitForListening(page, 45_000), upstreamFailure]);
    } catch (error) {
      const terminalResponse = await terminalDebugResponse;
      const terminalBody = (await terminalResponse?.json().catch(() => null)) as {
        applied?: unknown;
        persisted?: unknown;
      } | null;
      const terminalDebugApplied = terminalBody?.persisted === true && terminalBody.applied === true;
      const orbState = await page
        .locator(".voice-orb")
        .evaluate((orb) => ({ status: (orb as HTMLElement).dataset.status, turn: (orb as HTMLElement).dataset.turn }))
        .catch(() => null);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}; diagnostics=${JSON.stringify({
          orbState,
          sessionMintStatuses,
          realtimeCallStatuses,
          terminalDebugApplied,
        })}`,
      );
    }

    const assistantTurnsBefore = await assistantTurnCount(page);
    await sendTyped(page, "My email is q a dot nebula at example dot test. Please capture it, but do not send.");
    const emailInput = page.locator('input[name="email"]:visible');
    await emailInput.waitFor({ state: "visible" });
    await page.waitForFunction(
      (email) =>
        [...document.querySelectorAll<HTMLInputElement>('input[name="email"]')].some(
          (input) => input.getClientRects().length > 0 && input.value === email,
        ),
      expectedEmail,
      { timeout: 45_000 },
    );
    const capturedHint = page.getByText(capturedCopy, { exact: true });
    await capturedHint.waitFor({ state: "visible", timeout: 10_000 });
    const captureField = await capturedHint.evaluate(
      (hint) => hint.closest('[data-slot="form-item"]')?.querySelector("label")?.textContent?.trim() ?? "",
    );
    if (captureField !== "Email") throw new Error(`Capture hint appeared under ${captureField || "no field"}`);
    await page.getByText(pendingCopy, { exact: true }).waitFor({ state: "hidden", timeout: 10_000 });

    await page.waitForFunction(
      (before) =>
        [...document.querySelectorAll<HTMLElement>('[aria-label="Conversation transcript"] p')].filter((entry) =>
          (entry.textContent?.toLowerCase() ?? "").startsWith("reka:"),
        ).length > before,
      assistantTurnsBefore,
      { timeout: 60_000 },
    );

    if ((await emailInput.inputValue()) !== expectedEmail) throw new Error("Captured email changed");
    if (attemptedLeadPosts !== 0) {
      throw new Error(`Probe attempted ${attemptedLeadPosts} blocked lead request(s)`);
    }

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
          adaptiveCaptureObserved: true,
          mandatoryConfirmationObserved: false,
          captureField,
          attemptedLeadPosts,
          sessionMintStatuses,
          realtimeCallStatuses,
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

async function continueSyntheticSession(route: Route) {
  const request = route.request();
  if (new URL(request.url()).origin !== stagingOrigin) return route.continue();
  const proof = createVoiceSmokeProof(smokeSigningSecret);
  const postData = request.postDataJSON() as unknown;
  if (!postData || typeof postData !== "object" || Array.isArray(postData)) {
    throw new Error("Staging intake smoke could not authenticate the session request body");
  }
  await route.continue({
    headers: { ...request.headers(), [VOICE_SMOKE_PROOF_HEADER]: proof },
    postData: JSON.stringify({ ...postData, smokeProof: proof }),
  });
}

function isTerminalAvailabilitySnapshot(response: import("playwright").Response) {
  if (new URL(response.url()).pathname !== "/api/voice/debug" || response.status() !== 200) return false;
  const postData = response.request().postData();
  if (!postData) return false;
  try {
    const parsed = voiceReviewSnapshotSchema.safeParse(JSON.parse(postData));
    return Boolean(
      parsed.success &&
        (parsed.data.snapshot.closeReason === "realtime_quota_exhausted" ||
          parsed.data.snapshot.closeReason === "realtime_busy" ||
          parsed.data.snapshot.closeReason === "webrtc_failed"),
    );
  } catch {
    return false;
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

async function assistantTurnCount(page: import("playwright").Page) {
  return page
    .locator('[aria-label="Conversation transcript"] p')
    .evaluateAll(
      (entries) => entries.filter((entry) => (entry.textContent?.toLowerCase() ?? "").startsWith("reka:")).length,
    );
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
