import { describe, expect, it } from "vitest";
import {
  coolifyApiUrl,
  deploymentCommit,
  deploymentFailed,
  deploymentFinished,
  deploymentStatus,
  deploymentUuidFromDeployResponse,
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

  it("extracts the deployment UUID for the exact requested resource", () => {
    expect(
      deploymentUuidFromDeployResponse(
        {
          deployments: [
            { resource_uuid: "another-app", deployment_uuid: "deployment-1" },
            { resource_uuid: "oriental-app", deployment_uuid: "deployment-2" },
          ],
        },
        "oriental-app",
      ),
    ).toBe("deployment-2");
  });

  it("rejects malformed Coolify deploy responses", () => {
    expect(() => deploymentUuidFromDeployResponse(null, "oriental-app")).toThrow("must be an object");
    expect(() => deploymentUuidFromDeployResponse({}, "oriental-app")).toThrow("deployments array");
    expect(() => deploymentUuidFromDeployResponse({ deployments: {} }, "oriental-app")).toThrow("deployments array");
    expect(() => deploymentUuidFromDeployResponse({ deployments: [] }, "oriental-app")).toThrow(
      "did not include resource UUID oriental-app",
    );
  });

  it("rejects mismatched, duplicate, and empty deployment identities", () => {
    expect(() =>
      deploymentUuidFromDeployResponse(
        { deployments: [{ resource_uuid: "wrong-app", deployment_uuid: "deployment-1" }] },
        "oriental-app",
      ),
    ).toThrow("did not include resource UUID oriental-app");
    expect(() =>
      deploymentUuidFromDeployResponse(
        {
          deployments: [
            { resource_uuid: "oriental-app", deployment_uuid: "deployment-1" },
            { resource_uuid: "oriental-app", deployment_uuid: "deployment-2" },
          ],
        },
        "oriental-app",
      ),
    ).toThrow("duplicate resource UUID oriental-app");
    expect(() =>
      deploymentUuidFromDeployResponse(
        { deployments: [{ resource_uuid: "oriental-app", deployment_uuid: "" }] },
        "oriental-app",
      ),
    ).toThrow("did not include a deployment UUID");
    expect(() =>
      deploymentUuidFromDeployResponse(
        { deployments: [{ resource_uuid: "oriental-app", deployment_uuid: "   " }] },
        "oriental-app",
      ),
    ).toThrow("did not include a deployment UUID");
    expect(() =>
      deploymentUuidFromDeployResponse(
        { deployments: [{ resource_uuid: "oriental-app", deployment_uuid: 42 }] },
        "oriental-app",
      ),
    ).toThrow("did not include a deployment UUID");
    expect(() => deploymentUuidFromDeployResponse({ deployments: [] }, "")).toThrow(
      "expected Coolify resource UUID must not be empty",
    );
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
