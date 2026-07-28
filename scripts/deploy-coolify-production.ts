import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CoolifyDeployment,
  coolifyApiUrl,
  deploymentCommit,
  deploymentFailed,
  deploymentFinished,
  deploymentStatus,
  deploymentUuidFromDeployResponse,
} from "./lib/coolify-release";
import {
  type CoolifyEnvironmentVariable,
  coolifyGoogleEnvironmentFailures,
  type GooglePublicBuildConfiguration,
  googlePublicBuildConfigurationFromEnv,
} from "./lib/google-release";
import {
  isManagedBuildTimeEnvironmentKey,
  type ManagedApplicationEnvironmentKey,
  managedEnvironmentMutationFailures,
  managedEnvironmentParityFailures,
  managedEnvironmentReconciliationPlan,
} from "./lib/managed-app-environment";
import {
  CONTROL_VOICE_CELL,
  type GovernedVoiceCell,
  type HealthPayloadValidationOptions,
  RELEASE_TARGETS,
  STAGING_CANDIDATE_VOICE_CELL,
  validateHealthPayload,
  validateManagedVoiceCell,
  validateReleaseSha,
} from "./lib/release-governance";

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
  health_check_enabled?: unknown;
  health_check_host?: unknown;
  status?: unknown;
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

async function readPublicHealth(
  origin: string,
  expectedSha: string,
  label: string,
  expectedVoiceCell: GovernedVoiceCell,
  validationOptions: HealthPayloadValidationOptions = {},
) {
  const response = await fetchWithTimeout(`${origin}/api/health`);
  if (!response.ok) throw new Error(`${label} health returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const failures = validateHealthPayload(payload, expectedSha, expectedVoiceCell, validationOptions);
  if (failures.length > 0) throw new Error(`${label} health: ${failures.join("; ")}`);
}

export async function waitForHealthyProductionRelease(
  baseUrl: string,
  token: string,
  applicationUuid: string,
  expectedSha: string,
  expectedVoiceCell: GovernedVoiceCell,
  pollIntervalMs: number,
  timeoutMs: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error("health convergence was not attempted");
  while (Date.now() < deadline) {
    try {
      const application = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
      assertOrientalApplication(application, applicationUuid);
      assertHealthyOrientalApplication(application, expectedSha);
      await readPublicHealth(RELEASE_TARGETS.production.origin, expectedSha, label, expectedVoiceCell);
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
  }
  throw new Error(`${label} did not converge: ${errorMessage(lastError)}`);
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

function managedEnvironmentPayload(key: ManagedApplicationEnvironmentKey, value: string) {
  return {
    key,
    value,
    is_preview: false,
    // Infisical exports concrete values, never Coolify $KEY references.
    is_literal: true,
    is_multiline: value.includes("\n"),
    is_shown_once: false,
    is_runtime: true,
    is_buildtime: isManagedBuildTimeEnvironmentKey(key),
  } as const;
}

async function reconcileManagedApplicationEnvironment(
  baseUrl: string,
  token: string,
  applicationUuid: string,
  environment: Readonly<Record<string, string | undefined>>,
  googleExpected: GooglePublicBuildConfiguration,
  assertCurrentProduction: () => Promise<void>,
) {
  const path = `applications/${applicationUuid}/envs`;
  const current = await coolifyRequest<CoolifyEnvironmentVariable[]>(baseUrl, token, path);
  const { expected, mutations, failures: planFailures } = managedEnvironmentReconciliationPlan(environment, current);
  if (planFailures.length > 0) {
    throw new Error(`Coolify managed application environment: ${planFailures.join("; ")}`);
  }
  if (mutations.length > 0) await assertCurrentProduction();
  if (mutations.length > 0) {
    const acknowledged = await coolifyRequest<CoolifyEnvironmentVariable[]>(baseUrl, token, `${path}/bulk`, {
      method: "PATCH",
      body: JSON.stringify({ data: mutations.map(({ key, value }) => managedEnvironmentPayload(key, value)) }),
    });
    const acknowledgementFailures = managedEnvironmentMutationFailures(mutations, acknowledged);
    if (acknowledgementFailures.length > 0) {
      throw new Error(`Coolify managed application environment: ${acknowledgementFailures.join("; ")}`);
    }
  }

  const updated = await coolifyRequest<CoolifyEnvironmentVariable[]>(baseUrl, token, path);
  const failures = managedEnvironmentParityFailures(environment, updated, undefined, { allowHiddenValues: true });
  failures.push(...coolifyGoogleEnvironmentFailures(updated, googleExpected, { allowHiddenValues: true }));
  if (failures.length > 0) {
    throw new Error(`Coolify managed application environment: ${failures.join("; ")}`);
  }
  return {
    managedEnvironmentKeys: expected.size,
    retiredEnvironmentKeysCleared: mutations.filter(({ value }) => value === "").length,
  };
}

function assertOrientalApplication(application: CoolifyApplication, uuid: string) {
  if (application.uuid !== uuid) throw new Error("Coolify returned a different application UUID");
  if (application.git_branch !== "main") throw new Error("Coolify application git_branch must be main");
  if (typeof application.git_repository !== "string" || !application.git_repository.includes("oriental-website")) {
    throw new Error("Coolify application repository must be oriental-website");
  }
}

function assertHealthyOrientalApplication(application: CoolifyApplication, expectedSha: string) {
  if (application.git_commit_sha !== expectedSha)
    throw new Error("Coolify application commit does not match release SHA");
  if (application.status !== "running:healthy") throw new Error("Coolify application must report running:healthy");
  if (application.health_check_enabled !== true) throw new Error("Coolify application health check must be enabled");
  if (application.health_check_host !== "127.0.0.1") {
    throw new Error("Coolify application health-check host must be 127.0.0.1");
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
  const voiceCellFailures = validateManagedVoiceCell(process.env, CONTROL_VOICE_CELL);
  if (voiceCellFailures.length > 0) {
    throw new Error(`production voice cell: ${voiceCellFailures.join("; ")}`);
  }
  execFileSync("pnpm", ["release:verify:orphan-sweep"], { stdio: "inherit" });
  const token = requireEnv("COOLIFY_API_TOKEN");
  const baseUrl = process.env.COOLIFY_API_URL?.trim() || DEFAULT_API_URL;
  const applicationUuid = process.env.COOLIFY_ORIENTAL_APPLICATION_UUID?.trim() || DEFAULT_APPLICATION_UUID;
  const googleBuildEnvironment = googlePublicBuildConfigurationFromEnv(process.env);

  assertFrozenMainCommit(args.sha);
  await readPublicHealth(RELEASE_TARGETS.staging.origin, args.sha, "staging candidate", STAGING_CANDIDATE_VOICE_CELL);
  await readPublicHealth(
    RELEASE_TARGETS.production.origin,
    args.expectedCurrentSha,
    "current production",
    CONTROL_VOICE_CELL,
    { allowMissingEmailCaptureMode: true },
  );

  const assertCurrentProduction = async () => {
    const current = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
    assertOrientalApplication(current, applicationUuid);
    assertHealthyOrientalApplication(current, args.expectedCurrentSha);
  };
  await assertCurrentProduction();
  const { managedEnvironmentKeys, retiredEnvironmentKeysCleared } = await reconcileManagedApplicationEnvironment(
    baseUrl,
    token,
    applicationUuid,
    process.env,
    googleBuildEnvironment,
    assertCurrentProduction,
  );

  let deploymentUuid = "";
  let deployment: CoolifyDeployment;
  let releaseMutationAttempted = false;
  try {
    // Re-read the control plane immediately before changing the frozen SHA. The
    // public health proof above cannot detect another operator moving Coolify in
    // the interval between health verification and this mutation.
    await assertCurrentProduction();
    // Set this before the request. A timed-out PATCH is ambiguous: Coolify may
    // have persisted the candidate even though this process saw no response.
    // Every failure after this point must therefore converge back to the prior
    // SHA instead of assuming the mutation did not happen.
    releaseMutationAttempted = true;
    await coolifyRequest(baseUrl, token, `applications/${applicationUuid}`, {
      method: "PATCH",
      body: JSON.stringify({ git_commit_sha: args.sha }),
    });
    const updated = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
    assertOrientalApplication(updated, applicationUuid);
    if (updated.git_commit_sha !== args.sha) throw new Error("Coolify did not persist the frozen git_commit_sha");

    const started = await coolifyRequest<unknown>(
      baseUrl,
      token,
      `deploy?uuid=${encodeURIComponent(applicationUuid)}&force=false`,
    );
    deploymentUuid = deploymentUuidFromDeployResponse(started, applicationUuid);
    deployment = await waitForDeployment(baseUrl, token, deploymentUuid, args.sha, args.pollIntervalMs, args.timeoutMs);
    await waitForHealthyProductionRelease(
      baseUrl,
      token,
      applicationUuid,
      args.sha,
      CONTROL_VOICE_CELL,
      args.pollIntervalMs,
      Math.min(args.timeoutMs, 90_000),
      "new production",
    );
  } catch (error) {
    if (!releaseMutationAttempted) throw error;
    if (deploymentUuid) await cancelDeployment(baseUrl, token, deploymentUuid);
    try {
      await restoreProductionRelease(
        baseUrl,
        token,
        applicationUuid,
        args.expectedCurrentSha,
        args.pollIntervalMs,
        args.timeoutMs,
      );
    } catch (rollbackError) {
      throw new Error(
        `candidate failed and automatic rollback failed: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
      );
    }
    throw new Error(
      `candidate failed; restored previous production ${args.expectedCurrentSha}: ${errorMessage(error)}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        sha: args.sha,
        previousSha: args.expectedCurrentSha,
        applicationUuid,
        deploymentUuid,
        status: deploymentStatus(deployment),
        managedEnvironmentKeys,
        retiredEnvironmentKeysCleared,
        coolifyApplicationStatus: "running:healthy",
        coolifyHealthCheckHost: "127.0.0.1",
        googleBuildEnvironment: "verified",
      },
      null,
      2,
    )}\n`,
  );
}

async function restoreApplicationCommit(baseUrl: string, token: string, applicationUuid: string, previousSha: string) {
  let lastError: unknown = new Error("Coolify rollback pin was not attempted");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await coolifyRequest(baseUrl, token, `applications/${applicationUuid}`, {
        method: "PATCH",
        body: JSON.stringify({ git_commit_sha: previousSha }),
      });
    } catch (error) {
      // The PATCH may have committed before its response was lost. Always read
      // the control plane before deciding whether another attempt is needed.
      lastError = error;
    }

    try {
      const restored = await coolifyRequest<CoolifyApplication>(baseUrl, token, `applications/${applicationUuid}`);
      assertOrientalApplication(restored, applicationUuid);
      if (restored.git_commit_sha === previousSha) return;
      lastError = new Error(`Coolify rollback pin read back ${String(restored.git_commit_sha)}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
  }
  throw new Error(`Coolify did not restore the previous git_commit_sha: ${errorMessage(lastError)}`);
}

async function startRollbackDeployment(baseUrl: string, token: string, applicationUuid: string) {
  let lastError: unknown = new Error("Coolify rollback deployment was not attempted");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const started = await coolifyRequest<unknown>(
        baseUrl,
        token,
        `deploy?uuid=${encodeURIComponent(applicationUuid)}&force=false`,
      );
      return deploymentUuidFromDeployResponse(started, applicationUuid);
    } catch (error) {
      // Re-triggering the same restored SHA is safe. It also closes an
      // ambiguous response where Coolify accepted the first request but the
      // deployment UUID never reached this process.
      lastError = error;
    }
  }
  throw new Error(`Coolify did not start the rollback deployment: ${errorMessage(lastError)}`);
}

export async function restoreProductionRelease(
  baseUrl: string,
  token: string,
  applicationUuid: string,
  previousSha: string,
  pollIntervalMs: number,
  timeoutMs: number,
) {
  process.stderr.write(`release-deploy: restoring previous production ${previousSha}\n`);
  await restoreApplicationCommit(baseUrl, token, applicationUuid, previousSha);
  let lastError: unknown = new Error("rollback deployment was not attempted");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rollbackUuid = await startRollbackDeployment(baseUrl, token, applicationUuid);
      await waitForDeployment(baseUrl, token, rollbackUuid, previousSha, pollIntervalMs, timeoutMs);
      await waitForHealthyProductionRelease(
        baseUrl,
        token,
        applicationUuid,
        previousSha,
        CONTROL_VOICE_CELL,
        pollIntervalMs,
        Math.min(timeoutMs, 90_000),
        "restored production",
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * pollIntervalMs));
    }
  }
  throw new Error(`Coolify rollback did not converge after three deployments: ${errorMessage(lastError)}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href);
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    process.stderr.write(`release-deploy: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
