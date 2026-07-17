import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deployPath = resolve(process.cwd(), "scripts/deploy-coolify-host.sh");
const deployScript = readFileSync(deployPath, "utf8");
const reconcilePath = resolve(process.cwd(), "scripts/reconcile-staging-env.py");

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

describe("Coolify host deploy image cells", () => {
  it("accepts only full immutable source SHAs", () => {
    expect(deployScript).toContain('[[ "$sha" =~ ^[0-9a-f]{40}$ ]]');
  });

  it("uses distinct immutable tags for staging and production builds of one SHA", () => {
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:\$\{sha\}"/);
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:staging-\$\{sha\}"/);
  });

  it("passes the target environment's public analytics values into the immutable image build", () => {
    expect(deployScript).toContain(`ga_measurement_id="\${NEXT_PUBLIC_GA_MEASUREMENT_ID:-}"`);
    expect(deployScript).toContain(`google_site_verification="\${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION:-}"`);
    expect(deployScript).toContain('"NEXT_PUBLIC_GA_MEASUREMENT_ID": ga_measurement_id');
    expect(deployScript).toContain('"NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION": google_site_verification');
    expect(deployScript).toContain(`--build-arg "NEXT_PUBLIC_GA_MEASUREMENT_ID=\${ga_measurement_id}"`);
    expect(deployScript).toContain(`--build-arg "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=\${google_site_verification}"`);
  });

  it("enables the brand-motion build cell only for staging and forces production off", () => {
    expect(deployScript).toContain('brand_motion_preview="false"');
    expect(deployScript).toContain('if [[ "$target" == "staging" ]]');
    expect(deployScript).toContain('brand_motion_preview="true"');
    expect(deployScript).toContain(`--build-arg "NEXT_PUBLIC_BRAND_MOTION_PREVIEW=\${brand_motion_preview}"`);
    expect(deployScript).toContain('"NEXT_PUBLIC_BRAND_MOTION_PREVIEW": "true" if target == "staging" else "false"');
  });

  it("requires optimistic concurrency and a host lock for shared staging", () => {
    expect(deployScript).toContain("--expected-current-sha");
    expect(deployScript).toContain('exec 9>"$target_dir/.deploy.lock"');
    expect(deployScript).toContain('current_sha="$(sed -n');
    expect(deployScript).toContain('if [[ "$current_sha" != "$expected_current_sha" ]]');
  });

  it("restores host ownership and recreates the previous service after any post-mutation failure", () => {
    expect(deployScript).toContain("deployment_mutated=true");
    expect(deployScript).toContain("trap on_exit EXIT");
    expect(deployScript).toContain('restore_file_atomically "$backup_compose" "$target_dir/docker-compose.yaml"');
    expect(deployScript).toContain('restore_file_atomically "$backup_env" "$target_dir/.env"');
    expect(deployScript).toContain('if ! docker compose -p "$compose_project" up -d --no-deps --force-recreate; then');
    expect(deployScript).toContain('payload.get("version") == os.environ["EXPECTED_SHA"]');
    expect(deployScript).toContain('payload.get("ok") is True');
    expect(deployScript).toContain('if [[ "$rollback_failed" == "false" ]] && ! wait_for_public_sha');
    expect(deployScript).toContain("AUTOMATIC HOST ROLLBACK FAILED; state is unknown");
    expect(deployScript.lastIndexOf("deployment_mutated=false")).toBeGreaterThan(
      deployScript.indexOf('payload.get("version") == os.environ["EXPECTED_SHA"]'),
    );
  });

  it("executes the remote rollback path, restores both files, recreates the old image, and proves its SHA", () => {
    const remote = deployScript.match(/<<'REMOTE'\n([\s\S]*?)\nREMOTE\n/)?.[1];
    expect(remote).toBeTruthy();
    const root = mkdtempSync(resolve(tmpdir(), "oriental-host-rollback-test-"));
    const fakeBin = resolve(root, "bin");
    const cache = resolve(root, "cache");
    const production = resolve(root, "production");
    const staging = resolve(root, "staging");
    const dockerLog = resolve(root, "docker.log");
    const previousSha = "a".repeat(40);
    const candidateSha = "b".repeat(40);
    mkdirSync(fakeBin);
    mkdirSync(production);
    mkdirSync(staging);
    writeFileSync(resolve(staging, "docker-compose.yaml"), "services:\n  app:\n    image: 'app:old'\n");
    writeFileSync(resolve(staging, ".env"), `SOURCE_COMMIT=${previousSha}\nGIT_SHA=${previousSha}\n`);
    writeExecutable(
      resolve(fakeBin, "git"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" clone --bare "* ]]; then
  mkdir -p "\${@: -1}"
elif [[ " $* " == *" worktree add "* ]]; then
  previous=""
  for argument in "$@"; do
    if [[ "$previous" == "--detach" ]]; then mkdir -p "$argument"; break; fi
    previous="$argument"
  done
fi
`,
    );
    writeExecutable(
      resolve(fakeBin, "docker"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "compose" ]]; then
  sha="$(sed -n 's/^SOURCE_COMMIT=//p' .env | tail -1)"
  image="$(sed -n "s/^[[:space:]]*image:[[:space:]]*'\\([^']*\\)'.*/\\1/p" docker-compose.yaml | head -1)"
  printf '%s|%s\n' "$sha" "$image" >> "$TEST_DOCKER_LOG"
fi
exit 0
`,
    );
    writeExecutable(resolve(fakeBin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(
      resolve(fakeBin, "curl"),
      `#!/usr/bin/env bash
printf '{"ok":true,"version":"%s"}\n' "$TEST_PREVIOUS_SHA"
`,
    );

    try {
      const result = spawnSync(
        "bash",
        [
          "-s",
          "--",
          "staging",
          candidateSha,
          "app",
          "https://example.test/oriental.git",
          cache,
          production,
          staging,
          previousSha,
          "candidate",
          "clean",
          "G-ABC123DEF4",
          "a".repeat(32),
        ],
        {
          input: remote,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            TEST_DOCKER_LOG: dockerLog,
            TEST_PREVIOUS_SHA: previousSha,
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`did not prove candidate SHA ${candidateSha}; rolling back`);
      expect(result.stderr).toContain(`Automatic host rollback restored and proved ${previousSha}`);
      expect(result.stderr).not.toContain("AUTOMATIC HOST ROLLBACK FAILED");
      expect(readFileSync(resolve(staging, ".env"), "utf8")).toContain(`SOURCE_COMMIT=${previousSha}`);
      expect(readFileSync(resolve(staging, "docker-compose.yaml"), "utf8")).toContain("image: 'app:old'");
      expect(readFileSync(dockerLog, "utf8").trim().split("\n")).toEqual([
        `${candidateSha}|app:staging-${candidateSha}`,
        `${previousSha}|app:old`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically materializes the selected governed non-secret voice cell for staging", () => {
    expect(deployScript).toContain('if target == "staging":');
    expect(deployScript).toContain('"VOICE_RUNTIME_PROFILE": "baseline"');
    expect(deployScript).toContain('"VOICE_MODEL_CELL": voice_model_cell');
    expect(deployScript).toContain('"VOICE_REASONING_CELL": "low"');
    expect(deployScript).toContain('"VOICE_EMAIL_CAPTURE_MODE": "adaptive"');
    expect(deployScript).toContain('"VOICE_VARIANT_PICKER": "true" if voice_picker_mode == "audition" else "false"');
    expect(deployScript).toContain("NEXT_PUBLIC_BRAND_MOTION_PREVIEW");
    expect(deployScript).toContain('backup_env="$target_dir/.env.deploy-backup-$' + '{timestamp}"');
    expect(deployScript).toContain('cp -p "$target_dir/.env" "$backup_env"');
    expect(deployScript).toContain("os.replace(temporary, path)");
    expect(deployScript).not.toContain("compose.write_text");
    expect(deployScript).not.toContain("env_path.write_text");
  });

  it("executes the embedded reconciler without leaving partial files", () => {
    const python = [...deployScript.matchAll(/<<'PY'\n([\s\S]*?)\nPY\n/g)]
      .map((match) => match[1])
      .find((source) => source?.includes("app_dir = Path(sys.argv[1])"));
    expect(python).toBeTruthy();
    const directory = mkdtempSync(resolve(tmpdir(), "oriental-deploy-test-"));
    const sha = "a".repeat(40);
    try {
      writeFileSync(resolve(directory, "docker-compose.yaml"), "services:\n  app:\n    image: 'old:image'\n");
      writeFileSync(
        resolve(directory, ".env"),
        "SOURCE_COMMIT=old\nGIT_SHA=old\nVOICE_MODEL_CELL=candidate\nUNRELATED=preserved\n",
      );
      chmodSync(resolve(directory, "docker-compose.yaml"), 0o640);
      chmodSync(resolve(directory, ".env"), 0o600);
      const result = spawnSync(
        "python3",
        ["-", directory, "app:staging-new", sha, "staging", "candidate", "clean", "G-ABC123DEF4", "a".repeat(32)],
        {
          input: python,
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(resolve(directory, "docker-compose.yaml"), "utf8")).toContain("image: 'app:staging-new'");
      const env = readFileSync(resolve(directory, ".env"), "utf8");
      expect(env).toContain(`SOURCE_COMMIT=${sha}`);
      expect(env).toContain("VOICE_MODEL_CELL=candidate");
      expect(env).toContain("VOICE_EMAIL_CAPTURE_MODE=adaptive");
      expect(env).toContain("VOICE_VARIANT_PICKER=false");
      expect(env).toContain("NEXT_PUBLIC_GA_MEASUREMENT_ID=G-ABC123DEF4");
      expect(env).toContain(`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${"a".repeat(32)}`);
      expect(env).toContain("NEXT_PUBLIC_BRAND_MOTION_PREVIEW=true");
      expect(env).toContain("UNRELATED=preserved");
      expect(statSync(resolve(directory, "docker-compose.yaml")).mode & 0o777).toBe(0o640);
      expect(statSync(resolve(directory, ".env")).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory).filter((name) => name.startsWith(".") && name !== ".env")).toEqual([]);

      const audition = spawnSync(
        "python3",
        [
          "-",
          directory,
          "app:staging-audition",
          sha,
          "staging",
          "candidate",
          "audition",
          "G-ABC123DEF4",
          "a".repeat(32),
        ],
        { input: python, encoding: "utf8" },
      );
      expect(audition.status, audition.stderr).toBe(0);
      expect(readFileSync(resolve(directory, ".env"), "utf8")).toContain("VOICE_VARIANT_PICKER=true");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the native or Windows Tailscale client without splitting executable paths", () => {
    expect(deployScript).toContain('ssh_command=("$(command -v tailscale)" ssh)');
    expect(deployScript).toContain('ssh_command=("$(command -v tailscale.exe)" ssh)');
    expect(deployScript).toContain(`"\${ssh_command[@]}" "$remote_host"`);
  });

  it("streams the complete Infisical staging scope and converges managed keys atomically", () => {
    expect(deployScript).toContain("--path /deploy/oriental-website");
    expect(deployScript).toContain("--format dotenv");
    expect(deployScript).toContain(`| "\${ssh_command[@]}" "$remote_host" "$reconcile_command"`);
    expect(deployScript).toContain('"$staging_dir" "$expected_current_sha"');

    const directory = mkdtempSync(resolve(tmpdir(), "oriental-env-sync-test-"));
    try {
      writeFileSync(resolve(directory, ".env"), "SOURCE_COMMIT=old\nOLD_MANAGED=retired\nUNRELATED=preserved\n");
      writeFileSync(resolve(directory, ".infisical-managed-keys"), "OLD_MANAGED\n");
      chmodSync(resolve(directory, ".env"), 0o600);
      const result = spawnSync("python3", [reconcilePath, directory], {
        input: "OPENAI_API_KEY='managed-value'\nNEXT_PUBLIC_GA_MEASUREMENT_ID=G-ABC123DEF4\n",
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const env = readFileSync(resolve(directory, ".env"), "utf8");
      expect(env).toContain("OPENAI_API_KEY='managed-value'");
      expect(env).toContain("NEXT_PUBLIC_GA_MEASUREMENT_ID=G-ABC123DEF4");
      expect(env).toContain("UNRELATED=preserved");
      expect(env).not.toContain("OLD_MANAGED");
      expect(statSync(resolve(directory, ".env")).mode & 0o777).toBe(0o600);
      expect(statSync(resolve(directory, ".infisical-managed-keys")).mode & 0o777).toBe(0o600);

      const moved = spawnSync("python3", [reconcilePath, directory, "b".repeat(40)], {
        input: "OPENAI_API_KEY='new-value'\n",
        encoding: "utf8",
      });
      expect(moved.status).not.toBe(0);
      expect(moved.stderr).toContain("staging moved before Infisical reconciliation");
      expect(readFileSync(resolve(directory, ".env"), "utf8")).toContain("OPENAI_API_KEY='managed-value'");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("makes direct production deployment an explicit break-glass path", () => {
    expect(deployScript).toContain("--allow-emergency-production");
    expect(deployScript).toContain("Production deploys must use the Coolify API");
    expect(deployScript).toContain('if [[ "$target" == "production" && "$allow_emergency_production" != "true" ]]');
  });

  it("rejects the candidate model cell for every production host path", () => {
    const result = spawnSync(
      "bash",
      [
        deployPath,
        "--target",
        "production",
        "--expected-current-sha",
        "a".repeat(40),
        "--voice-model-cell",
        "candidate",
        "--allow-emergency-production",
        "b".repeat(40),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Production host deployment forbids the candidate model cell");
  });

  it("rejects audition mode for every production host path", () => {
    const result = spawnSync(
      "bash",
      [
        deployPath,
        "--target",
        "production",
        "--expected-current-sha",
        "a".repeat(40),
        "--voice-picker-mode",
        "audition",
        "--allow-emergency-production",
        "b".repeat(40),
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Production host deployment forbids voice audition mode");
  });
});
