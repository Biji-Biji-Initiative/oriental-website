import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // This repository is often checked out below a home directory that contains
  // unrelated fleet lockfiles. Keep dependency tracing and Turbopack's build
  // graph scoped to this exact checkout instead of guessing an ancestor root.
  turbopack: { root: process.cwd() },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Voice needs the microphone on this origin; everything else stays off.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
