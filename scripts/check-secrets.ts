const required = [
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_INGEST_SECRET",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "IP_HASH_SECRET",
  "OWNER_TENANCY",
  "OWNER_EDUCATION",
  "OWNER_PROGRAMME",
  "OWNER_TECHNOLOGY",
  "OWNER_AI",
  "OWNER_CULTURAL",
  "OWNER_COMMUNITY",
  "OWNER_OTHER",
];

const smtpRequired = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SES_FROM_ADDRESS"];
const sesRequired = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "SES_FROM_ADDRESS"];
const slackRequired = ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"];
const sentryRequired = ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"];
const adminRequired = ["ADMIN_REVIEW_TOKEN"];
const opsAlertRequired = ["OPS_ALERT_SLACK_CHANNEL_ID"];

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

  const missingOpsAlerts = opsAlertRequired.filter((name) => !envValue(name));
  if (missingOpsAlerts.length > 0) {
    console.error(`Missing ops alert variables: ${missingOpsAlerts.join(", ")}`);
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

console.log("Secret contract satisfied.");

function envValue(name: string) {
  const value = process.env[name];
  if (!value) return undefined;
  let trimmed = value.trim();
  for (let depth = 0; depth < 2; depth += 1) {
    const quote = trimmed[0];
    if ((quote !== "'" && quote !== '"') || trimmed.at(-1) !== quote) break;
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed || undefined;
}
