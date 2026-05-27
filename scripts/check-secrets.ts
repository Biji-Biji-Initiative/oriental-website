const required = [
  "OPENAI_API_KEY",
  "OPENAI_REALTIME_MODEL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "OWNER_TENANCY",
  "OWNER_EDUCATION",
  "OWNER_PROGRAMME",
  "OWNER_TECHNOLOGY",
  "OWNER_AI",
  "OWNER_CULTURAL",
  "OWNER_COMMUNITY",
  "OWNER_OTHER",
];

if (!process.env.INFISICAL_TOKEN && !process.env.CONVEX_DEPLOY_KEY && process.env.NODE_ENV !== "production") {
  console.log("Skipping secret check: no Infisical/Convex deployment credentials in local development.");
  process.exit(0);
}

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Secret contract satisfied.");
