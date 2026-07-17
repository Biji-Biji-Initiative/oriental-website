export const MANAGED_APPLICATION_ENVIRONMENT_KEYS = [
  "ADMIN_REVIEW_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "CLICKUP_API_TOKEN",
  "CLICKUP_LIST_ID",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_INGEST_SECRET",
  "CONVEX_URL",
  "COOLIFY_ORIENTAL_APPLICATION_UUID",
  "EVAL_JUDGE_MODEL",
  "IP_HASH_SECRET",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_GA_MEASUREMENT_ID",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NODE_ENV",
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "OPENAI_REALTIME_MODEL_CANDIDATE",
  "OPENAI_REALTIME_SPEED",
  "OPENAI_REALTIME_TRANSCRIPTION_MODEL",
  "OPENAI_REALTIME_VOICE",
  "OPS_ALERT_SLACK_CHANNEL_ID",
  "OWNER_AI",
  "OWNER_COMMUNITY",
  "OWNER_CULTURAL",
  "OWNER_EDUCATION",
  "OWNER_OTHER",
  "OWNER_PROGRAMME",
  "OWNER_TECHNOLOGY",
  "OWNER_TENANCY",
  "REDIS_URL",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SES_FROM_ADDRESS",
  "SES_REPLY_TO",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_ID",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SMTP_USER",
  "TEAM_NOTIFICATION_CC_EMAILS",
  "TEAM_NOTIFICATION_EMAIL",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_SITE_KEY",
  "VOICE_EMAIL_CAPTURE_MODE",
  "VOICE_IDLE_GOODBYE_GRACE_MS",
  "VOICE_IDLE_TIMEOUT_MS",
  "VOICE_MAX_DURATION_MS",
  "VOICE_MODEL_CELL",
  "VOICE_REASONING_CELL",
  "VOICE_RUNTIME_PROFILE",
  "VOICE_VARIANT_PICKER",
] as const;

export type ManagedApplicationEnvironmentKey = (typeof MANAGED_APPLICATION_ENVIRONMENT_KEYS)[number];

export const DEPLOY_ONLY_APPLICATION_ENVIRONMENT_KEYS = new Set<ManagedApplicationEnvironmentKey>([
  "CONVEX_DEPLOY_KEY",
  "COOLIFY_ORIENTAL_APPLICATION_UUID",
  "SENTRY_AUTH_TOKEN",
]);

export const MANAGED_RUNTIME_APPLICATION_ENVIRONMENT_KEYS = MANAGED_APPLICATION_ENVIRONMENT_KEYS.filter(
  (key) => !DEPLOY_ONLY_APPLICATION_ENVIRONMENT_KEYS.has(key),
);

export type ManagedEnvironmentSnapshotRow = {
  key?: unknown;
  value?: unknown;
  real_value?: unknown;
  is_preview?: unknown;
  is_runtime?: unknown;
  is_buildtime?: unknown;
  is_build_time?: unknown;
};

export type ManagedEnvironmentMutation = {
  key: ManagedApplicationEnvironmentKey;
  value: string;
};

export function managedRuntimeEnvironmentFromEnv(env: Readonly<Record<string, string | undefined>>) {
  const expected = new Map<ManagedApplicationEnvironmentKey, string>();
  for (const key of MANAGED_APPLICATION_ENVIRONMENT_KEYS) {
    if (DEPLOY_ONLY_APPLICATION_ENVIRONMENT_KEYS.has(key)) continue;
    const value = env[key];
    if (typeof value === "string" && value.length > 0) expected.set(key, value);
  }
  return expected;
}

export function isManagedBuildTimeEnvironmentKey(key: ManagedApplicationEnvironmentKey) {
  return key.startsWith("NEXT_PUBLIC_");
}

function managedEnvironmentRowMatches(
  row: ManagedEnvironmentSnapshotRow,
  key: ManagedApplicationEnvironmentKey,
  value: string,
) {
  const buildTime = isManagedBuildTimeEnvironmentKey(key);
  return (
    (row.value === value || row.real_value === value) &&
    row.is_runtime === true &&
    (row.is_buildtime === true || row.is_build_time === true) === buildTime
  );
}

/**
 * Produce the smallest safe mutation set for the complete managed runtime
 * scope. A key retired from Infisical is explicitly cleared if it still exists
 * in Coolify; leaving the previous value untouched would keep a revoked secret
 * live indefinitely.
 */
export function managedEnvironmentReconciliationPlan(
  env: Readonly<Record<string, string | undefined>>,
  rows: ManagedEnvironmentSnapshotRow[],
) {
  const expected = managedRuntimeEnvironmentFromEnv(env);
  const mutations: ManagedEnvironmentMutation[] = [];
  for (const key of MANAGED_RUNTIME_APPLICATION_ENVIRONMENT_KEYS) {
    const value = expected.get(key);
    const matches = rows.filter((row) => row.key === key && row.is_preview !== true);
    if (value !== undefined) {
      if (matches.length !== 1 || !matches[0] || !managedEnvironmentRowMatches(matches[0], key, value)) {
        mutations.push({ key, value });
      }
      continue;
    }
    if (
      matches.length > 0 &&
      (matches.length !== 1 || !matches[0] || !managedEnvironmentRowMatches(matches[0], key, ""))
    ) {
      mutations.push({ key, value: "" });
    }
  }
  return { expected, mutations };
}

/** Exact post-write parity, including proof that retired values are absent or empty. */
export function managedEnvironmentParityFailures(
  env: Readonly<Record<string, string | undefined>>,
  rows: ManagedEnvironmentSnapshotRow[],
) {
  const expected = managedRuntimeEnvironmentFromEnv(env);
  const failures: string[] = [];
  for (const key of MANAGED_RUNTIME_APPLICATION_ENVIRONMENT_KEYS) {
    const value = expected.get(key);
    const matches = rows.filter((row) => row.key === key && row.is_preview !== true);
    if (value === undefined && matches.length === 0) continue;
    if (matches.length !== 1) {
      failures.push(
        `${key} must have ${value === undefined ? "zero or one cleared" : "exactly one"} production Coolify environment entry`,
      );
      continue;
    }
    if (!matches[0] || !managedEnvironmentRowMatches(matches[0], key, value ?? "")) {
      failures.push(
        value === undefined
          ? `${key} retired Coolify value must be empty with the governed runtime/build scope`
          : `${key} Coolify value or runtime/build scope does not match Infisical`,
      );
    }
  }
  return failures;
}
