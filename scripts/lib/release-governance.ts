export const CONTROL_VOICE_CELL = {
  runtimeProfile: "baseline",
  modelCell: "control",
  model: "gpt-realtime-2",
  reasoningCell: "low",
  emailCaptureMode: "adaptive",
  variantPicker: false,
} as const;

export const STAGING_CANDIDATE_VOICE_CELL = {
  ...CONTROL_VOICE_CELL,
  modelCell: "candidate",
  model: "gpt-realtime-2.1",
  variantPicker: false,
} as const;

export const STAGING_CANDIDATE_AUDITION_VOICE_CELL = {
  ...STAGING_CANDIDATE_VOICE_CELL,
  variantPicker: true,
} as const;

export type VoicePickerMode = "clean" | "audition";
export type GovernedVoiceCell = {
  runtimeProfile: "baseline";
  modelCell: "control" | "candidate";
  model: "gpt-realtime-2" | "gpt-realtime-2.1";
  reasoningCell: "low";
  emailCaptureMode: "adaptive";
  variantPicker: boolean;
};

export type HealthPayloadValidationOptions = {
  allowMissingEmailCaptureMode?: boolean;
};

export function governedVoiceCell(
  modelCell: GovernedVoiceCell["modelCell"],
  pickerMode: VoicePickerMode = "clean",
): GovernedVoiceCell {
  const model = modelCell === "candidate" ? STAGING_CANDIDATE_VOICE_CELL : CONTROL_VOICE_CELL;
  return pickerMode === "audition" ? { ...model, variantPicker: true } : model;
}

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

export function validateManagedVoiceCell(
  env: Record<string, string | undefined>,
  expected: GovernedVoiceCell = CONTROL_VOICE_CELL,
): string[] {
  const failures: string[] = [];
  if (env.VOICE_RUNTIME_PROFILE !== expected.runtimeProfile) {
    failures.push(`VOICE_RUNTIME_PROFILE must be ${expected.runtimeProfile}`);
  }
  if (env.VOICE_MODEL_CELL !== expected.modelCell) {
    failures.push(`VOICE_MODEL_CELL must be ${expected.modelCell}`);
  }
  const modelKey = expected.modelCell === "candidate" ? "OPENAI_REALTIME_MODEL_CANDIDATE" : "OPENAI_REALTIME_MODEL";
  if (env[modelKey] !== expected.model) {
    failures.push(`${modelKey} must be ${expected.model}`);
  }
  if (env.VOICE_REASONING_CELL !== expected.reasoningCell) {
    failures.push(`VOICE_REASONING_CELL must be ${expected.reasoningCell}`);
  }
  if (env.VOICE_EMAIL_CAPTURE_MODE !== expected.emailCaptureMode) {
    failures.push(`VOICE_EMAIL_CAPTURE_MODE must be ${expected.emailCaptureMode}`);
  }
  const expectedPicker = String(expected.variantPicker);
  if (env.VOICE_VARIANT_PICKER !== expectedPicker) {
    failures.push(`VOICE_VARIANT_PICKER must be explicitly ${expectedPicker} for the ${expected.modelCell} cell`);
  }
  return failures;
}

export function validateHealthPayload(
  payload: unknown,
  expectedSha: string,
  expected: GovernedVoiceCell = CONTROL_VOICE_CELL,
  options: HealthPayloadValidationOptions = {},
): string[] {
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
    if (voice.runtime_profile !== expected.runtimeProfile) {
      failures.push(`health voice runtime_profile must be ${expected.runtimeProfile}`);
    }
    if (voice.model_cell !== expected.modelCell) {
      failures.push(`health voice model_cell must be ${expected.modelCell}`);
    }
    if (voice.model !== expected.model) failures.push(`health voice model must be ${expected.model}`);
    if (voice.reasoning_cell !== expected.reasoningCell) {
      failures.push(`health voice reasoning_cell must be ${expected.reasoningCell}`);
    }
    const missingLegacyEmailCaptureMode =
      options.allowMissingEmailCaptureMode === true && voice.email_capture_mode === undefined;
    if (voice.email_capture_mode !== expected.emailCaptureMode && !missingLegacyEmailCaptureMode) {
      failures.push(`health voice email_capture_mode must be ${expected.emailCaptureMode}`);
    }
    if (voice.variant_picker !== expected.variantPicker) {
      failures.push(`health voice variant_picker must be ${expected.variantPicker}`);
    }
  }
  return failures;
}

export function hasCloudflareEdgeHeaders(headers: Headers): boolean {
  const server = headers.get("server")?.toLowerCase();
  return Boolean(headers.get("cf-ray") || headers.get("cf-cache-status") || server?.includes("cloudflare"));
}
