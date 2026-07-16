import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PERFORMANCE_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3011";

export default defineConfig({
  testDir: "./tests/performance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "node .next/standalone/server.js",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: { HOSTNAME: "127.0.0.1", PORT: "3011" },
      },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  },
  projects: [{ name: "mobile-performance", use: { ...devices["Pixel 7"] } }],
});
