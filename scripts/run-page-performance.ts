import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import chromium from "@sparticuz/chromium";

async function main() {
  if (!process.env.PERFORMANCE_BASE_URL) prepareStandaloneBuild();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await chromium.executablePath());
  const result = spawnSync("pnpm", ["exec", "playwright", "test", "--config=playwright.performance.config.ts"], {
    env: { ...process.env, PLAYWRIGHT_CHROMIUM_PATH: executablePath },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function prepareStandaloneBuild() {
  if (!existsSync(".next/standalone/server.js") || !existsSync(".next/static") || !existsSync("public")) {
    throw new Error("production build is missing; run pnpm build before pnpm test:performance");
  }
  rmSync(".next/standalone/.next/static", { recursive: true, force: true });
  rmSync(".next/standalone/public", { recursive: true, force: true });
  mkdirSync(".next/standalone/.next", { recursive: true });
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  cpSync("public", ".next/standalone/public", { recursive: true });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
