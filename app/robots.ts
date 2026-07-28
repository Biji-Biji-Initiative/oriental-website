import type { MetadataRoute } from "next";
import { siteMeta } from "@/lib/content";

export default function robots(): MetadataRoute.Robots {
  return {
    // Admin and API paths are already token-gated and per-page noindex; disallowing
    // them keeps well-behaved crawlers off routes that never belong in an index.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: `${siteMeta.url}/sitemap.xml`,
  };
}
