import { isValidAdminActor } from "../lib/admin-permissions";
import { hasShellEscapedQuoteWrapper, unwrapEnvValue } from "../lib/env";
import { isAllowedAdminEvalModel } from "../lib/eval/admin-models";
import { activeVoiceExperimentDimensions } from "../lib/voice/experiments";
import { MANAGED_APPLICATION_ENVIRONMENT_KEYS } from "./lib/managed-app-environment";

const required = [
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_INGEST_SECRET",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_ENFORCEMENT",
  "IP_HASH_SECRET",
  "OWNER_TENANCY",
  "OWNER_EDUCATION",
  "OWNER_PROGRAMME",
  "OWNER_TECHNOLOGY",
  "OWNER_COMMUNITY",
  "OWNER_OTHER",
  "VOICE_SESSION_DAILY_LIMIT",
];

const smtpRequired = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SES_FROM_ADDRESS"];
const sesRequired = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "SES_FROM_ADDRESS"];
const slackRequired = ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"];
const sentryRequired = ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"];
const adminRequired = [
  "ADMIN_REVIEW_ACTOR",
  "ADMIN_REVIEW_ROLE",
  "ADMIN_REVIEW_TOKEN",
  "ADMIN_REVIEW_PASSWORD_HMAC",
  "OPS_AUTOMATION_TOKEN",
  "PRIVACY_ADMIN_TOKEN",
];
const opsAlertRequired = ["OPS_ALERT_SLACK_CHANNEL_ID"];
const clickUpRequired = ["CLICKUP_API_TOKEN", "CLICKUP_LIST_ID"];

const supportedRealtimeVoices = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

if (!process.env.INFISICAL_TOKEN && !process.env.CONVEX_DEPLOY_KEY && process.env.NODE_ENV !== "production") {
  console.log("Skipping secret check: no Infisical/Convex deployment credentials in local development.");
  process.exit(0);
}

const malformed = MANAGED_APPLICATION_ENVIRONMENT_KEYS.filter((name) => hasShellEscapedQuoteWrapper(process.env[name]));
if (malformed.length > 0) {
  console.error(`Malformed shell-escaped environment variables: ${malformed.join(", ")}`);
  process.exit(1);
}

const missing = required.filter((name) => !envValue(name));
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const hasSmtp = smtpRequired.every((name) => Boolean(envValue(name)));
const hasSes = sesRequired.every((name) => Boolean(envValue(name)));
if (!hasSmtp && !hasSes) {
  console.error("Missing notification transport: configure SMTP_* or AWS SES credentials plus SES_FROM_ADDRESS.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const missingSlack = slackRequired.filter((name) => !envValue(name));
  if (missingSlack.length > 0) {
    console.error(`Missing Slack routing variables: ${missingSlack.join(", ")}`);
    process.exit(1);
  }

  const missingSentry = sentryRequired.filter((name) => !envValue(name));
  if (missingSentry.length > 0) {
    console.error(`Missing Sentry variables: ${missingSentry.join(", ")}`);
    process.exit(1);
  }

  const missingAdmin = adminRequired.filter((name) => !envValue(name));
  if (missingAdmin.length > 0) {
    console.error(`Missing admin review variables: ${missingAdmin.join(", ")}`);
    process.exit(1);
  }

  const adminRole = envValue("ADMIN_REVIEW_ROLE");
  if (adminRole !== "viewer" && adminRole !== "operator" && adminRole !== "admin") {
    console.error("ADMIN_REVIEW_ROLE must be explicitly viewer, operator, or admin.");
    process.exit(1);
  }

  const adminActor = envValue("ADMIN_REVIEW_ACTOR");
  if (!adminActor || !isValidAdminActor(adminActor)) {
    console.error("ADMIN_REVIEW_ACTOR must be 1-80 printable characters.");
    process.exit(1);
  }

  const adminPasswordHmac = process.env.ADMIN_REVIEW_PASSWORD_HMAC;
  if (!adminPasswordHmac || !/^[a-f0-9]{64}$/.test(adminPasswordHmac)) {
    console.error("ADMIN_REVIEW_PASSWORD_HMAC must be a lowercase SHA-256 HMAC.");
    process.exit(1);
  }

  const credentialNames = ["ADMIN_REVIEW_TOKEN", "OPS_AUTOMATION_TOKEN", "PRIVACY_ADMIN_TOKEN"];
  const credentials = credentialNames.map((name) => envValue(name) ?? "");
  if (credentials.some((credential) => credential.length < 32)) {
    console.error("Admin review, ops automation, and privacy admin tokens must each be at least 32 characters.");
    process.exit(1);
  }
  if (new Set(credentials).size !== credentials.length) {
    console.error("Admin review, ops automation, and privacy admin tokens must be distinct.");
    process.exit(1);
  }

  const missingOpsAlerts = opsAlertRequired.filter((name) => !envValue(name));
  if (missingOpsAlerts.length > 0) {
    console.error(`Missing ops alert variables: ${missingOpsAlerts.join(", ")}`);
    process.exit(1);
  }

  const missingClickUp = clickUpRequired.filter((name) => !envValue(name));
  if (missingClickUp.length > 0) {
    console.error(`Missing ClickUp lead mirror variables: ${missingClickUp.join(", ")}`);
    process.exit(1);
  }

  const turnstileValues = [envValue("TURNSTILE_SITE_KEY"), envValue("TURNSTILE_SECRET_KEY")];
  if (turnstileValues.some((value) => value?.startsWith("1x0"))) {
    console.error("Production Turnstile keys must not use Cloudflare test keys.");
    process.exit(1);
  }
}

const realtimeVoice = envValue("OPENAI_REALTIME_VOICE");
if (realtimeVoice && !supportedRealtimeVoices.has(realtimeVoice)) {
  console.error(`Unsupported OPENAI_REALTIME_VOICE: ${realtimeVoice}`);
  process.exit(1);
}

const realtimeSpeed = envValue("OPENAI_REALTIME_SPEED");
if (realtimeSpeed) {
  const speed = Number(realtimeSpeed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 1.5) {
    console.error("OPENAI_REALTIME_SPEED must be a number from 0.25 to 1.5.");
    process.exit(1);
  }
}

const runtimeProfile = envValue("VOICE_RUNTIME_PROFILE");
if (runtimeProfile && runtimeProfile !== "baseline" && runtimeProfile !== "instant-v1") {
  console.error("VOICE_RUNTIME_PROFILE must be baseline or instant-v1.");
  process.exit(1);
}

const modelCell = envValue("VOICE_MODEL_CELL");
if (modelCell && modelCell !== "control" && modelCell !== "candidate") {
  console.error("VOICE_MODEL_CELL must be control or candidate.");
  process.exit(1);
}

const evalJudgeModel = envValue("EVAL_JUDGE_MODEL");
if (evalJudgeModel && !isAllowedAdminEvalModel(evalJudgeModel)) {
  console.error("EVAL_JUDGE_MODEL must be one of the approved admin evaluation models.");
  process.exit(1);
}

const emailCaptureMode = envValue("VOICE_EMAIL_CAPTURE_MODE");
if (emailCaptureMode && emailCaptureMode !== "strict" && emailCaptureMode !== "adaptive") {
  console.error("VOICE_EMAIL_CAPTURE_MODE must be strict or adaptive.");
  process.exit(1);
}

const turnstileEnforcement = envValue("TURNSTILE_ENFORCEMENT");
if (turnstileEnforcement !== "relaxed" && turnstileEnforcement !== "required") {
  console.error("TURNSTILE_ENFORCEMENT must be explicitly relaxed or required.");
  process.exit(1);
}

const voiceSessionDailyLimit = Number(envValue("VOICE_SESSION_DAILY_LIMIT"));
if (!Number.isSafeInteger(voiceSessionDailyLimit) || voiceSessionDailyLimit < 1 || voiceSessionDailyLimit > 10_000) {
  console.error("VOICE_SESSION_DAILY_LIMIT must be an integer from 1 to 10000.");
  process.exit(1);
}
if (modelCell === "candidate" && !envValue("OPENAI_REALTIME_MODEL_CANDIDATE")) {
  console.error("OPENAI_REALTIME_MODEL_CANDIDATE is required for the candidate model cell.");
  process.exit(1);
}

const reasoningCell = envValue("VOICE_REASONING_CELL");
if (reasoningCell && reasoningCell !== "low" && reasoningCell !== "minimal") {
  console.error("VOICE_REASONING_CELL must be low or minimal.");
  process.exit(1);
}

const activeExperimentDimensions = activeVoiceExperimentDimensions({ runtimeProfile, modelCell, reasoningCell });
if (activeExperimentDimensions.length > 1) {
  console.error(
    `Only one voice experiment dimension may differ from control at a time; active: ${activeExperimentDimensions.join(
      ", ",
    )}.`,
  );
  process.exit(1);
}
const deploymentEnvironment = envValue("APP_ENV") ?? envValue("SENTRY_ENVIRONMENT");
if (
  activeExperimentDimensions.length > 0 &&
  envValue("VOICE_VARIANT_PICKER") === "true" &&
  deploymentEnvironment !== "staging"
) {
  console.error("VOICE_VARIANT_PICKER may accompany an active experiment only in staging.");
  process.exit(1);
}

console.log("Secret contract satisfied.");

function envValue(name: string) {
  return unwrapEnvValue(process.env[name]);
}
