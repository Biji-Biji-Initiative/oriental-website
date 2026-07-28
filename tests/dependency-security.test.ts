import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  pnpm?: {
    overrides?: Record<string, string>;
  };
  scripts?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
const nextConfig = readFileSync("next.config.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("production dependency security", () => {
  it("pins the patched transitive versions required by the production audit", () => {
    expect(manifest.pnpm?.overrides).toMatchObject({
      "brace-expansion@5.0.7": "5.0.8",
      "fast-uri": "3.1.4",
      postcss: "8.5.23",
      sharp: "0.35.3",
    });
  });

  it("keeps the production audit required in CI", () => {
    expect(manifest.scripts?.["audit:prod"]).toBe("pnpm audit --prod --audit-level=high");
    expect(ciWorkflow).toContain("pnpm audit:prod");
  });

  it("copies Sharp platform and libvips assets into standalone output", () => {
    expect(nextConfig).toContain("node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*");
  });
});
