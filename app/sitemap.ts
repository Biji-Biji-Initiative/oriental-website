import type { MetadataRoute } from "next";
import { siteMeta } from "@/lib/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${siteMeta.url}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteMeta.url}/faq`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${siteMeta.url}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
