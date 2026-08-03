import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  suites?: PlaywrightSuite[];
};

type PlaywrightSuite = {
  specs?: Array<{
    tests?: Array<{
      results?: Array<{ status?: string }>;
    }>;
    title?: string;
  }>;
  suites?: PlaywrightSuite[];
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Admin release proof requires ${name}`);
  return value;
}

function terminationReason(result: ReturnType<typeof spawnSync>) {
  return result.status === null ? `signal=${result.signal ?? "unknown"}` : `exit=${result.status}`;
}

function unexpectedTestTitles(report: PlaywrightJsonReport) {
  const titles = new Set<string>();
  const visit = (suite: PlaywrightSuite) => {
    for (const spec of suite.specs ?? []) {
      if (spec.tests?.some((test) => test.results?.some((result) => result.status === "failed"))) {
        titles.add(spec.title ?? "unnamed test");
      }
    }
    for (const childSuite of suite.suites ?? []) visit(childSuite);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return [...titles].slice(0, requiredAdminReleaseProofs);
}

async function main() {
  const targetOrigin = validatedAdminReleaseOrigin(requiredEnvironment("PLAYWRIGHT_BASE_URL"));
  requiredEnvironment("ADMIN_REVIEW_TOKEN");
  requiredEnvironment("ADMIN_REVIEW_PASSWORD_HMAC");
  requiredEnvironment("E2E_ADMIN_SHARED_PASSWORD");

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (await chromium.executablePath());
  const reportDirectory = mkdtempSync(join(tmpdir(), "oriental-admin-release-proof-"));
  const reportPath = join(reportDirectory, "playwright-report.json");
  const cleanupReportDirectory = () => rmSync(reportDirectory, { force: true, recursive: true });
  const cleanupOnSignal = (signal: "SIGINT" | "SIGTERM") => {
    cleanupReportDirectory();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onInterrupt = () => cleanupOnSignal("SIGINT");
  const onTermination = () => cleanupOnSignal("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTermination);
  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "tests/e2e/admin-session-review.spec.ts",
        "--project=chromium",
        // The three release proofs share the live login limiter. Running them
        // concurrently turns the verifier into a self-inflicted 429, instead of
        // testing the limiter's intended sequential budget and block boundary.
        "--workers=1",
        "--grep=@release",
        "--reporter=json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          E2E_ADMIN_RELEASE_PROOF: "1",
          PLAYWRIGHT_CHROMIUM_PATH: executablePath,
          PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    if (result.error) throw new Error(`Admin release proof runner failed to start: ${result.error.message}`);

    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8")) as PlaywrightJsonReport;
    } catch {
      throw new Error(`Admin release proof did not write valid isolated JSON (${terminationReason(result)})`);
    }
    const stats = report.stats;
    const expected = stats?.expected;
    const skipped = stats?.skipped;
    const unexpected = stats?.unexpected;
    const flaky = stats?.flaky;
    const failedTests = unexpectedTestTitles(report);
    if (
      result.status !== 0 ||
      expected !== requiredAdminReleaseProofs ||
      skipped !== 0 ||
      unexpected !== 0 ||
      flaky !== 0
    ) {
      throw new Error(
        `Admin release proof failed: ${terminationReason(result)} expected=${expected ?? "unknown"} skipped=${skipped ?? "unknown"} unexpected=${unexpected ?? "unknown"} flaky=${flaky ?? "unknown"} failedTests=${failedTests.join(" | ") || "not-reported"}`,
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
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTermination);
    cleanupReportDirectory();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
