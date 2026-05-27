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

if (!process.env.INFISICAL_TOKEN && !process.env.CONVEX_DEPLOY_KEY && process.env.NODE_ENV !== "production") {
  console.log("Skipping secret check: no Infisical/Convex deployment credentials in local development.");
  process.exit(0);
}

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const hasSmtp = smtpRequired.every((name) => Boolean(process.env[name]));
const hasSes = sesRequired.every((name) => Boolean(process.env[name]));
if (!hasSmtp && !hasSes) {
  console.error("Missing notification transport: configure SMTP_* or AWS SES credentials plus SES_FROM_ADDRESS.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const turnstileValues = [process.env.TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY];
  if (turnstileValues.some((value) => value?.startsWith("1x0"))) {
    console.error("Production Turnstile keys must not use Cloudflare test keys.");
    process.exit(1);
  }
}

console.log("Secret contract satisfied.");
