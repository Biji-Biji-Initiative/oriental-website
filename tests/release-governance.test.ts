import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type ManagedApplicationEnvironmentKey,
  managedEnvironmentParityFailures,
  managedEnvironmentReconciliationPlan,
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
const productionDeployer = readFileSync("scripts/deploy-coolify-production.ts", "utf8");
const stagingVoiceSmoke = readFileSync("scripts/smoke-staging-voice.ts", "utf8");
const releaseRunbook = readFileSync("docs/12-CHAT-RELEASE-RUNBOOK.md", "utf8");
const packageScripts = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

describe("release governance", () => {
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
    expect(productionDeployer).toContain(
      'readPublicHealth(RELEASE_TARGETS.production.origin, args.sha, "new production", CONTROL_VOICE_CELL)',
    );
    expect(productionDeployer).toContain(
      "validateHealthPayload(payload, expectedSha, expectedVoiceCell, validationOptions)",
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

  it("reconciles and reads back the complete managed application environment before changing the release SHA", () => {
    expect(productionDeployer).toContain("googlePublicBuildConfigurationFromEnv(process.env)");
    expect(productionDeployer).toContain("managedEnvironmentReconciliationPlan(environment, current)");
    expect(productionDeployer).toContain("managedEnvironmentParityFailures(environment, updated)");
    expect(productionDeployer).toContain("coolifyGoogleEnvironmentFailures(updated, googleExpected)");
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
    expect(productionDeployer).toContain("assertHealthyOrientalApplication(healthyApplication, args.sha)");
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
