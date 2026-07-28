import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { siteMeta } from "@/lib/content";

describe("robots", () => {
  it("allows crawling but disallows admin and api, and points at the absolute sitemap", () => {
    const result = robots();
    expect(result.sitemap).toBe(`${siteMeta.url}/sitemap.xml`);
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule?.userAgent).toBe("*");
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(["/admin", "/api"]);
  });
});

describe("sitemap", () => {
  it("lists the public routes with absolute URLs under the production origin", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([`${siteMeta.url}/`, `${siteMeta.url}/faq`, `${siteMeta.url}/privacy`]);
    for (const url of urls) {
      expect(url.startsWith(siteMeta.url)).toBe(true);
    }
  });
});
