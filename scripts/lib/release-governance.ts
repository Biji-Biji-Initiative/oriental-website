export const CONTROL_VOICE_CELL = {
  runtimeProfile: "baseline",
  modelCell: "control",
  reasoningCell: "low",
} as const;

export const RELEASE_TARGETS = {
  staging: {
    origin: "https://staging.oriental.mereka.io",
    legacyOrigin: "https://oriental-staging.deploy.mereka.io",
  },
  production: {
    origin: "https://oriental.mereka.io",
    legacyOrigin: "https://oriental.deploy.mereka.io",
  },
} as const;

export type ReleaseTargetName = keyof typeof RELEASE_TARGETS;

export function validateReleaseSha(value: string): string[] {
  return /^[0-9a-f]{40}$/.test(value) ? [] : ["release SHA must be a full 40-character lowercase git SHA"];
}

export function validateManagedVoiceCell(env: Record<string, string | undefined>): string[] {
  const failures: string[] = [];
  if (env.VOICE_RUNTIME_PROFILE !== CONTROL_VOICE_CELL.runtimeProfile) {
    failures.push(`VOICE_RUNTIME_PROFILE must be ${CONTROL_VOICE_CELL.runtimeProfile}`);
  }
  if (env.VOICE_MODEL_CELL !== CONTROL_VOICE_CELL.modelCell) {
    failures.push(`VOICE_MODEL_CELL must be ${CONTROL_VOICE_CELL.modelCell}`);
  }
  if (env.VOICE_REASONING_CELL !== CONTROL_VOICE_CELL.reasoningCell) {
    failures.push(`VOICE_REASONING_CELL must be ${CONTROL_VOICE_CELL.reasoningCell}`);
  }
  if (env.VOICE_VARIANT_PICKER === "true") {
    failures.push("VOICE_VARIANT_PICKER must be false for a governed release");
  }
  return failures;
}

export function validateHealthPayload(payload: unknown, expectedSha: string): string[] {
  if (!payload || typeof payload !== "object") return ["health response must be an object"];
  const health = payload as Record<string, unknown>;
  const failures: string[] = [];
  if (health.ok !== true) failures.push("health response ok must be true");
  if (health.version !== expectedSha) failures.push(`health response version must equal ${expectedSha}`);
  if (health.convex !== true) failures.push("health response convex must be true");
  return failures;
}

export function hasCloudflareEdgeHeaders(headers: Headers): boolean {
  const server = headers.get("server")?.toLowerCase();
  return Boolean(headers.get("cf-ray") || headers.get("cf-cache-status") || server?.includes("cloudflare"));
}
