import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProductionReleaseArgs,
  restoreProductionRelease,
  waitForHealthyProductionRelease,
} from "../scripts/deploy-coolify-production";
import { CONTROL_VOICE_CELL } from "../scripts/lib/release-governance";

const applicationUuid = "oriental-app";
const previousSha = "a".repeat(40);

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function application(healthy = false) {
  return {
    uuid: applicationUuid,
    git_branch: "main",
    git_repository: "https://github.com/Biji-Biji-Initiative/oriental-website.git",
    git_commit_sha: previousSha,
    status: healthy ? "running:healthy" : "running:unknown",
    health_check_enabled: healthy,
    health_check_host: healthy ? "127.0.0.1" : undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Coolify production rollback", () => {
  it("requires an explicit flag before accepting a previous control model", () => {
    const sha = "b".repeat(40);
    expect(parseProductionReleaseArgs(["--sha", sha, "--expected-current-sha", previousSha])).toMatchObject({
      allowPreviousControlModel: false,
    });
    expect(
      parseProductionReleaseArgs([
        "--sha",
        sha,
        "--expected-current-sha",
        previousSha,
        "--allow-previous-control-model",
      ]),
    ).toMatchObject({ allowPreviousControlModel: true });
  });

  it("waits for control-plane and public health convergence after a finished deployment", async () => {
    let applicationReads = 0;
    let publicReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        if (url.endsWith(`/applications/${applicationUuid}`)) {
          applicationReads += 1;
          return jsonResponse(application(applicationReads > 1));
        }
        if (url === "https://oriental.mereka.io/api/health") {
          publicReads += 1;
          return jsonResponse({
            ok: true,
            version: previousSha,
            convex: true,
            voice: {
              runtime_profile: "baseline",
              model_cell: "control",
              model: "gpt-realtime-2.1",
              reasoning_cell: "low",
              email_capture_mode: "adaptive",
              variant_picker: false,
            },
          });
        }
        throw new Error(`unexpected request: ${url}`);
      }),
    );

    await expect(
      waitForHealthyProductionRelease(
        "https://coolify.test/api/v1/",
        "operator-token",
        applicationUuid,
        previousSha,
        CONTROL_VOICE_CELL,
        1,
        100,
        "candidate production",
      ),
    ).resolves.toBeUndefined();
    expect(applicationReads).toBe(2);
    expect(publicReads).toBe(1);
  });

  it("converges after ambiguous pin and deploy-trigger responses and proves the restored public SHA", async () => {
    let patchRequests = 0;
    let deployRequests = 0;
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/applications/${applicationUuid}`) && init?.method === "PATCH") {
        patchRequests += 1;
        throw new TypeError("response lost after commit");
      }
      if (url.endsWith(`/applications/${applicationUuid}`)) {
        return jsonResponse(application(deployRequests > 1));
      }
      if (url.includes(`/deploy?uuid=${applicationUuid}`)) {
        deployRequests += 1;
        if (deployRequests === 1) throw new TypeError("response lost after enqueue");
        return jsonResponse({
          deployments: [{ resource_uuid: applicationUuid, deployment_uuid: "rollback-deployment" }],
        });
      }
      if (url.endsWith("/deployments/rollback-deployment")) {
        return jsonResponse({ status: "finished", commit: previousSha });
      }
      if (url === "https://oriental.mereka.io/api/health") {
        return jsonResponse({
          ok: true,
          version: previousSha,
          convex: true,
          voice: {
            runtime_profile: "baseline",
            model_cell: "control",
            model: "gpt-realtime-2.1",
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: false,
          },
        });
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      restoreProductionRelease(
        "https://coolify.test/api/v1/",
        "operator-token",
        applicationUuid,
        previousSha,
        1_000,
        60_000,
      ),
    ).resolves.toBeUndefined();

    expect(patchRequests).toBe(1);
    expect(deployRequests).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oriental.mereka.io/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects a rollback whose control plane is healthy but public ownership is not the previous SHA", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/applications/${applicationUuid}`) && init?.method === "PATCH") return jsonResponse(undefined);
      if (url.endsWith(`/applications/${applicationUuid}`)) return jsonResponse(application(true));
      if (url.includes(`/deploy?uuid=${applicationUuid}`)) {
        return jsonResponse({
          deployments: [{ resource_uuid: applicationUuid, deployment_uuid: "rollback-deployment" }],
        });
      }
      if (url.endsWith("/deployments/rollback-deployment")) {
        return jsonResponse({ status: "finished", commit: previousSha });
      }
      if (url === "https://oriental.mereka.io/api/health") {
        return jsonResponse({ ok: true, version: "b".repeat(40), convex: true, voice: {} });
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      restoreProductionRelease("https://coolify.test/api/v1/", "operator-token", applicationUuid, previousSha, 1, 5),
    ).rejects.toThrow("restored production health");
  });

  it("cancels a stale rollback deployment commit and retries the restored pin", async () => {
    let deployRequests = 0;
    let cancelledStale = false;
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/applications/${applicationUuid}`) && init?.method === "PATCH") {
        return jsonResponse(undefined);
      }
      if (url.endsWith(`/applications/${applicationUuid}`)) return jsonResponse(application(true));
      if (url.includes(`/deploy?uuid=${applicationUuid}`)) {
        deployRequests += 1;
        return jsonResponse({
          deployments: [
            {
              resource_uuid: applicationUuid,
              deployment_uuid: deployRequests === 1 ? "stale-deployment" : "rollback-deployment",
            },
          ],
        });
      }
      if (url.endsWith("/deployments/stale-deployment/cancel")) {
        cancelledStale = true;
        return jsonResponse(undefined);
      }
      if (url.endsWith("/deployments/stale-deployment")) {
        return jsonResponse({ status: "finished", commit: "b".repeat(40) });
      }
      if (url.endsWith("/deployments/rollback-deployment")) {
        return jsonResponse({ status: "finished", commit: previousSha });
      }
      if (url === "https://oriental.mereka.io/api/health") {
        return jsonResponse({
          ok: true,
          version: previousSha,
          convex: true,
          voice: {
            runtime_profile: "baseline",
            model_cell: "control",
            model: "gpt-realtime-2.1",
            reasoning_cell: "low",
            email_capture_mode: "adaptive",
            variant_picker: false,
          },
        });
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      restoreProductionRelease("https://coolify.test/api/v1/", "operator-token", applicationUuid, previousSha, 1, 100),
    ).resolves.toBeUndefined();
    expect(cancelledStale).toBe(true);
    expect(deployRequests).toBe(2);
  });
});
