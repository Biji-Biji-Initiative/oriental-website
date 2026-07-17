export type CoolifyDeployment = {
  commit?: unknown;
  deployment_uuid?: unknown;
  status?: unknown;
};

type CoolifyDeployResponse = {
  deployments?: unknown;
};

type CoolifyStartedDeployment = {
  deployment_uuid?: unknown;
  resource_uuid?: unknown;
};

export function normalizeCoolifyApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("COOLIFY_API_URL must use HTTPS");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url.toString();
}

export function coolifyApiUrl(baseUrl: string, path: string): URL {
  return new URL(path.replace(/^\//, ""), normalizeCoolifyApiBaseUrl(baseUrl));
}

export function deploymentUuidFromDeployResponse(payload: unknown, expectedResourceUuid: string): string {
  if (!expectedResourceUuid) throw new Error("expected Coolify resource UUID must not be empty");
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Coolify deploy response must be an object");
  }

  const deployments = (payload as CoolifyDeployResponse).deployments;
  if (!Array.isArray(deployments)) throw new Error("Coolify deploy response must include a deployments array");

  const matchingDeployments = deployments.filter(
    (deployment): deployment is CoolifyStartedDeployment =>
      typeof deployment === "object" &&
      deployment !== null &&
      !Array.isArray(deployment) &&
      (deployment as CoolifyStartedDeployment).resource_uuid === expectedResourceUuid,
  );
  if (matchingDeployments.length === 0) {
    throw new Error(`Coolify deploy response did not include resource UUID ${expectedResourceUuid}`);
  }
  if (matchingDeployments.length !== 1) {
    throw new Error(`Coolify deploy response included duplicate resource UUID ${expectedResourceUuid}`);
  }

  const matchingDeployment = matchingDeployments[0];
  if (!matchingDeployment) {
    throw new Error(`Coolify deploy response did not include resource UUID ${expectedResourceUuid}`);
  }
  const deploymentUuid = matchingDeployment.deployment_uuid;
  if (typeof deploymentUuid !== "string" || deploymentUuid.trim().length === 0) {
    throw new Error("Coolify deploy response did not include a deployment UUID");
  }
  return deploymentUuid;
}

export function deploymentCommit(deployment: CoolifyDeployment): string | undefined {
  return typeof deployment.commit === "string" && deployment.commit.length > 0 ? deployment.commit : undefined;
}

export function deploymentStatus(deployment: CoolifyDeployment): string {
  return typeof deployment.status === "string" ? deployment.status.toLowerCase() : "unknown";
}

export function deploymentFinished(deployment: CoolifyDeployment): boolean {
  return deploymentStatus(deployment) === "finished";
}

export function deploymentFailed(deployment: CoolifyDeployment): boolean {
  const status = deploymentStatus(deployment);
  return status.startsWith("failed") || status.startsWith("cancelled");
}
