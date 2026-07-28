import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  packageManager?: string;
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
const nextConfig = readFileSync("next.config.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
const resolvedGraph = lockfile.slice(lockfile.indexOf("\npackages:"));

describe("production dependency security", () => {
  it("pins only the exact vulnerable transitive resolutions", () => {
    expect(manifest.pnpm?.overrides).toEqual({
      "brace-expansion@5.0.7": "5.0.8",
      "fast-uri@3.1.3": "3.1.4",
      "postcss@<8.5.18": "8.5.23",
      "sharp@0.34.5": "0.35.3",
    });
  });

  it("proves the frozen graph contains patched and no governed vulnerable resolutions", () => {
    for (const patched of ["brace-expansion@5.0.8:", "fast-uri@3.1.4:", "postcss@8.5.23:", "sharp@0.35.3:"]) {
      expect(resolvedGraph).toContain(patched);
    }
    for (const vulnerable of [
      "brace-expansion@5.0.7:",
      "fast-uri@3.1.3:",
      "postcss@8.4.31:",
      "postcss@8.5.15:",
      "sharp@0.34.5:",
    ]) {
      expect(resolvedGraph).not.toMatch(new RegExp(`^\\s{2}${vulnerable.replaceAll(".", "\\.")}`, "m"));
    }
  });

  it("keeps a reproducible machine-readable production audit required in CI", () => {
    expect(manifest.packageManager).toBe("pnpm@10.33.0");
    expect(manifest.scripts?.["audit:prod"]).toBe("pnpm audit --prod --audit-level=high --json");
    expect(ciWorkflow).toContain("version: 10.33.0");
    expect(ciWorkflow).toContain("pnpm --version");
    expect(ciWorkflow).toContain("pnpm config get registry");
    expect(ciWorkflow).toContain("pnpm audit:prod");
  });

  it("copies Sharp platform and libvips assets into standalone output", () => {
    expect(nextConfig).toContain("node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*");
  });
});
