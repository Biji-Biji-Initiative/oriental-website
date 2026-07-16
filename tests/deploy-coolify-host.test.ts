import { readFileSync } from "node:fs";
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

  it("makes direct production deployment an explicit break-glass path", () => {
    expect(deployScript).toContain("--allow-emergency-production");
    expect(deployScript).toContain("Production deploys must use the Coolify API");
    expect(deployScript).toContain('if [[ "$target" == "production" && "$allow_emergency_production" != "true" ]]');
  });
});
