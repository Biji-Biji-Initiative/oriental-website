import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");

describe("production Docker image", () => {
  it("binds the standalone server to every container interface", () => {
    const runnerStage = dockerfile.split("FROM node:22-alpine AS runner")[1];

    expect(runnerStage).toBeDefined();
    expect(runnerStage).toContain('ENV HOSTNAME="0.0.0.0"');
  });
});
