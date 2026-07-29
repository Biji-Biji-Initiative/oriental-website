import { spawnSync } from "node:child_process";
import chromium from "@sparticuz/chromium";
import { validatedAdminReleaseOrigin } from "./lib/admin-release-proof";

const requiredAdminReleaseProofs = 3;

type PlaywrightJsonReport = {
  stats?: {
    duration?: number;
    expected?: number;
    flaky?: number;
    skipped?: number;
    unexpected?: number;
  };
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Admin release proof requires ${name}`);
  return value;
}

async function main() {
  const targetOrigin = validatedAdminReleaseOrigin(requiredEnvironment("PLAYWRIGHT_BASE_URL"));
  requiredEnvironment("ADMIN_REVIEW_TOKEN");
  requiredEnvironment("ADMIN_REVIEW_PASSWORD_HMAC");
  requiredEnvironment("E2E_ADMIN_SHARED_PASSWORD");

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await chromium.executablePath());
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "tests/e2e/admin-session-review.spec.ts",
      "--project=chromium",
      "--grep=@release",
      "--reporter=json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        E2E_ADMIN_RELEASE_PROOF: "1",
        PLAYWRIGHT_CHROMIUM_PATH: executablePath,
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error) throw new Error(`Admin release proof runner failed to start: ${result.error.message}`);

  let report: PlaywrightJsonReport;
  try {
    report = JSON.parse(result.stdout) as PlaywrightJsonReport;
  } catch {
    throw new Error(`Admin release proof did not emit valid JSON (exit ${result.status ?? "unknown"})`);
  }
  const stats = report.stats;
  const expected = stats?.expected;
  const skipped = stats?.skipped;
  const unexpected = stats?.unexpected;
  const flaky = stats?.flaky;
  if (
    result.status !== 0 ||
    expected !== requiredAdminReleaseProofs ||
    skipped !== 0 ||
    unexpected !== 0 ||
    flaky !== 0
  ) {
    throw new Error(
      `Admin release proof failed: exit=${result.status ?? "unknown"} expected=${expected ?? "unknown"} skipped=${skipped ?? "unknown"} unexpected=${unexpected ?? "unknown"} flaky=${flaky ?? "unknown"}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      durationMs: stats?.duration ?? null,
      expected,
      flaky,
      ok: true,
      skipped,
      target: targetOrigin,
      unexpected,
    })}\n`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
