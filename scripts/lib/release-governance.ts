export const CONTROL_VOICE_CELL = {
  runtimeProfile: "baseline",
  modelCell: "control",
  reasoningCell: "low",
  emailCaptureMode: "adaptive",
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

export const RELEASE_STATIC_CONTRACTS = [
  {
    path: "Dockerfile",
    text: 'ENV HOSTNAME="0.0.0.0"',
    failure: "Dockerfile must bind the standalone server to 0.0.0.0",
  },
  {
    path: "scripts/deploy-coolify-host.sh",
    text: `image="\${app_uuid}:staging-\${sha}"`,
    failure: "staging must use a distinct staging-<sha> image tag",
  },
  {
    path: "docs/11-INFRASTRUCTURE.md",
    text: "health-check host is `127.0.0.1`",
    failure: "infrastructure docs must pin Coolify's health-check host to 127.0.0.1",
  },
  {
    path: "docs/12-CHAT-RELEASE-RUNBOOK.md",
    text: "Final-SHA freeze",
    failure: "the governed release runbook must retain the final-SHA freeze",
  },
] as const;

export function validateReleaseSha(value: string): string[] {
  return /^[0-9a-f]{40}$/.test(value) ? [] : ["release SHA must be a full 40-character lowercase git SHA"];
}

export function validateReleaseStaticContracts(readText: (path: string) => string): string[] {
  return RELEASE_STATIC_CONTRACTS.flatMap(({ path, text, failure }) =>
    readText(path).includes(text) ? [] : [failure],
  );
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
  if (env.VOICE_EMAIL_CAPTURE_MODE !== CONTROL_VOICE_CELL.emailCaptureMode) {
    failures.push(`VOICE_EMAIL_CAPTURE_MODE must be ${CONTROL_VOICE_CELL.emailCaptureMode}`);
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
  const voice = health.voice && typeof health.voice === "object" ? (health.voice as Record<string, unknown>) : null;
  if (!voice) {
    failures.push("health response voice must be an object");
  } else {
    if (voice.runtime_profile !== CONTROL_VOICE_CELL.runtimeProfile) {
      failures.push(`health voice runtime_profile must be ${CONTROL_VOICE_CELL.runtimeProfile}`);
    }
    if (voice.model_cell !== CONTROL_VOICE_CELL.modelCell) {
      failures.push(`health voice model_cell must be ${CONTROL_VOICE_CELL.modelCell}`);
    }
    if (voice.reasoning_cell !== CONTROL_VOICE_CELL.reasoningCell) {
      failures.push(`health voice reasoning_cell must be ${CONTROL_VOICE_CELL.reasoningCell}`);
    }
    if (voice.email_capture_mode !== CONTROL_VOICE_CELL.emailCaptureMode) {
      failures.push(`health voice email_capture_mode must be ${CONTROL_VOICE_CELL.emailCaptureMode}`);
    }
    if (voice.variant_picker !== false) failures.push("health voice variant_picker must be false");
  }
  return failures;
}

export function hasCloudflareEdgeHeaders(headers: Headers): boolean {
  const server = headers.get("server")?.toLowerCase();
  return Boolean(headers.get("cf-ray") || headers.get("cf-cache-status") || server?.includes("cloudflare"));
}
