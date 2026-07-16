import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTROL_VOICE_CELL,
  hasCloudflareEdgeHeaders,
  RELEASE_TARGETS,
  validateHealthPayload,
  validateManagedVoiceCell,
  validateReleaseSha,
  validateReleaseStaticContracts,
} from "../scripts/lib/release-governance";

const sha = "bb8e2673e5f129f342fba78f3eb653a54de8763b";
const releasePreflight = readFileSync("scripts/release-preflight.ts", "utf8");
const releaseVerifier = readFileSync("scripts/release-verify.ts", "utf8");

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
        VOICE_REASONING_CELL: CONTROL_VOICE_CELL.reasoningCell,
        VOICE_EMAIL_CAPTURE_MODE: CONTROL_VOICE_CELL.emailCaptureMode,
        VOICE_VARIANT_PICKER: "false",
      }),
    ).toEqual([]);
    expect(
      validateManagedVoiceCell({
        VOICE_RUNTIME_PROFILE: "instant-v1",
        VOICE_MODEL_CELL: "candidate",
        VOICE_REASONING_CELL: "minimal",
        VOICE_EMAIL_CAPTURE_MODE: "strict",
        VOICE_VARIANT_PICKER: "true",
      }),
    ).toHaveLength(5);
    expect(
      validateManagedVoiceCell({
        VOICE_RUNTIME_PROFILE: CONTROL_VOICE_CELL.runtimeProfile,
        VOICE_MODEL_CELL: CONTROL_VOICE_CELL.modelCell,
        VOICE_REASONING_CELL: CONTROL_VOICE_CELL.reasoningCell,
        VOICE_EMAIL_CAPTURE_MODE: CONTROL_VOICE_CELL.emailCaptureMode,
      }),
    ).toEqual(["VOICE_VARIANT_PICKER must be explicitly false for a governed release"]);
  });

  it("makes managed cell checks the preflight default", () => {
    expect(releasePreflight).toContain("const args: Args = { managedEnv: true, voiceCellOnly: false }");
    expect(releasePreflight).toContain('--allow-unmanaged"');
  });

  it("provides a fast executable Infisical voice-cell parity check", () => {
    const command = ["exec", "tsx", "scripts/release-preflight.ts", "--voice-cell-only"];
    const valid = spawnSync("pnpm", command, {
      encoding: "utf8",
      env: {
        ...process.env,
        VOICE_RUNTIME_PROFILE: "baseline",
        VOICE_MODEL_CELL: "control",
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
        VOICE_REASONING_CELL: "low",
        VOICE_EMAIL_CAPTURE_MODE: "adaptive",
        VOICE_VARIANT_PICKER: "",
      },
    });
    expect(missingPicker.status).toBe(1);
    expect(missingPicker.stderr).toContain("VOICE_VARIANT_PICKER must be explicitly false");
  });

  it("expands the both alias before target lookup", () => {
    expect(releaseVerifier).toContain('args.target === "both" ? ["staging", "production"] : [args.target]');
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
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: false,
          },
        },
        sha,
      ),
    ).toEqual([]);
    expect(validateHealthPayload({ ok: true, version: "wrong", convex: false }, sha)).toHaveLength(3);
  });

  it("rejects Cloudflare edge response markers", () => {
    expect(hasCloudflareEdgeHeaders(new Headers())).toBe(false);
    expect(hasCloudflareEdgeHeaders(new Headers({ "cf-ray": "abc" }))).toBe(true);
    expect(hasCloudflareEdgeHeaders(new Headers({ server: "cloudflare" }))).toBe(true);
  });
});
