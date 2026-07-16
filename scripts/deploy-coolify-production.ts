import { execFileSync } from "node:child_process";
import {
  type CoolifyDeployment,
  coolifyApiUrl,
  deploymentCommit,
  deploymentFailed,
  deploymentFinished,
  deploymentStatus,
} from "./lib/coolify-release";
import { RELEASE_TARGETS, validateHealthPayload, validateReleaseSha } from "./lib/release-governance";

const DEFAULT_API_URL = "https://app.coolify.io/api/v1/";
const DEFAULT_APPLICATION_UUID = "mtrl2z6a7zvoyevxvufpntij";

type Args = {
  sha: string;
  expectedCurrentSha: string;
  pollIntervalMs: number;
  timeoutMs: number;
};

type CoolifyApplication = {
  git_branch?: unknown;
  git_commit_sha?: unknown;
  git_repository?: unknown;
  uuid?: unknown;
};

function parseArgs(argv: string[]): Args {
  const normalizedArgv = argv.filter((argument) => argument !== "--");
  let sha = "";
  let expectedCurrentSha = "";
  let pollIntervalMs = 5_000;
  let timeoutMs = 20 * 60_000;
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const flag = normalizedArgv[index];
    const value = normalizedArgv[index + 1];
    if (flag === "--sha") {
      sha = value ?? "";
      index += 1;
    } else if (flag === "--expected-current-sha") {
      expectedCurrentSha = value ?? "";
      index += 1;
    } else if (flag === "--poll-interval-ms") {
      pollIntervalMs = Number(value);
      index += 1;
    } else if (flag === "--timeout-ms") {
      timeoutMs = Number(value);
      index += 1;
    } else if (flag === "--help") {
      process.stdout.write(
        "Usage: pnpm release:deploy:production -- --sha <40-char-sha> --expected-current-sha <40-char-sha>\n",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  const failures = [
    ...validateReleaseSha(sha),
    ...validateReleaseSha(expectedCurrentSha).map((failure) => `expected current ${failure}`),
  ];
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 30_000) {
    failures.push("poll interval must be an integer from 1000 to 30000 ms");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 30 * 60_000) {
    failures.push("timeout must be an integer from 60000 to 1800000 ms");
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  return { sha, expectedCurrentSha, pollIntervalMs, timeoutMs };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertFrozenMainCommit(sha: string) {
  execFileSync("git", ["fetch", "origin", "main", "--quiet"]);
  execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`]);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  } catch {
    throw new Error(`release SHA ${sha} is not an ancestor of origin/main`);
  }
}

async function fetchWithTimeout(url: URL | string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readPublicHealth(origin: string, expectedSha: string, label: string) {
  const response = await fetchWithTimeout(`${origin}/api/health`);
  if (!response.ok) throw new Error(`${label} health returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const failures = validateHealthPayload(payload, expectedSha);
  if (failures.length > 0) throw new Error(`${label} health: ${failures.join("; ")}`);
}

async function coolifyRequest<T>(baseUrl: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const url = coolifyApiUrl(baseUrl, path);
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Coolify ${init?.method ?? "GET"} ${url.pathname} returned HTTP ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function assertOrientalApplication(application: CoolifyApplication, uuid: string) {
  if (application.uuid !== uuid) throw new Error("Coolify returned a different application UUID");
  if (application.git_branch !== "main") throw new Error("Coolify application git_branch must be main");
  if (typeof application.git_repository !== "string" || !application.git_repository.includes("oriental-website")) {
    throw new Error("Coolify application repository must be oriental-website");
  }
}

async function cancelDeployment(baseUrl: string, token: string, deploymentUuid: string) {
  try {
    await coolifyRequest(baseUrl, token, `deployments/${deploymentUuid}/cancel`, { method: "POST" });
  } catch (error) {
    process.stderr.write(
      `release-deploy: deployment cancellation also failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function waitForDeployment(
  baseUrl: string,
  token: string,
  deploymentUuid: string,
  expectedSha: string,
  pollIntervalMs: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  while (Date.now() < deadline) {
    const deployment = await coolifyRequest<CoolifyDeployment>(baseUrl, token, `deployments/${deploymentUuid}`);
    const commit = deploymentCommit(deployment);
    if (commit && commit !== expectedSha) {
      await cancelDeployment(baseUrl, token, deploymentUuid);
      throw new Error(`Coolify deployment resolved commit ${commit}, expected ${expectedSha}`);
    }

    const status = deploymentStatus(deployment);
    if (status !== lastStatus) {
      process.stderr.write(`release-deploy: deployment ${deploymentUuid} status=${status}\n`);
      lastStatus = status;
    }
    if (deploymentFinished(deployment)) {
      if (commit !== expectedSha)
        throw new Error("finished Coolify deployment did not report the full expected commit");
      return deployment;
    }
    if (deploymentFailed(deployment)) throw new Error(`Coolify deployment ended with status ${status}`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await cancelDeployment(baseUrl, token, deploymentUuid);
  throw new Error(`Coolify deployment did not finish within ${timeoutMs} ms`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = requireEnv("COOLIFY_API_TOKEN");
  const baseUrl = process.env.COOLIFY_API_URL?.trim() || DEFAULT_API_URL;
  const applicationUuid = process.env.COOLIFY_ORIENTAL_APPLICATION_UUID?.trim() || DEFAULT_APPLICATION_UUID;

  assertFrozenMainCommit(args.sha);
  await readPublicHealth(RELEASE_TARGETS.staging.origin, args.sha, "staging candidate");
  await readPublicHealth(RELEASE_TARGETS.production.origin, args.expectedCurrentSha, "current production");

  const application = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
  assertOrientalApplication(application, applicationUuid);

  await coolifyRequest(baseUrl, token, `applications/${applicationUuid}`, {
    method: "PATCH",
    body: JSON.stringify({ git_commit_sha: args.sha }),
  });
  const updated = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
  assertOrientalApplication(updated, applicationUuid);
  if (updated.git_commit_sha !== args.sha) throw new Error("Coolify did not persist the frozen git_commit_sha");

  const started = await coolifyRequest<{ deployment_uuid?: unknown }>(
    baseUrl,
    token,
    `applications/${applicationUuid}/start?force=false&instant_deploy=false`,
    { method: "POST" },
  );
  if (typeof started.deployment_uuid !== "string" || started.deployment_uuid.length === 0) {
    throw new Error("Coolify did not return a deployment UUID");
  }

  const deployment = await waitForDeployment(
    baseUrl,
    token,
    started.deployment_uuid,
    args.sha,
    args.pollIntervalMs,
    args.timeoutMs,
  );
  await readPublicHealth(RELEASE_TARGETS.production.origin, args.sha, "new production");
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        sha: args.sha,
        previousSha: args.expectedCurrentSha,
        applicationUuid,
        deploymentUuid: started.deployment_uuid,
        status: deploymentStatus(deployment),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`release-deploy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
