import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const baseEnv: NodeJS.ProcessEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  INFISICAL_TOKEN: "test-only",
  NODE_ENV: "test",
  OPENAI_API_KEY: "test-only",
  OPENAI_REALTIME_MODEL: "gpt-realtime-2",
  CONVEX_URL: "https://example.convex.cloud",
  NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
  CONVEX_INGEST_SECRET: "test-only",
  TURNSTILE_SITE_KEY: "test-only",
  TURNSTILE_SECRET_KEY: "test-only",
  TURNSTILE_ENFORCEMENT: "relaxed",
  IP_HASH_SECRET: "test-only",
  OWNER_TENANCY: "tenancy@example.test",
  OWNER_EDUCATION: "education@example.test",
  OWNER_PROGRAMME: "programme@example.test",
  OWNER_TECHNOLOGY: "technology@example.test",
  OWNER_COMMUNITY: "community@example.test",
  OWNER_OTHER: "other@example.test",
  VOICE_SESSION_DAILY_LIMIT: "80",
  ADMIN_REVIEW_ACTOR: "Test operator",
  ADMIN_REVIEW_ROLE: "operator",
  ADMIN_REVIEW_TOKEN: "admin-review-token-123456789-abcdef",
  ADMIN_REVIEW_PASSWORD_HMAC: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789-abcdef",
  PRIVACY_ADMIN_TOKEN: "privacy-admin-token-123456789-abcdef",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "test-only",
  SMTP_PASSWORD: "test-only",
  SES_FROM_ADDRESS: "oriental@example.test",
};

function checkSecrets(overrides: Partial<NodeJS.ProcessEnv>) {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...overrides };
  return spawnSync("pnpm", ["exec", "tsx", "scripts/check-secrets.ts"], {
    encoding: "utf8",
    env,
  });
}

describe("managed secret contract", () => {
  it.each(["relaxed", "required"])("accepts the explicit %s Turnstile policy", (policy) => {
    const result = checkSecrets({ TURNSTILE_ENFORCEMENT: policy });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Secret contract satisfied.");
  });

  it("rejects an implicit Turnstile policy", () => {
    const result = checkSecrets({ TURNSTILE_ENFORCEMENT: "optional" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TURNSTILE_ENFORCEMENT must be explicitly relaxed or required.");
  });

  it.each(["0", "1.5", "10001", "9007199254740992"])("rejects unsafe voice daily limit %s", (limit) => {
    const result = checkSecrets({ VOICE_SESSION_DAILY_LIMIT: limit });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VOICE_SESSION_DAILY_LIMIT must be an integer from 1 to 10000.");
  });

  it("accepts distinct, explicit production admin principals", () => {
    const result = checkSecrets(productionEnv());
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects a missing password HMAC", () => {
    const result = checkSecrets(productionEnv({ ADMIN_REVIEW_PASSWORD_HMAC: "" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing admin review variables: ADMIN_REVIEW_PASSWORD_HMAC");
  });

  it.each([
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    ` ${"a".repeat(64)}`,
    "g".repeat(64),
  ])("rejects malformed password HMAC %j", (passwordHmac) => {
    const result = checkSecrets(productionEnv({ ADMIN_REVIEW_PASSWORD_HMAC: passwordHmac }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ADMIN_REVIEW_PASSWORD_HMAC must be a lowercase SHA-256 HMAC");
  });

  it("rejects shared machine/admin credentials and implicit roles", () => {
    const duplicate = checkSecrets(productionEnv({ OPS_AUTOMATION_TOKEN: baseEnv.ADMIN_REVIEW_TOKEN }));
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("must be distinct");

    const role = checkSecrets(productionEnv({ ADMIN_REVIEW_ROLE: "superadmin" }));
    expect(role.status).toBe(1);
    expect(role.stderr).toContain("ADMIN_REVIEW_ROLE must be explicitly viewer, operator, or admin");
  });
});

function productionEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Partial<NodeJS.ProcessEnv> {
  return {
    NODE_ENV: "production",
    SLACK_BOT_TOKEN: "test-only",
    SLACK_CHANNEL_ID: "test-only",
    SENTRY_DSN: "https://public@example.test/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://public@example.test/1",
    SENTRY_ORG: "test-only",
    SENTRY_PROJECT: "test-only",
    OPS_ALERT_SLACK_CHANNEL_ID: "test-only",
    CLICKUP_API_TOKEN: "test-only",
    CLICKUP_LIST_ID: "test-only",
    ...overrides,
  };
}
