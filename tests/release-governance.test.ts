import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTROL_VOICE_CELL,
  hasCloudflareEdgeHeaders,
  RELEASE_TARGETS,
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
      'const args: Args = { managedEnv: true, modelCell: "control", voiceCellOnly: false }',
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
        VOICE_VARIANT_PICKER: "true",
      },
    });
    expect(candidate.status, candidate.stderr).toBe(0);
  }, 20_000);

  it("expands the both alias before target lookup", () => {
    expect(releaseVerifier).toContain('args.target === "both" ? ["staging", "production"] : [args.target]');
    expect(releaseVerifier).toContain('name === "staging" ? governedVoiceCell(stagingModelCell) : CONTROL_VOICE_CELL');
    expect(releaseVerifier).toContain('stagingModelCell ??= target === "production" ? "control" : "candidate"');
  });

  it("verifies client picker visibility against the governed target cell", () => {
    expect(CONTROL_VOICE_CELL.variantPicker).toBe(false);
    expect(STAGING_CANDIDATE_VOICE_CELL.variantPicker).toBe(true);
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

  it("uses the documented Coolify deployment trigger and validates its response identity", () => {
    expect(productionDeployer).toMatch(
      /const started = await coolifyRequest<unknown>\(\s*baseUrl,\s*token,\s*`deploy\?uuid=\$\{encodeURIComponent\(applicationUuid\)\}&force=false`,\s*\);/,
    );
    expect(productionDeployer).toContain("deploymentUuidFromDeployResponse(started, applicationUuid)");
    expect(productionDeployer).not.toContain("/start?");
  });

  it("reconciles and reads back the complete managed application environment before changing the release SHA", () => {
    expect(productionDeployer).toContain("googlePublicBuildConfigurationFromEnv(process.env)");
    expect(productionDeployer).toContain("managedRuntimeEnvironmentFromEnv(environment)");
    expect(productionDeployer).toContain("coolifyGoogleEnvironmentFailures(updated, googleExpected)");
    expect(productionDeployer.indexOf("await reconcileManagedApplicationEnvironment")).toBeLessThan(
      productionDeployer.indexOf("body: JSON.stringify({ git_commit_sha: args.sha })"),
    );
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
    expect(stagingVoiceSmoke).toContain("process.env.EXPECTED_REALTIME_MODEL ?? STAGING_CANDIDATE_VOICE_CELL.model");
    expect(stagingVoiceSmoke).toContain(
      "process.env.EXPECTED_REALTIME_MODEL_CELL ?? STAGING_CANDIDATE_VOICE_CELL.modelCell",
    );
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
            variant_picker: true,
          },
        },
        sha,
        STAGING_CANDIDATE_VOICE_CELL,
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
