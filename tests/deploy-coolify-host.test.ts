import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deployScript = readFileSync(resolve(process.cwd(), "scripts/deploy-coolify-host.sh"), "utf8");

describe("Coolify host deploy image cells", () => {
  it("accepts only full immutable source SHAs", () => {
    expect(deployScript).toContain('[[ "$sha" =~ ^[0-9a-f]{40}$ ]]');
  });

  it("uses distinct immutable tags for staging and production builds of one SHA", () => {
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:\$\{sha\}"/);
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:staging-\$\{sha\}"/);
  });

  it("requires optimistic concurrency and a host lock for shared staging", () => {
    expect(deployScript).toContain("--expected-current-sha");
    expect(deployScript).toContain('exec 9>"$target_dir/.deploy.lock"');
    expect(deployScript).toContain('current_sha="$(sed -n');
    expect(deployScript).toContain('if [[ "$current_sha" != "$expected_current_sha" ]]');
  });

  it("atomically materializes the governed non-secret voice cell for staging", () => {
    expect(deployScript).toContain('if target == "staging":');
    expect(deployScript).toContain('"VOICE_RUNTIME_PROFILE": "baseline"');
    expect(deployScript).toContain('"VOICE_MODEL_CELL": "control"');
    expect(deployScript).toContain('"VOICE_REASONING_CELL": "low"');
    expect(deployScript).toContain('"VOICE_EMAIL_CAPTURE_MODE": "adaptive"');
    expect(deployScript).toContain('"VOICE_VARIANT_PICKER": "false"');
    expect(deployScript).toContain(`cp -p "$target_dir/.env" "$target_dir/.env.deploy-backup-\${timestamp}"`);
    expect(deployScript).toContain("os.replace(temporary, path)");
    expect(deployScript).not.toContain("compose.write_text");
    expect(deployScript).not.toContain("env_path.write_text");
  });

  it("executes the embedded reconciler without leaving partial files", () => {
    const python = deployScript.match(/<<'PY'\n([\s\S]*?)\nPY\n/)?.[1];
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
      const result = spawnSync("python3", ["-", directory, "app:staging-new", sha, "staging"], {
        input: python,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(resolve(directory, "docker-compose.yaml"), "utf8")).toContain("image: 'app:staging-new'");
      const env = readFileSync(resolve(directory, ".env"), "utf8");
      expect(env).toContain(`SOURCE_COMMIT=${sha}`);
      expect(env).toContain("VOICE_MODEL_CELL=control");
      expect(env).toContain("VOICE_EMAIL_CAPTURE_MODE=adaptive");
      expect(env).toContain("VOICE_VARIANT_PICKER=false");
      expect(env).toContain("UNRELATED=preserved");
      expect(statSync(resolve(directory, "docker-compose.yaml")).mode & 0o777).toBe(0o640);
      expect(statSync(resolve(directory, ".env")).mode & 0o777).toBe(0o600);
      expect(readdirSync(directory).filter((name) => name.startsWith(".") && name !== ".env")).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("makes direct production deployment an explicit break-glass path", () => {
    expect(deployScript).toContain("--allow-emergency-production");
    expect(deployScript).toContain("Production deploys must use the Coolify API");
    expect(deployScript).toContain('if [[ "$target" == "production" && "$allow_emergency_production" != "true" ]]');
  });
});
