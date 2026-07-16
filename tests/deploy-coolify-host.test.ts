import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deployScript = readFileSync(resolve(process.cwd(), "scripts/deploy-coolify-host.sh"), "utf8");

describe("Coolify host deploy image cells", () => {
  it("uses distinct immutable tags for staging and production builds of one SHA", () => {
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:\$\{sha\}"/);
    expect(deployScript).toMatch(/image="\$\{app_uuid\}:staging-\$\{sha\}"/);
  });
});
