export type CoolifyDeployment = {
  commit?: unknown;
  deployment_uuid?: unknown;
  status?: unknown;
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
