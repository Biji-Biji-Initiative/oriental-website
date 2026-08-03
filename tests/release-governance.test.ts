import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validatedAdminReleaseOrigin } from "../scripts/lib/admin-release-proof";
import {
  MANAGED_APPLICATION_ENVIRONMENT_KEYS,
  type ManagedApplicationEnvironmentKey,
  managedEnvironmentMutationFailures,
  managedEnvironmentParityFailures,
  managedEnvironmentReconciliationPlan,
  RETIRED_MANAGED_APPLICATION_ENVIRONMENT_KEYS,
} from "../scripts/lib/managed-app-environment";
import {
  CONTROL_VOICE_CELL,
  governedVoiceCell,
  hasCloudflareEdgeHeaders,
  RELEASE_TARGETS,
  STAGING_CANDIDATE_AUDITION_VOICE_CELL,
  STAGING_CANDIDATE_VOICE_CELL,
  validateHealthPayload,
  validateManagedVoiceCell,
  validateReleaseSha,
  validateReleaseStaticContracts,
} from "../scripts/lib/release-governance";
import { releaseTestEnv } from "../scripts/lib/release-test-env";

const sha = "bb8e2673e5f129f342fba78f3eb653a54de8763b";
const releasePreflight = readFileSync("scripts/release-preflight.ts", "utf8");
const releaseVerifier = readFileSync("scripts/release-verify.ts", "utf8");
const adminReleaseVerifier = readFileSync("scripts/verify-admin-release-proof.ts", "utf8");
const adminReviewE2e = readFileSync("tests/e2e/admin-session-review.spec.ts", "utf8");
const productionDeployer = readFileSync("scripts/deploy-coolify-production.ts", "utf8");
const hostDeployer = readFileSync("scripts/deploy-coolify-host.sh", "utf8");
const deadlineRunner = readFileSync("scripts/run-command-with-deadline.ts", "utf8");
const lifecycleBackfill = readFileSync("scripts/backfill-voice-session-lifecycle.ts", "utf8");
const orphanVerifier = readFileSync("scripts/verify-orphan-sweep.ts", "utf8");
const stagingVoiceSmoke = readFileSync("scripts/smoke-staging-voice.ts", "utf8");
const stagingIntakeSmoke = readFileSync("scripts/smoke-staging-intake.ts", "utf8");
const leadsRoute = readFileSync("app/api/leads/route.ts", "utf8");
const voiceSessionRoute = readFileSync("app/api/voice/session/route.ts", "utf8");
const voiceDebugRoute = readFileSync("app/api/voice/debug/route.ts", "utf8");
const voicePicker = readFileSync("components/voice-agent/VoiceVariantPicker.tsx", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");
const releaseRunbook = readFileSync("docs/12-CHAT-RELEASE-RUNBOOK.md", "utf8");
const analyticsOpsWorkflow = readFileSync(".github/workflows/analytics-ops.yml", "utf8");
const packageScripts = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

describe("release governance", () => {
  it("owns distinct least-privilege admin credentials and uses only the ops token in scheduled jobs", () => {
    expect(MANAGED_APPLICATION_ENVIRONMENT_KEYS).toEqual(
      expect.arrayContaining([
        "ADMIN_REVIEW_ACTOR",
        "ADMIN_REVIEW_ROLE",
        "ADMIN_REVIEW_TOKEN",
        "ADMIN_REVIEW_PASSWORD_HMAC",
        "OPS_AUTOMATION_TOKEN",
        "PRIVACY_ADMIN_TOKEN",
      ]),
    );
    expect(analyticsOpsWorkflow).toContain("secrets.OPS_AUTOMATION_TOKEN");
    expect(analyticsOpsWorkflow).not.toContain("secrets.ADMIN_REVIEW_TOKEN");
  });

  it("makes the full-access password admin lane mandatory and machine checked for releases", () => {
    expect(packageScripts.scripts["release:verify:admin"]).toBe("tsx scripts/verify-admin-release-proof.ts");
    expect(adminReleaseVerifier).toContain('E2E_ADMIN_RELEASE_PROOF: "1"');
    expect(adminReleaseVerifier).toContain('"--project=chromium"');
    expect(adminReleaseVerifier).toContain('"--grep=@release"');
    expect(adminReleaseVerifier).toContain('"--reporter=json"');
    expect(adminReleaseVerifier).toContain("expected !== requiredAdminReleaseProofs");
    expect(adminReleaseVerifier).toContain("skipped !== 0");
    expect(adminReleaseVerifier).toContain("unexpected !== 0");
    expect(adminReleaseVerifier).toContain("flaky !== 0");
    expect(adminReleaseVerifier).toContain("target: targetOrigin");
    expect(adminReviewE2e).toContain('process.env.E2E_ADMIN_RELEASE_PROOF === "1"');
    expect(adminReviewE2e).toContain('reviewLogin.credential !== "review_bearer"');
    expect(adminReviewE2e).toContain('passwordLogin.credential !== "interactive_password"');
    expect(adminReviewE2e).toContain('role: "admin"');
    expect(adminReviewE2e).toContain("expect(rawReview.status()).toBe(200)");
    expect(adminReviewE2e).toContain("expect(mutationAdmission.status()).toBe(400)");
    expect(adminReviewE2e.match(/ @release"/gu)).toHaveLength(3);
    expect(releaseRunbook.match(/pnpm release:verify:admin/gu)).toHaveLength(2);
    expect(releaseRunbook).toContain("`skipped=0`");
  });

  it("accepts only exact canonical root origins for the live admin proof", () => {
    expect(validatedAdminReleaseOrigin("https://staging.oriental.mereka.io")).toBe(
      "https://staging.oriental.mereka.io",
    );
    expect(validatedAdminReleaseOrigin("https://oriental.mereka.io/")).toBe("https://oriental.mereka.io");
    for (const target of [
      "http://staging.oriental.mereka.io",
      "https://staging.oriental.mereka.io:8443",
      "https://oriental.mereka.io:9443",
      "https://user@oriental.mereka.io",
      "https://oriental.mereka.io/admin",
      "https://oriental.mereka.io/?shadow=true",
      "https://oriental.mereka.io/#shadow",
      "https://oriental.deploy.mereka.io",
    ]) {
      expect(() => validatedAdminReleaseOrigin(target), target).toThrow("exact canonical HTTPS Oriental origin");
    }
  });

  it("pins canonical and compatibility-only hostnames", () => {
    expect(RELEASE_TARGETS.production).toEqual({
      origin: "https://oriental.mereka.io",
      legacyOrigin: "https://oriental.deploy.mereka.io",
    });
    expect(RELEASE_TARGETS.staging).toEqual({
      origin: "https://staging.oriental.mereka.io",
      legacyOrigin: "https://oriental-staging.deploy.mereka.io",
    });
  });

  it("requires full immutable release SHAs", () => {
    expect(validateReleaseSha(sha)).toEqual([]);
    expect(validateReleaseSha("bb8e267")).not.toEqual([]);
  });

  it("matches every static preflight contract against the real repository", () => {
    expect(validateReleaseStaticContracts((path) => readFileSync(path, "utf8"))).toEqual([]);
    expect(validateReleaseStaticContracts(() => "")).toHaveLength(4);
  });

  it("fails managed releases that drift from the safe voice cell", () => {
    expect(
      validateManagedVoiceCell({
        VOICE_RUNTIME_PROFILE: CONTROL_VOICE_CELL.runtimeProfile,
        VOICE_MODEL_CELL: CONTROL_VOICE_CELL.modelCell,
        OPENAI_REALTIME_MODEL: CONTROL_VOICE_CELL.model,
        VOICE_REASONING_CELL: CONTROL_VOICE_CELL.reasoningCell,
        VOICE_EMAIL_CAPTURE_MODE: CONTROL_VOICE_CELL.emailCaptureMode,
        VOICE_VARIANT_PICKER: "false",
      }),
    ).toEqual([]);
    expect(
      validateManagedVoiceCell({
        VOICE_RUNTIME_PROFILE: "instant-v1",
        VOICE_MODEL_CELL: "candidate",
        OPENAI_REALTIME_MODEL: "wrong-model",
        VOICE_REASONING_CELL: "minimal",
        VOICE_EMAIL_CAPTURE_MODE: "strict",
        VOICE_VARIANT_PICKER: "true",
      }),
    ).toHaveLength(6);
    expect(
      validateManagedVoiceCell({
        VOICE_RUNTIME_PROFILE: CONTROL_VOICE_CELL.runtimeProfile,
        VOICE_MODEL_CELL: CONTROL_VOICE_CELL.modelCell,
        OPENAI_REALTIME_MODEL: CONTROL_VOICE_CELL.model,
        VOICE_REASONING_CELL: CONTROL_VOICE_CELL.reasoningCell,
        VOICE_EMAIL_CAPTURE_MODE: CONTROL_VOICE_CELL.emailCaptureMode,
      }),
    ).toEqual(["VOICE_VARIANT_PICKER must be explicitly false for the control cell"]);
  });

  it("makes managed cell checks the preflight default", () => {
    expect(releasePreflight).toContain(
      'const args: Args = { managedEnv: true, modelCell: "control", pickerMode: "clean", voiceCellOnly: false }',
    );
    expect(releasePreflight).toContain('--allow-unmanaged"');
  });

  it("scrubs managed application secrets and production mode before preflight tests", () => {
    expect(
      releaseTestEnv({
        HOME: "/tmp/home",
        PATH: "/tmp/bin",
        NODE_ENV: "production",
        NODE_OPTIONS: "--experimental-webstorage --require=/tmp/unsafe.js",
        OPENAI_API_KEY: "live-key",
        SLACK_BOT_TOKEN: "live-token",
        TEAM_LEAD_EMAIL: "live@example.com",
      }),
    ).toEqual({
      HOME: "/tmp/home",
      PATH: "/tmp/bin",
      NODE_ENV: "test",
      NODE_OPTIONS: "--no-experimental-webstorage",
    });
    expect(packageScripts.scripts["release:preflight"]).toContain("tsx scripts/run-release-tests.ts");
    expect(packageScripts.scripts["release:preflight"]).toContain("env NODE_ENV=production pnpm check-secrets");
    expect(releaseRunbook).toContain("-- env NODE_ENV=production pnpm release:preflight");
  });

  it("provides a fast executable Infisical voice-cell parity check", () => {
    const command = ["exec", "tsx", "scripts/release-preflight.ts", "--voice-cell-only"];
    const valid = spawnSync("pnpm", command, {
      encoding: "utf8",
      env: {
        ...process.env,
        VOICE_RUNTIME_PROFILE: "baseline",
        VOICE_MODEL_CELL: "control",
        OPENAI_REALTIME_MODEL: "gpt-realtime-2",
        VOICE_REASONING_CELL: "low",
        VOICE_EMAIL_CAPTURE_MODE: "adaptive",
        VOICE_VARIANT_PICKER: "false",
      },
    });
    expect(valid.status, valid.stderr).toBe(0);

    const missingPicker = spawnSync("pnpm", command, {
      encoding: "utf8",
      env: {
        ...process.env,
        VOICE_RUNTIME_PROFILE: "baseline",
        VOICE_MODEL_CELL: "control",
        OPENAI_REALTIME_MODEL: "gpt-realtime-2",
        VOICE_REASONING_CELL: "low",
        VOICE_EMAIL_CAPTURE_MODE: "adaptive",
        VOICE_VARIANT_PICKER: "",
      },
    });
    expect(missingPicker.status).toBe(1);
    expect(missingPicker.stderr).toContain("VOICE_VARIANT_PICKER must be explicitly false for the control cell");

    const candidate = spawnSync("pnpm", [...command, "--model-cell", "candidate"], {
      encoding: "utf8",
      env: {
        ...process.env,
        VOICE_RUNTIME_PROFILE: "baseline",
        VOICE_MODEL_CELL: "candidate",
        OPENAI_REALTIME_MODEL_CANDIDATE: "gpt-realtime-2.1",
        VOICE_REASONING_CELL: "low",
        VOICE_EMAIL_CAPTURE_MODE: "adaptive",
        VOICE_VARIANT_PICKER: "false",
      },
    });
    expect(candidate.status, candidate.stderr).toBe(0);
    const audition = spawnSync("pnpm", [...command, "--model-cell", "candidate", "--picker-mode", "audition"], {
      encoding: "utf8",
      env: {
        ...process.env,
        VOICE_RUNTIME_PROFILE: "baseline",
        VOICE_MODEL_CELL: "candidate",
        OPENAI_REALTIME_MODEL_CANDIDATE: "gpt-realtime-2.1",
        VOICE_REASONING_CELL: "low",
        VOICE_EMAIL_CAPTURE_MODE: "adaptive",
        VOICE_VARIANT_PICKER: "true",
      },
    });
    expect(audition.status, audition.stderr).toBe(0);
  }, 20_000);

  it("expands the both alias before target lookup", () => {
    expect(releaseVerifier).toContain('args.target === "both" ? ["staging", "production"] : [args.target]');
    expect(releaseVerifier).toContain('stagingModelCell ??= target === "production" ? "control" : "candidate"');
    expect(releaseVerifier).toContain("governedVoiceCell(stagingModelCell, stagingPickerMode)");
    expect(releaseRunbook).toContain("--staging-model-cell candidate --staging-picker-mode clean");
  });

  it("verifies client picker visibility against the governed target cell", () => {
    expect(CONTROL_VOICE_CELL.variantPicker).toBe(false);
    expect(STAGING_CANDIDATE_VOICE_CELL.variantPicker).toBe(false);
    expect(STAGING_CANDIDATE_AUDITION_VOICE_CELL.variantPicker).toBe(true);
    expect(governedVoiceCell("candidate", "clean").variantPicker).toBe(false);
    expect(governedVoiceCell("candidate", "audition").variantPicker).toBe(true);
    expect(releaseVerifier).toContain("const expectedVariantPicker = expectedVoiceCell.variantPicker");
    expect(releaseVerifier).toContain("config.voiceVariantPicker !== expectedVariantPicker");
    expect(releaseVerifier).toContain("voiceVariantPicker: expectedVariantPicker");
    expect(releaseVerifier).not.toContain("config.voiceVariantPicker !== false");
  });

  it("validates the staging promotion boundary against the candidate voice cell", () => {
    expect(productionDeployer).toContain(
      'readPublicHealth(RELEASE_TARGETS.staging.origin, args.sha, "staging candidate", STAGING_CANDIDATE_VOICE_CELL)',
    );
    expect(productionDeployer).toContain('"current production",\n    CONTROL_VOICE_CELL');
    expect(productionDeployer).toContain("await waitForHealthyProductionRelease(");
    expect(productionDeployer).toContain('"new production"');
    expect(productionDeployer).toContain(
      "validateHealthPayload(payload, expectedSha, expectedVoiceCell, validationOptions)",
    );
  });

  it("requires lifecycle migration and a live secondary sweep before web release mutation", () => {
    expect(packageScripts.scripts["convex:backfill:voice-session-lifecycle"]).toBe(
      "tsx scripts/run-command-with-deadline.ts --timeout-ms 600000 -- pnpm exec tsx scripts/backfill-voice-session-lifecycle.ts",
    );
    expect(packageScripts.scripts["release:verify:orphan-sweep"]).toBe(
      "tsx scripts/run-command-with-deadline.ts --timeout-ms 15000 -- pnpm exec tsx scripts/verify-orphan-sweep.ts",
    );
    expect(releaseRunbook).toContain("-- pnpm convex:deploy");
    expect(releaseRunbook).toContain("-- pnpm convex:backfill:voice-session-lifecycle");
    expect(releaseRunbook).toContain("-- pnpm release:verify:orphan-sweep");
    expect(productionDeployer).toContain('execFileSync("pnpm", ["release:verify:orphan-sweep"], {');
    expect(productionDeployer).toContain("timeout: 20_000");
    expect(productionDeployer).toContain('killSignal: "SIGKILL"');
    expect(deadlineRunner).toContain('process.kill(-childGroupPid, "SIGKILL")');
    expect(deadlineRunner).toContain("process.kill(-childGroupPid, 0)");
    expect(deadlineRunner).toContain("Release command leader exited while descendants remained");
    expect(deadlineRunner.indexOf("process.on(signal, handler)")).toBeLessThan(
      deadlineRunner.indexOf("child = spawn(command, commandArgs"),
    );
    expect(lifecycleBackfill).toContain("RPC_DEADLINE_MS = 30_000");
    expect(orphanVerifier).toContain("QUERY_DEADLINE_MS = 5_000");
    expect(hostDeployer.indexOf("pnpm release:verify:orphan-sweep")).toBeLessThan(
      hostDeployer.indexOf("declare -a ssh_command"),
    );
  });

  it("rejects a candidate production scope before credentials, Git, health, or Coolify access", () => {
    const candidate = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/deploy-coolify-production.ts", "--sha", sha, "--expected-current-sha", sha],
      {
        encoding: "utf8",
        timeout: 20_000,
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          NODE_ENV: "test",
          VOICE_RUNTIME_PROFILE: "baseline",
          VOICE_MODEL_CELL: "candidate",
          OPENAI_REALTIME_MODEL_CANDIDATE: "gpt-realtime-2.1",
          VOICE_REASONING_CELL: "low",
          VOICE_EMAIL_CAPTURE_MODE: "adaptive",
          VOICE_VARIANT_PICKER: "true",
        },
      },
    );

    expect(candidate.status).toBe(1);
    expect(candidate.stderr).toContain("production voice cell");
    expect(candidate.stderr).toContain("VOICE_MODEL_CELL must be control");
    expect(candidate.stderr).toContain("VOICE_VARIANT_PICKER must be explicitly false for the control cell");
    expect(candidate.stderr).not.toContain("COOLIFY_API_TOKEN is required");
    expect(candidate.stderr).not.toContain("health returned HTTP");
    expect(candidate.stderr).not.toContain("Coolify ");
  });

  it("uses the documented Coolify deployment trigger and validates its response identity", () => {
    expect(productionDeployer).toMatch(
      /const started = await coolifyRequest<unknown>\(\s*baseUrl,\s*token,\s*`deploy\?uuid=\$\{encodeURIComponent\(applicationUuid\)\}&force=false`,\s*\);/,
    );
    expect(productionDeployer).toContain("deploymentUuidFromDeployResponse(started, applicationUuid)");
    expect(productionDeployer).not.toContain("/start?");
  });

  it("restores the prior Coolify commit and healthy service after a post-pin production failure", () => {
    expect(productionDeployer).toContain("async function restoreProductionRelease");
    expect(productionDeployer).toContain("body: JSON.stringify({ git_commit_sha: previousSha })");
    expect(productionDeployer).toContain("Coolify rollback did not converge after three deployments");
    expect(productionDeployer).toContain("await waitForHealthyProductionRelease(");
    expect(productionDeployer).toContain('"restored production"');
    expect(productionDeployer).toContain("candidate failed; restored previous production");
    expect(productionDeployer.indexOf("releaseMutationAttempted = true")).toBeLessThan(
      productionDeployer.indexOf("body: JSON.stringify({ git_commit_sha: args.sha })"),
    );
  });

  it("reconciles and reads back the complete managed application environment before changing the release SHA", () => {
    expect(productionDeployer).toContain("googlePublicBuildConfigurationFromEnv(process.env)");
    expect(productionDeployer).toContain("managedEnvironmentReconciliationPlan(environment, current)");
    expect(productionDeployer).toContain("managedEnvironmentParityFailures(environment, updated, undefined");
    expect(productionDeployer).toContain("coolifyGoogleEnvironmentFailures(updated, googleExpected,");
    expect(productionDeployer).toContain("path}/bulk");
    expect(productionDeployer).toContain("managedEnvironmentMutationFailures(mutations, acknowledged)");
    expect(productionDeployer.indexOf("await reconcileManagedApplicationEnvironment")).toBeLessThan(
      productionDeployer.indexOf("body: JSON.stringify({ git_commit_sha: args.sha })"),
    );
    const finalCurrentAssertion = productionDeployer.lastIndexOf("await assertCurrentProduction()");
    expect(finalCurrentAssertion).toBeGreaterThan(
      productionDeployer.indexOf("await reconcileManagedApplicationEnvironment"),
    );
    expect(finalCurrentAssertion).toBeLessThan(
      productionDeployer.indexOf("body: JSON.stringify({ git_commit_sha: args.sha })"),
    );
  });

  it("reconciles and reads back the password HMAC as a governed runtime secret", () => {
    const value = "a".repeat(64);
    const env = { ADMIN_REVIEW_PASSWORD_HMAC: value };
    const row = {
      key: "ADMIN_REVIEW_PASSWORD_HMAC",
      value,
      real_value: value,
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_multiline: false,
    };

    expect(managedEnvironmentReconciliationPlan(env, []).mutations).toEqual([
      { key: "ADMIN_REVIEW_PASSWORD_HMAC", value },
    ]);
    expect(managedEnvironmentParityFailures(env, [row])).toEqual([]);
    expect(managedEnvironmentParityFailures(env, [{ ...row, real_value: "b".repeat(64) }])).toContain(
      "ADMIN_REVIEW_PASSWORD_HMAC Coolify value or runtime/build scope does not match Infisical",
    );
  });

  it("proves locked Coolify values through bulk acknowledgement and metadata-only list readback", () => {
    const env = { ADMIN_REVIEW_TOKEN: "governed-secret" };
    const hiddenRow = {
      key: "ADMIN_REVIEW_TOKEN",
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_multiline: false,
    };
    const plan = managedEnvironmentReconciliationPlan(env, [hiddenRow]);
    expect(plan.mutations).toEqual([{ key: "ADMIN_REVIEW_TOKEN", value: "governed-secret" }]);
    expect(
      managedEnvironmentMutationFailures(plan.mutations, [
        { ...hiddenRow, value: "governed-secret", real_value: "governed-secret" },
      ]),
    ).toEqual([]);
    expect(managedEnvironmentMutationFailures(plan.mutations, [hiddenRow])).toEqual([]);
    expect(
      managedEnvironmentMutationFailures(plan.mutations, [
        { ...hiddenRow, value: "wrong-visible-value", real_value: "wrong-visible-value" },
      ]),
    ).toContain("ADMIN_REVIEW_TOKEN bulk update did not acknowledge the governed write and scope");
    expect(managedEnvironmentParityFailures(env, [hiddenRow], undefined, { allowHiddenValues: true })).toEqual([]);
    expect(managedEnvironmentParityFailures(env, [hiddenRow])).toContain(
      "ADMIN_REVIEW_TOKEN Coolify value or runtime/build scope does not match Infisical",
    );
  });

  it("owns the explicit abuse-policy controls and tombstones superseded owner routes", () => {
    expect(MANAGED_APPLICATION_ENVIRONMENT_KEYS).toContain("TURNSTILE_ENFORCEMENT");
    expect(MANAGED_APPLICATION_ENVIRONMENT_KEYS).toContain("VOICE_SESSION_DAILY_LIMIT");
    expect(RETIRED_MANAGED_APPLICATION_ENVIRONMENT_KEYS).toEqual(new Set(["OWNER_AI", "OWNER_CULTURAL"]));

    const staleOwner = {
      key: "OWNER_AI",
      value: "stale@example.test",
      real_value: "stale@example.test",
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_multiline: false,
    };
    expect(managedEnvironmentReconciliationPlan({}, [staleOwner]).mutations).toContainEqual({
      key: "OWNER_AI",
      value: "",
    });
    expect(
      managedEnvironmentReconciliationPlan({ OWNER_AI: "restored@example.test" }, [staleOwner]).mutations,
    ).toContainEqual({
      key: "OWNER_AI",
      value: "restored@example.test",
    });
  });

  it("clears a managed production value retired from Infisical and proves empty parity", () => {
    const retiredRow = {
      key: "CLICKUP_API_TOKEN",
      value: "stale-live-secret",
      real_value: "stale-live-secret",
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_multiline: false,
    };
    const retiredKeys = new Set<ManagedApplicationEnvironmentKey>(["CLICKUP_API_TOKEN"]);
    const plan = managedEnvironmentReconciliationPlan({}, [retiredRow], retiredKeys);

    expect(plan.mutations).toContainEqual({ key: "CLICKUP_API_TOKEN", value: "" });
    expect(plan.failures).toEqual([]);
    expect(managedEnvironmentParityFailures({}, [retiredRow], retiredKeys)).toContain(
      "CLICKUP_API_TOKEN retired Coolify value must be empty with the governed runtime/build scope",
    );
    expect(managedEnvironmentParityFailures({}, [{ ...retiredRow, value: "", real_value: "" }], retiredKeys)).toEqual(
      [],
    );
  });

  it("refuses to infer retirement from an incomplete supplied scope before emitting mutations", () => {
    const liveSecret = {
      key: "REDIS_URL",
      value: "redis://live-value",
      real_value: "redis://live-value",
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: true,
      is_multiline: false,
    };
    const plan = managedEnvironmentReconciliationPlan({}, [liveSecret]);

    expect(plan.mutations).toEqual([]);
    expect(plan.failures).toEqual([
      "REDIS_URL is live in Coolify but missing from the supplied scope; refusing implicit retirement",
    ]);
    expect(productionDeployer.indexOf("if (planFailures.length > 0)")).toBeLessThan(
      productionDeployer.indexOf("if (mutations.length > 0) await assertCurrentProduction()"),
    );
  });

  it("treats Infisical values as concrete literals and rejects expanded runtime drift", () => {
    const env = { SMTP_PASSWORD: "$OTHER_SECRET" };
    const expanded = {
      key: "SMTP_PASSWORD",
      value: "$OTHER_SECRET",
      real_value: "unexpected-expanded-value",
      is_preview: false,
      is_runtime: true,
      is_buildtime: false,
      is_literal: false,
      is_multiline: false,
    };

    expect(managedEnvironmentReconciliationPlan(env, [expanded]).mutations).toContainEqual({
      key: "SMTP_PASSWORD",
      value: "$OTHER_SECRET",
    });
    expect(managedEnvironmentParityFailures(env, [expanded])).toContain(
      "SMTP_PASSWORD Coolify value or runtime/build scope does not match Infisical",
    );
    expect(
      managedEnvironmentParityFailures(env, [{ ...expanded, real_value: "$OTHER_SECRET", is_literal: true }]),
    ).toEqual([]);
    expect(productionDeployer).toContain("is_literal: true");
  });

  it("proves Coolify runtime health and loopback health-check ownership after deployment", () => {
    expect(productionDeployer).toContain('application.status !== "running:healthy"');
    expect(productionDeployer).toContain('application.health_check_host !== "127.0.0.1"');
    expect(productionDeployer).toContain("assertHealthyOrientalApplication(application, expectedSha)");
    expect(productionDeployer).toContain("waitForHealthyProductionRelease");
  });

  it("proves Search Console metadata and consent-gated GA on public but never admin surfaces", () => {
    expect(releaseVerifier).toContain("readGoogleSiteVerification(canonicalHtml)");
    expect(releaseVerifier).toContain("await verifyGoogleAnalyticsConsentBoundary");
    expect(releaseVerifier).toContain('getByRole("button", { name: "Allow analytics" })');
    expect(releaseVerifier).toContain("/admin/session-review");
    expect(releaseVerifier).toContain("googleAnalyticsAdminExcluded: true");
  });

  it("pins the staging voice smoke to the governed candidate instead of public health", () => {
    expect(stagingVoiceSmoke).toContain("const voiceSmokeMode = readVoiceSmokeMode()");
    expect(stagingVoiceSmoke).toContain('const expectedVoiceCell = governedVoiceCell("candidate", voiceSmokeMode)');
    expect(stagingVoiceSmoke).toContain("process.env.EXPECTED_REALTIME_MODEL ?? expectedVoiceCell.model");
    expect(stagingVoiceSmoke).not.toContain("?? health.voice.model");
    expect(stagingVoiceSmoke).not.toContain("?? health.voice.model_cell");
  });

  it("authenticates synthetic probes before connection and durably waits for terminal failures", () => {
    for (const smoke of [stagingVoiceSmoke, stagingIntakeSmoke]) {
      expect(smoke).toContain("createVoiceSmokeProof(smokeSigningSecret)");
      expect(smoke).toContain("VOICE_SMOKE_PROOF_HEADER");
      expect(smoke).toContain("smokeProof: proof");
      expect(smoke).toContain('page.route("**/api/leads"');
      expect(smoke).toContain('route.abort("blockedbyclient")');
      expect(smoke).toContain("attemptedLeadPosts");
    }
    expect(stagingVoiceSmoke).toContain("waitForTerminalDebug(");
    expect(stagingVoiceSmoke).toContain('isDebugSnapshotWithReason(response, "manual")');
    expect(stagingVoiceSmoke).toContain("isTerminalAvailabilityReason(reason)");
    expect(stagingVoiceSmoke).toContain("finalReviewBody.applied !== true");
    expect(stagingIntakeSmoke).toContain("timeout: 60_000");
    expect(stagingIntakeSmoke).toContain("const terminalDebugApplied =");
    expect(stagingIntakeSmoke).toContain("terminalBody.applied === true");
    expect(stagingIntakeSmoke).toContain('input[name="email"]:visible');
    expect(stagingIntakeSmoke).toContain("input.getClientRects().length > 0");
    expect(voiceSessionRoute).toContain("verifyVoiceSmokeProof(");
    expect(voiceSessionRoute).toContain("{ synthetic: syntheticProbe }");
    expect(voiceDebugRoute).toContain("reviewClaims?.synthetic");
    expect(voiceDebugRoute).toContain("VOICE_SMOKE_SYNTHETIC_EMAIL");
    expect(leadsRoute).toContain("voiceReviewClaims?.synthetic");
    expect(leadsRoute).toContain("synthetic_review_forbidden");
  });

  it("keeps the staging picker clear of an unresolved analytics consent panel", () => {
    expect(voicePicker).toContain("useAnalyticsConsentClearance(enabled)");
    expect(voicePicker).toContain("new ResizeObserver(measure)");
    expect(voicePicker).toContain('[aria-label="Analytics privacy choices"]');
    expect(voicePicker).toContain("voice-variant-picker--panel");
    expect(globalStyles).toContain("bottom: calc(1.25rem + var(--voice-picker-consent-clearance, 0px))");
    expect(globalStyles).toContain("100svh - 6.25rem - var(--voice-picker-consent-clearance, 0px)");
  });

  it("requires exact-SHA healthy Convex responses", () => {
    expect(
      validateHealthPayload(
        {
          ok: true,
          version: sha,
          convex: true,
          voice: {
            runtime_profile: "baseline",
            model_cell: "control",
            model: "gpt-realtime-2",
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: false,
          },
        },
        sha,
      ),
    ).toEqual([]);
    expect(
      validateHealthPayload(
        {
          ok: true,
          version: sha,
          convex: true,
          voice: {
            runtime_profile: "baseline",
            model_cell: "candidate",
            model: "gpt-realtime-2.1",
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: false,
          },
        },
        sha,
        STAGING_CANDIDATE_VOICE_CELL,
      ),
    ).toEqual([]);
    expect(
      validateHealthPayload(
        {
          ok: true,
          version: sha,
          convex: true,
          voice: {
            runtime_profile: "baseline",
            model_cell: "candidate",
            model: "gpt-realtime-2.1",
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: true,
          },
        },
        sha,
        STAGING_CANDIDATE_AUDITION_VOICE_CELL,
      ),
    ).toEqual([]);
    expect(validateHealthPayload({ ok: true, version: "wrong", convex: false }, sha)).toHaveLength(3);
  });

  it("allows only current-production migration checks to bridge the legacy missing email mode", () => {
    const legacyHealth = {
      ok: true,
      version: sha,
      convex: true,
      voice: {
        runtime_profile: "baseline",
        model_cell: "control",
        model: "gpt-realtime-2",
        reasoning_cell: "low",
        variant_picker: false,
      },
    };
    expect(validateHealthPayload(legacyHealth, sha)).toEqual(["health voice email_capture_mode must be adaptive"]);
    expect(
      validateHealthPayload(legacyHealth, sha, CONTROL_VOICE_CELL, { allowMissingEmailCaptureMode: true }),
    ).toEqual([]);
    expect(
      validateHealthPayload(
        { ...legacyHealth, voice: { ...legacyHealth.voice, email_capture_mode: "strict" } },
        sha,
        CONTROL_VOICE_CELL,
        { allowMissingEmailCaptureMode: true },
      ),
    ).toEqual(["health voice email_capture_mode must be adaptive"]);
    expect(productionDeployer).toContain(
      '"current production",\n    CONTROL_VOICE_CELL,\n    { allowMissingEmailCaptureMode: true }',
    );
  });

  it("rejects Cloudflare edge response markers", () => {
    expect(hasCloudflareEdgeHeaders(new Headers())).toBe(false);
    expect(hasCloudflareEdgeHeaders(new Headers({ "cf-ray": "abc" }))).toBe(true);
    expect(hasCloudflareEdgeHeaders(new Headers({ server: "cloudflare" }))).toBe(true);
  });
});
