import { afterEach, describe, expect, it } from "vitest";
import { isProductionEnv, readEnv, unwrapEnvValue } from "@/lib/env";

const originalEnv = process.env;

describe("env helpers", () => {
  afterEach(() => {
    process.env = originalEnv;
  });

  it("unwraps quoted values exported from secret managers", () => {
    expect(unwrapEnvValue("'https://example.com'")).toBe("https://example.com");
    expect(unwrapEnvValue('"gpt-realtime-2"')).toBe("gpt-realtime-2");
  });

  it("reads sanitized process env values", () => {
    process.env = { ...originalEnv, CONVEX_URL: "'https://convex.example'" };

    expect(readEnv("CONVEX_URL")).toBe("https://convex.example");
  });

  it("normalizes NODE_ENV checks", () => {
    process.env = { ...originalEnv };
    (process.env as Record<string, string>).NODE_ENV = "'production'";

    expect(isProductionEnv()).toBe(true);
  });
});
