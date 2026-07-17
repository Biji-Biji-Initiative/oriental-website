export const GOOGLE_PUBLIC_BUILD_KEYS = [
  "NEXT_PUBLIC_GA_MEASUREMENT_ID",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
] as const;

export type GooglePublicBuildKey = (typeof GOOGLE_PUBLIC_BUILD_KEYS)[number];

export type GooglePublicBuildConfiguration = Record<GooglePublicBuildKey, string>;

export type CoolifyEnvironmentVariable = {
  key?: unknown;
  value?: unknown;
  real_value?: unknown;
  is_preview?: unknown;
  is_runtime?: unknown;
  is_buildtime?: unknown;
  is_build_time?: unknown;
};

export type CoolifyEnvironmentVariablePayload = {
  key: GooglePublicBuildKey;
  value: string;
  is_preview: false;
  is_literal: false;
  is_multiline: false;
  is_shown_once: false;
  is_runtime: true;
  is_buildtime: true;
};

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;
const GOOGLE_SITE_VERIFICATION_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;

export function googlePublicBuildConfigurationFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): GooglePublicBuildConfiguration {
  const configuration = {
    NEXT_PUBLIC_GA_MEASUREMENT_ID: env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "",
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() ?? "",
  };
  const failures = validateGooglePublicBuildConfiguration(configuration);
  if (failures.length > 0) throw new Error(failures.join("; "));
  return configuration;
}

export function validateGooglePublicBuildConfiguration(configuration: GooglePublicBuildConfiguration): string[] {
  const failures: string[] = [];
  if (!GA_MEASUREMENT_ID_PATTERN.test(configuration.NEXT_PUBLIC_GA_MEASUREMENT_ID)) {
    failures.push("NEXT_PUBLIC_GA_MEASUREMENT_ID must be a valid GA4 measurement ID");
  }
  if (!GOOGLE_SITE_VERIFICATION_PATTERN.test(configuration.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION)) {
    failures.push("NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION must be a valid Google verification token");
  }
  return failures;
}

export function coolifyGoogleEnvironmentPayloads(
  configuration: GooglePublicBuildConfiguration,
): CoolifyEnvironmentVariablePayload[] {
  return GOOGLE_PUBLIC_BUILD_KEYS.map((key) => ({
    key,
    value: configuration[key],
    is_preview: false,
    is_literal: false,
    is_multiline: false,
    is_shown_once: false,
    is_runtime: true,
    is_buildtime: true,
  }));
}

export function coolifyGoogleEnvironmentFailures(
  rows: CoolifyEnvironmentVariable[],
  expected: GooglePublicBuildConfiguration,
  options: { allowHiddenValues?: boolean } = {},
): string[] {
  const failures: string[] = [];
  for (const key of GOOGLE_PUBLIC_BUILD_KEYS) {
    const matches = rows.filter((row) => row.key === key && row.is_preview !== true);
    if (matches.length !== 1) {
      failures.push(`${key} must have exactly one production Coolify environment entry`);
      continue;
    }
    const row = matches[0];
    if (!row) continue;
    const valueHidden = typeof row.value !== "string" && typeof row.real_value !== "string";
    if (
      row.value !== expected[key] &&
      row.real_value !== expected[key] &&
      !(options.allowHiddenValues && valueHidden)
    ) {
      failures.push(`${key} Coolify value does not match the managed release environment`);
    }
    if (row.is_buildtime !== true && row.is_build_time !== true) {
      failures.push(`${key} must be enabled at Coolify build time`);
    }
    if (row.is_runtime !== true) failures.push(`${key} must be enabled at Coolify runtime`);
  }
  return failures;
}

export function readGoogleSiteVerification(html: string): string | undefined {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    const name = readHtmlAttribute(tag, "name");
    if (name === "google-site-verification") return readHtmlAttribute(tag, "content");
  }
  return undefined;
}

export function isExpectedGoogleAnalyticsAsset(url: string, measurementId: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "www.googletagmanager.com" &&
      parsed.pathname === "/gtag/js" &&
      parsed.searchParams.get("id") === measurementId
    );
  } catch {
    return false;
  }
}

function readHtmlAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}
