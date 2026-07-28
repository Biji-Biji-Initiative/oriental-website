import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectProductionSnapshotKeys,
  governedLockfileProblems,
  governedProductionProblems,
  governedResolutions,
  governedSectionProblems,
  governedSnapshotEdgeProblems,
  snapshotDependencyReference,
} from "./helpers/dependency-lock-audit";

type PackageManifest = {
  packageManager?: string;
  devDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
const nextConfig = readFileSync("next.config.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const lockfile = readFileSync("pnpm-lock.yaml", "utf8");

function lockfileFixture(packages: string, snapshots: string) {
  return `
importers:
  .:
    dependencies: {}
packages:
${packages}
snapshots:
${snapshots}
`;
}

describe("production dependency security", () => {
  it("pins only the exact vulnerable transitive resolutions", () => {
    expect(manifest.pnpm?.overrides).toEqual({
      "brace-expansion@5.0.7": "5.0.8",
      "fast-uri@3.1.3": "3.1.4",
      "postcss@<8.5.18": "8.5.23",
      "sharp@0.34.5": "0.35.3",
    });
  });

  it("parses effective package, snapshot, and dependency-edge resolutions", () => {
    expect(governedSectionProblems(lockfile, "packages")).toEqual([]);
    expect(governedSectionProblems(lockfile, "snapshots")).toEqual([]);
    expect(governedSnapshotEdgeProblems(lockfile)).toEqual([]);
    expect(governedLockfileProblems(lockfile)).toEqual([]);
  });

  it("fails hostile YAML mutations without matching comments or inert strings", () => {
    const safe = lockfileFixture(
      '  "postcss@8.5.23": {}\n  safe-package@1.0.0: {note: "postcss@8.5.17"}',
      "  'postcss@8.5.23': {}\n  # postcss@8.5.17: {}",
    );
    expect(governedLockfileProblems(safe)).toEqual([]);

    for (const section of ["packages", "snapshots"] as const) {
      const packages = section === "packages" ? '  "postcss@8.5.17": {}' : "  postcss@8.5.23: {}";
      const snapshots = section === "snapshots" ? "  'postcss@8.5.17': {}" : "  postcss@8.5.23: {}";
      expect(governedSectionProblems(lockfileFixture(packages, snapshots), section)).toHaveLength(1);
    }

    const vulnerableEdge = lockfileFixture(
      "  brace-expansion@5.0.8: {}\n  minimatch@10.2.5: {}",
      "  brace-expansion@5.0.8: {}\n  minimatch@10.2.5:\n    dependencies:\n      brace-expansion: 5.0.7",
    );
    expect(governedSnapshotEdgeProblems(vulnerableEdge)).toEqual([expect.stringContaining("brace-expansion@5.0.7")]);
  });

  it("walks every production snapshot edge and excludes dev-only legacy ancestry", () => {
    const productionKeys = collectProductionSnapshotKeys(lockfile);
    expect(governedProductionProblems(lockfile)).toEqual([]);
    expect(productionKeys.has("brace-expansion@5.0.8")).toBe(true);
    expect(productionKeys.has("brace-expansion@1.1.15")).toBe(false);
    for (const resolution of governedResolutions) {
      expect([...productionKeys].some((key) => key.startsWith(`${resolution.name}@${resolution.patched}`))).toBe(true);
    }
  });

  it("pins every intended snapshot edge to its patched resolution", () => {
    expect(snapshotDependencyReference(lockfile, "minimatch@10.2.5", "brace-expansion")).toBe("5.0.8");
    expect(snapshotDependencyReference(lockfile, "ajv@8.20.0", "fast-uri")).toBe("3.1.4");
    const nextSnapshot = [...collectProductionSnapshotKeys(lockfile)].find((key) => key.startsWith("next@16.2.12("));
    expect(nextSnapshot).toBeDefined();
    expect(snapshotDependencyReference(lockfile, nextSnapshot as string, "postcss")).toBe("8.5.23");
    expect(snapshotDependencyReference(lockfile, nextSnapshot as string, "sharp")).toMatch(/^0\.35\.3(?:\(|$)/u);
  });

  it("keeps a patched, reproducible machine-readable production audit required in CI", () => {
    expect(manifest.packageManager).toBe("pnpm@10.34.5");
    expect(manifest.devDependencies?.yaml).toBe("2.9.0");
    expect(manifest.devDependencies?.semver).toBe("7.8.5");
    expect(manifest.devDependencies?.["@types/semver"]).toBe("7.7.1");
    expect(manifest.scripts?.["audit:prod"]).toBe("pnpm audit --prod --audit-level=high --json");
    expect(ciWorkflow).toContain("version: 10.34.5");
    expect(ciWorkflow).toContain("pnpm --version");
    expect(ciWorkflow).toContain("pnpm config get registry");
    expect(ciWorkflow).toContain("pnpm audit:prod");
  });

  it("copies Sharp platform and libvips assets into standalone output", () => {
    expect(nextConfig).toContain("node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*");
  });
});
