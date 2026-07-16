import { chromium, type Page, type Response } from "playwright";
import { voiceReviewSnapshotSchema } from "../lib/schemas";

const canonicalStagingOrigin = "https://staging.oriental.mereka.io";
const targetOrigin = new URL(process.env.VOICE_SMOKE_URL ?? canonicalStagingOrigin).origin;

if (targetOrigin !== canonicalStagingOrigin) {
  throw new Error(`Refusing voice smoke target outside canonical staging: ${targetOrigin}`);
}

type SmokeResult = {
  target: string;
  version: string;
  connectedMs: number;
  openerAudioMs: number;
  interruptionRecoveryMs: number;
  remoteAudioTrackLive: boolean;
  remoteAudioAdvanced: boolean;
  sessionMintStatuses: number[];
  debugStatuses: number[];
  pageErrors: number;
  consoleErrors: number;
};

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const sessionMintStatuses: number[] = [];
  const debugStatuses: number[] = [];
  const failedResponses: Array<{
    host: string;
    path: string;
    status: number;
    retryAfter?: string;
    body?: string;
    requestContentType?: string;
    requestBodyBytes?: number;
    schemaIssues?: Array<{ path: string; code: string }>;
  }> = [];
  const responseDiagnostics: Array<Promise<void>> = [];
  let rejectUpstreamFailure: ((error: Error) => void) | undefined;
  const upstreamFailure = new Promise<never>((_, reject) => {
    rejectUpstreamFailure = reject;
  });
  let page: Page | undefined;

  try {
    const context = await browser.newContext();
    await context.grantPermissions(["microphone"], { origin: targetOrigin });
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      recordApiStatus(response, sessionMintStatuses, debugStatuses);
      if (response.status() >= 400) {
        const url = new URL(response.url());
        const failedResponse: (typeof failedResponses)[number] = {
          host: url.host,
          path: url.pathname,
          status: response.status(),
          retryAfter: response.headers()["retry-after"],
          body: "[unavailable]",
          ...diagnoseFailedRequest(response),
        };
        failedResponses.push(failedResponse);
        const bodyCapture = response
          .text()
          .then((body) => {
            failedResponse.body = sanitizeDiagnostic(body);
          })
          .catch(() => undefined);
        const bodyTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        responseDiagnostics.push(Promise.race([bodyCapture, bodyTimeout]));
        if (url.host === "api.openai.com" && url.pathname === "/v1/realtime/calls") {
          rejectUpstreamFailure?.(new Error(`OpenAI Realtime call failed with HTTP ${response.status()}`));
        }
      }
    });

    const healthBefore = await context.request.get(`${targetOrigin}/api/health`);
    if (!healthBefore.ok()) throw new Error(`Staging health failed before smoke: ${healthBefore.status()}`);
    const health = (await healthBefore.json()) as { ok?: boolean; version?: string; convex?: boolean };
    if (!health.ok || !health.version || !health.convex) throw new Error("Staging health payload is incomplete");

    await page.goto(targetOrigin, { waitUntil: "load" });
    await page.locator('header button[aria-label="Talk to Mereka"]').waitFor({ state: "visible" });
    await page.locator('header button[aria-label="Talk to Mereka"]').click();
    const orb = page.locator(".voice-orb");
    await orb.waitFor({ state: "visible" });

    const connectStartedAt = performance.now();
    await page.getByRole("button", { name: "Start voice with Reka" }).click();
    await Promise.race([waitForTurn(page, "listening", undefined, 45_000), upstreamFailure]);
    const connectedMs = performance.now() - connectStartedAt;

    const openerStartedAt = performance.now();
    await waitForTurn(page, "listening", "assistant_speaking", 60_000);
    await waitForRemoteAudio(page, 30_000);
    const openerAudioMs = performance.now() - openerStartedAt;
    const audioBeforeInterrupt = await remoteAudioState(page);

    const interruptionStartedAt = performance.now();
    await page
      .getByLabel("Type a message to Reka")
      .fill("Please pause and tell me briefly about education partnerships.");
    await page.getByRole("button", { name: "Send typed message" }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".voice-orb")?.dataset.turn !== "assistant_speaking",
      undefined,
      { timeout: 15_000 },
    );
    await waitForTurn(page, "listening", "assistant_speaking", 60_000);
    await waitForRemoteAudio(page, 30_000);
    const interruptionRecoveryMs = performance.now() - interruptionStartedAt;
    const audioAfterInterrupt = await remoteAudioState(page);

    await page.getByRole("button", { name: "End voice" }).click();
    await waitForTurn(page, "idle", undefined, 20_000);
    await page.waitForTimeout(1_000);

    const healthAfter = await context.request.get(`${targetOrigin}/api/health`);
    if (!healthAfter.ok()) throw new Error(`Staging health failed after smoke: ${healthAfter.status()}`);
    if (!sessionMintStatuses.some((status) => status === 200)) throw new Error("Voice session mint was not observed");
    if (!debugStatuses.some((status) => status === 200)) throw new Error("Voice review snapshot was not persisted");
    await Promise.allSettled(responseDiagnostics);
    if (pageErrors.length > 0 || consoleErrors.length > 0) {
      throw new Error(`Browser errors observed: page=${pageErrors.length} console=${consoleErrors.length}`);
    }

    const result: SmokeResult = {
      target: targetOrigin,
      version: health.version,
      connectedMs: Math.round(connectedMs),
      openerAudioMs: Math.round(openerAudioMs),
      interruptionRecoveryMs: Math.round(interruptionRecoveryMs),
      remoteAudioTrackLive: audioAfterInterrupt.trackLive,
      remoteAudioAdvanced: audioAfterInterrupt.currentTime > audioBeforeInterrupt.currentTime,
      sessionMintStatuses,
      debugStatuses,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    await Promise.allSettled(responseDiagnostics);
    const orbState = await page
      ?.locator(".voice-orb")
      .evaluate((orb) => ({ status: (orb as HTMLElement).dataset.status, turn: (orb as HTMLElement).dataset.turn }))
      .catch(() => null);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}; diagnostics=${JSON.stringify({
        orbState,
        sessionMintStatuses,
        debugStatuses,
        pageErrors: pageErrors.length,
        consoleErrors: consoleErrors.length,
        consoleErrorMessages: consoleErrors.map(sanitizeDiagnostic),
        failedResponses,
      })}`,
    );
  } finally {
    await browser.close();
  }
}

function recordApiStatus(response: Response, sessionStatuses: number[], debugStatuses: number[]) {
  const pathname = new URL(response.url()).pathname;
  if (pathname === "/api/voice/session") sessionStatuses.push(response.status());
  if (pathname === "/api/voice/debug") debugStatuses.push(response.status());
}

async function waitForTurn(page: Page, status: string, turn?: string, timeout = 30_000) {
  await page.waitForFunction(
    ({ expectedStatus, expectedTurn }) => {
      const orb = document.querySelector<HTMLElement>(".voice-orb");
      return orb?.dataset.status === expectedStatus && (!expectedTurn || orb.dataset.turn === expectedTurn);
    },
    { expectedStatus: status, expectedTurn: turn },
    { timeout },
  );
}

async function waitForRemoteAudio(page: Page, timeout: number) {
  await page.waitForFunction(
    () => {
      const audio = document.querySelector<HTMLAudioElement>("audio");
      const stream = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
      return Boolean(
        audio && audio.currentTime > 0 && stream?.getAudioTracks().some((track) => track.readyState === "live"),
      );
    },
    undefined,
    { timeout },
  );
}

async function remoteAudioState(page: Page) {
  return page.locator("audio").evaluate((audio) => {
    const media = audio as HTMLAudioElement;
    const stream = media.srcObject instanceof MediaStream ? media.srcObject : null;
    return {
      currentTime: media.currentTime,
      trackLive: Boolean(stream?.getAudioTracks().some((track) => track.readyState === "live")),
    };
  });
}

function sanitizeDiagnostic(message: string) {
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 240);
}

function diagnoseFailedRequest(response: Response) {
  const request = response.request();
  const postData = request.postData();
  if (!postData) return { requestContentType: request.headers()["content-type"] };
  try {
    const parsed = voiceReviewSnapshotSchema.safeParse(JSON.parse(postData));
    return {
      requestContentType: request.headers()["content-type"],
      requestBodyBytes: Buffer.byteLength(postData),
      schemaIssues: parsed.success
        ? []
        : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })).slice(0, 12),
    };
  } catch {
    return {
      requestContentType: request.headers()["content-type"],
      requestBodyBytes: Buffer.byteLength(postData),
      schemaIssues: [{ path: "<json>", code: "invalid_json" }],
    };
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Staging voice smoke failed: ${message}\n`);
  process.exitCode = 1;
});
