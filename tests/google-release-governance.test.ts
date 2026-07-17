import { describe, expect, it } from "vitest";
import {
  coolifyGoogleEnvironmentFailures,
  coolifyGoogleEnvironmentPayloads,
  googlePublicBuildConfigurationFromEnv,
  isExpectedGoogleAnalyticsAsset,
  readGoogleSiteVerification,
  validateGooglePublicBuildConfiguration,
} from "../scripts/lib/google-release";

const expected = {
  NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-ABC123DEF4",
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "abcDEF0123456789_-abcDEF0123456789_-abcDEF0",
};

describe("Google release governance", () => {
  it("requires validated managed identifiers without exposing them in failures", () => {
    expect(googlePublicBuildConfigurationFromEnv(expected)).toEqual(expected);
    expect(
      validateGooglePublicBuildConfiguration({
        NEXT_PUBLIC_GA_MEASUREMENT_ID: "UA-legacy",
        NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "too short",
      }),
    ).toEqual([
      "NEXT_PUBLIC_GA_MEASUREMENT_ID must be a valid GA4 measurement ID",
      "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION must be a valid Google verification token",
    ]);
    expect(() => googlePublicBuildConfigurationFromEnv({})).toThrow(
      "NEXT_PUBLIC_GA_MEASUREMENT_ID must be a valid GA4 measurement ID",
    );
  });

  it("builds production build-and-runtime Coolify payloads", () => {
    expect(coolifyGoogleEnvironmentPayloads(expected)).toEqual([
      {
        key: "NEXT_PUBLIC_GA_MEASUREMENT_ID",
        value: expected.NEXT_PUBLIC_GA_MEASUREMENT_ID,
        is_preview: false,
        is_literal: false,
        is_multiline: false,
        is_shown_once: false,
        is_runtime: true,
        is_buildtime: true,
      },
      {
        key: "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
        value: expected.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
        is_preview: false,
        is_literal: false,
        is_multiline: false,
        is_shown_once: false,
        is_runtime: true,
        is_buildtime: true,
      },
    ]);
  });

  it("requires one exact, build-time, runtime production entry for each identifier", () => {
    const rows = coolifyGoogleEnvironmentPayloads(expected);
    expect(coolifyGoogleEnvironmentFailures(rows, expected)).toEqual([]);
    const failures = coolifyGoogleEnvironmentFailures(
      rows.map((row) =>
        row.key === "NEXT_PUBLIC_GA_MEASUREMENT_ID"
          ? { ...row, value: "G-WRONG", is_buildtime: false, is_runtime: false }
          : row,
      ),
      expected,
    );
    expect(failures).toEqual([
      "NEXT_PUBLIC_GA_MEASUREMENT_ID Coolify value does not match the managed release environment",
      "NEXT_PUBLIC_GA_MEASUREMENT_ID must be enabled at Coolify build time",
      "NEXT_PUBLIC_GA_MEASUREMENT_ID must be enabled at Coolify runtime",
    ]);
    expect(JSON.stringify(failures)).not.toContain(expected.NEXT_PUBLIC_GA_MEASUREMENT_ID);
    expect(JSON.stringify(failures)).not.toContain(expected.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION);
    expect(coolifyGoogleEnvironmentFailures([], expected)).toHaveLength(2);
  });

  it("accepts the legacy build-time field alias on readback", () => {
    const rows = coolifyGoogleEnvironmentPayloads(expected).map(({ is_buildtime: _, ...row }) => ({
      ...row,
      is_build_time: true,
    }));
    expect(coolifyGoogleEnvironmentFailures(rows, expected)).toEqual([]);
  });

  it("reads the exact Search Console meta regardless of attribute order", () => {
    expect(
      readGoogleSiteVerification(
        `<html><head><meta content="${expected.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION}" name="google-site-verification"></head></html>`,
      ),
    ).toBe(expected.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION);
    expect(readGoogleSiteVerification("<html><head></head></html>")).toBeUndefined();
  });

  it("matches only the exact HTTPS GA asset and measurement id", () => {
    expect(
      isExpectedGoogleAnalyticsAsset(
        `https://www.googletagmanager.com/gtag/js?id=${expected.NEXT_PUBLIC_GA_MEASUREMENT_ID}`,
        expected.NEXT_PUBLIC_GA_MEASUREMENT_ID,
      ),
    ).toBe(true);
    expect(
      isExpectedGoogleAnalyticsAsset(
        "https://www.googletagmanager.com/gtag/js?id=G-WRONG",
        expected.NEXT_PUBLIC_GA_MEASUREMENT_ID,
      ),
    ).toBe(false);
    expect(
      isExpectedGoogleAnalyticsAsset(
        `https://evil.example/gtag/js?id=${expected.NEXT_PUBLIC_GA_MEASUREMENT_ID}`,
        expected.NEXT_PUBLIC_GA_MEASUREMENT_ID,
      ),
    ).toBe(false);
  });
});
