import { chromium, type Page, type Response } from "playwright";
import { voiceReviewSnapshotSchema } from "../lib/schemas";
import { STAGING_CANDIDATE_VOICE_CELL } from "./lib/release-governance";

const canonicalStagingOrigin = "https://staging.oriental.mereka.io";
const targetOrigin = new URL(process.env.VOICE_SMOKE_URL ?? canonicalStagingOrigin).origin;
const expectedModel = process.env.EXPECTED_REALTIME_MODEL ?? STAGING_CANDIDATE_VOICE_CELL.model;
const expectedModelCell = process.env.EXPECTED_REALTIME_MODEL_CELL ?? STAGING_CANDIDATE_VOICE_CELL.modelCell;
const expectedEmailCaptureMode =
  process.env.EXPECTED_EMAIL_CAPTURE_MODE ?? STAGING_CANDIDATE_VOICE_CELL.emailCaptureMode;

if (targetOrigin !== canonicalStagingOrigin) {
  throw new Error(`Refusing voice smoke target outside canonical staging: ${targetOrigin}`);
}

type SmokeResult = {
  target: string;
  version: string;
  connectedMs: number;
  openerAudioMs: number;
  interruptionRecoveryMs: number;
  loaderObserved: boolean;
  nebulaRenderer: "webgl" | "svg-fallback";
  responsiveViewportsChecked: number;
  remoteAudioTrackLive: boolean;
  remoteAudioAdvanced: boolean;
  realtimeModel: string;
  realtimeModelCell: string;
  emailCaptureMode: string;
  transcriptionModel: string;
  sessionMintStatuses: number[];
  debugStatuses: number[];
  pageErrors: number;
  consoleErrors: number;
};

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
  const sessionProfiles: Array<{
    model: string;
    modelCell: string;
    emailCaptureMode: string;
    transcriptionModel: string;
  }> = [];
  const sessionProfileCaptures: Array<Promise<void>> = [];
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
      const responseUrl = new URL(response.url());
      if (responseUrl.pathname === "/api/voice/session" && response.status() === 200) {
        sessionProfileCaptures.push(
          response
            .json()
            .then((body: unknown) => {
              const profile = readSessionProfile(body);
              if (profile) sessionProfiles.push(profile);
            })
            .catch(() => undefined),
        );
      }
      if (response.status() >= 400) {
        const url = responseUrl;
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
    const health = (await healthBefore.json()) as {
      ok?: boolean;
      version?: string;
      convex?: boolean;
      voice?: { model?: string; model_cell?: string; email_capture_mode?: string };
    };
    if (
      !health.ok ||
      !health.version ||
      !health.convex ||
      !health.voice?.model ||
      !health.voice.model_cell ||
      !health.voice.email_capture_mode
    ) {
      throw new Error("Staging health payload is incomplete");
    }
    if (health.voice.model !== expectedModel || health.voice.model_cell !== expectedModelCell) {
      throw new Error(
        `Unexpected staging health Realtime cell: ${health.voice.model}/${health.voice.model_cell}; expected ${expectedModel}/${expectedModelCell}`,
      );
    }
    if (health.voice.email_capture_mode !== expectedEmailCaptureMode) {
      throw new Error(
        `Unexpected staging health email capture mode: ${health.voice.email_capture_mode}; expected ${expectedEmailCaptureMode}`,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(targetOrigin, { waitUntil: "load" });
    const loader = page.locator(".brand-site-loader");
    await loader.waitFor({ state: "visible", timeout: 3_000 });
    await loader.waitFor({ state: "hidden", timeout: 5_000 });
    await page.locator('header button[aria-label="Talk to Mereka"]').waitFor({ state: "visible" });
    await page.locator('header button[aria-label="Talk to Mereka"]').click();
    const orb = page.locator(".voice-orb");
    await orb.waitFor({ state: "visible" });
    const nebula = page.locator(".mereka-nebula");
    await nebula.waitFor({ state: "visible" });
    await page.waitForFunction(
      () => {
        const mark = document.querySelector<HTMLElement>(".mereka-nebula");
        return mark?.dataset.ready === "true" || mark?.dataset.fallback === "true";
      },
      undefined,
      { timeout: 10_000 },
    );
    const nebulaRenderer = (await nebula.getAttribute("data-ready")) === "true" ? "webgl" : "svg-fallback";
    await nebula.click({ force: true });
    const responsiveViewportsChecked = await assertResponsiveDialog(page);

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
      .fill("My email is qa.nebula@example.test. Please pause and tell me briefly about education partnerships.");
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

    const finalReviewPersisted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/voice/debug" && response.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "End voice" }).click();
    await waitForTurn(page, "idle", undefined, 20_000);
    await finalReviewPersisted;

    const healthAfter = await context.request.get(`${targetOrigin}/api/health`);
    if (!healthAfter.ok()) throw new Error(`Staging health failed after smoke: ${healthAfter.status()}`);
    if (!sessionMintStatuses.some((status) => status === 200)) throw new Error("Voice session mint was not observed");
    await Promise.allSettled(sessionProfileCaptures);
    const sessionProfile = sessionProfiles.at(-1);
    if (!sessionProfile) throw new Error("Voice session profile was not captured");
    if (sessionProfile.model !== expectedModel || sessionProfile.modelCell !== expectedModelCell) {
      throw new Error(
        `Unexpected staging Realtime cell: ${sessionProfile.model}/${sessionProfile.modelCell}; expected ${expectedModel}/${expectedModelCell}`,
      );
    }
    if (sessionProfile.emailCaptureMode !== expectedEmailCaptureMode) {
      throw new Error(
        `Unexpected staging email capture mode: ${sessionProfile.emailCaptureMode}; expected ${expectedEmailCaptureMode}`,
      );
    }
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
      loaderObserved: true,
      nebulaRenderer,
      responsiveViewportsChecked,
      remoteAudioTrackLive: audioAfterInterrupt.trackLive,
      remoteAudioAdvanced: audioAfterInterrupt.currentTime > audioBeforeInterrupt.currentTime,
      realtimeModel: sessionProfile.model,
      realtimeModelCell: sessionProfile.modelCell,
      emailCaptureMode: sessionProfile.emailCaptureMode,
      transcriptionModel: sessionProfile.transcriptionModel,
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

function readSessionProfile(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.model !== "string" ||
    typeof body.model_cell !== "string" ||
    typeof body.email_capture_mode !== "string" ||
    typeof body.transcription_model !== "string"
  ) {
    return null;
  }
  return {
    model: body.model,
    modelCell: body.model_cell,
    emailCaptureMode: body.email_capture_mode,
    transcriptionModel: body.transcription_model,
  };
}

async function assertResponsiveDialog(page: Page) {
  const initialScrollTop = await page.locator("[data-voice-dialog-layout]").evaluate((layout) => layout.scrollTop);
  if (initialScrollTop !== 0)
    throw new Error(`Voice dialog opened with an unexpected scroll offset: ${initialScrollTop}`);

  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1024, height: 600 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    try {
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
          if (!dialog) return false;
          const rect = dialog.getBoundingClientRect();
          const close = dialog.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.getBoundingClientRect();
          return (
            rect.left >= -1 &&
            rect.top >= -1 &&
            rect.right <= window.innerWidth + 1 &&
            rect.bottom <= window.innerHeight + 1 &&
            Boolean(
              close &&
                close.left >= rect.left &&
                close.top >= rect.top &&
                close.right <= rect.right &&
                close.bottom <= rect.bottom,
            ) &&
            document.documentElement.scrollWidth <= window.innerWidth
          );
        },
        undefined,
        { timeout: 2_000 },
      );
    } catch {
      const geometry = await page.locator('[data-slot="dialog-content"]').evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const close = dialog.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dialog: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          close: close
            ? {
                left: close.left,
                top: close.top,
                right: close.right,
                bottom: close.bottom,
              }
            : null,
          animation: style.animation,
          transition: style.transition,
          documentScrollWidth: document.documentElement.scrollWidth,
        };
      });
      throw new Error(
        `Voice dialog did not settle within ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`,
      );
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-voice-dialog-layout]").evaluate((layout) => {
    layout.scrollTop = layout.scrollHeight;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>("[data-voice-dialog-layout]")?.scrollTop === 0,
    undefined,
    { timeout: 2_000 },
  );
  return viewports.length + 1;
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
