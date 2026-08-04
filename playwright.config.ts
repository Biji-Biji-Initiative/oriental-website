import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const localPort = process.env.PLAYWRIGHT_PORT ?? "3011";
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `env NEXT_PUBLIC_BRAND_MOTION_ENABLED=true pnpm exec next dev --hostname 127.0.0.1 --port ${localPort}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  use: {
    baseURL,
    trace: process.env.E2E_ADMIN_RELEASE_PROOF === "1" ? "off" : "retain-on-failure",
    // Sandboxed dev environments cannot download Playwright's browsers; allow
    // pointing at a system/npm-provided chromium instead.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
            args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
          },
        }
      : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
