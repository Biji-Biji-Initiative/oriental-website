import { describe, expect, it } from "vitest";
import {
  coolifyApiUrl,
  deploymentCommit,
  deploymentFailed,
  deploymentFinished,
  deploymentStatus,
  normalizeCoolifyApiBaseUrl,
} from "../scripts/lib/coolify-release";

describe("Coolify exact-SHA release contracts", () => {
  it("normalizes the official API base and joins paths", () => {
    expect(normalizeCoolifyApiBaseUrl("https://app.coolify.io/api/v1")).toBe("https://app.coolify.io/api/v1/");
    expect(coolifyApiUrl("https://app.coolify.io/api/v1", "/applications/app-1").toString()).toBe(
      "https://app.coolify.io/api/v1/applications/app-1",
    );
  });

  it("rejects insecure API origins", () => {
    expect(() => normalizeCoolifyApiBaseUrl("http://app.coolify.io/api/v1")).toThrow("must use HTTPS");
  });

  it("requires exact deployment commits", () => {
    expect(deploymentCommit({ commit: "a".repeat(40) })).toBe("a".repeat(40));
    expect(deploymentCommit({ commit: "" })).toBeUndefined();
    expect(deploymentCommit({ commit: 42 })).toBeUndefined();
  });

  it("classifies terminal deployment states", () => {
    expect(deploymentStatus({ status: "IN_PROGRESS" })).toBe("in_progress");
    expect(deploymentFinished({ status: "finished" })).toBe(true);
    expect(deploymentFailed({ status: "failed" })).toBe(true);
    expect(deploymentFailed({ status: "failed:healthcheck" })).toBe(true);
    expect(deploymentFailed({ status: "cancelled-by-user" })).toBe(true);
    expect(deploymentFailed({ status: "in_progress" })).toBe(false);
  });
});
