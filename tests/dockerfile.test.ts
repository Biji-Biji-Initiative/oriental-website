import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");

describe("production Docker image", () => {
  it("binds the standalone server to every container interface", () => {
    const runnerStage = dockerfile.split("FROM node:22-alpine AS runner")[1];

    expect(runnerStage).toBeDefined();
    expect(runnerStage).toContain('ENV HOSTNAME="0.0.0.0"');
  });

  it("makes analytics and Search Console values available at Next build time", () => {
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""');
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID");
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=""');
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=$NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION");
    expect(dockerfile).toContain('ARG NEXT_PUBLIC_BRAND_MOTION_PREVIEW="false"');
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_BRAND_MOTION_PREVIEW=$NEXT_PUBLIC_BRAND_MOTION_PREVIEW");
  });
});
