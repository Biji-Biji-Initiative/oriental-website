import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const MOBILE_HOME_BUDGET = {
  largestContentfulPaintMs: 2_500,
  cumulativeLayoutShift: 0.1,
  initialJavaScriptTransferBytes: 450 * 1_024,
  initialJavaScriptDecodedBytes: 1_500 * 1_024,
  seriousOrCriticalAccessibilityViolations: 0,
} as const;

type BrowserMetrics = {
  lcpMs: number;
  cls: number;
  initialJavaScriptTransferBytes: number;
  initialJavaScriptDecodedBytes: number;
  initialJavaScriptRequests: number;
};

test("mobile home stays within the production performance budget", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const metrics = { lcpMs: 0, cls: 0 };
    Object.defineProperty(window, "__orientalPerformance", { value: metrics, writable: false });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!layoutShift.hadRecentInput) metrics.cls += layoutShift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("main")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });

  const metrics = await page.evaluate<BrowserMetrics>(() => {
    const browserMetrics = (window as typeof window & { __orientalPerformance: Pick<BrowserMetrics, "lcpMs" | "cls"> })
      .__orientalPerformance;
    const initialJavaScript = performance.getEntriesByType("resource").filter((entry) => {
      const pathname = new URL(entry.name).pathname;
      return pathname.includes("/_next/static/") && pathname.endsWith(".js");
    }) as PerformanceResourceTiming[];

    return {
      ...browserMetrics,
      initialJavaScriptTransferBytes: initialJavaScript.reduce((sum, entry) => sum + entry.transferSize, 0),
      initialJavaScriptDecodedBytes: initialJavaScript.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      initialJavaScriptRequests: initialJavaScript.length,
    };
  });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const seriousOrCritical = accessibility.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  console.log(
    `mobile performance: ${JSON.stringify({ ...metrics, seriousOrCriticalViolations: seriousOrCritical.length })}`,
  );

  await testInfo.attach("mobile-home-performance.json", {
    body: JSON.stringify({ metrics, budget: MOBILE_HOME_BUDGET, seriousOrCritical }, null, 2),
    contentType: "application/json",
  });

  expect(metrics.lcpMs, "mobile LCP").toBeGreaterThan(0);
  expect(metrics.lcpMs, "mobile LCP").toBeLessThanOrEqual(MOBILE_HOME_BUDGET.largestContentfulPaintMs);
  expect(metrics.cls, "mobile CLS").toBeLessThanOrEqual(MOBILE_HOME_BUDGET.cumulativeLayoutShift);
  expect(metrics.initialJavaScriptTransferBytes, "initial compressed JavaScript").toBeLessThanOrEqual(
    MOBILE_HOME_BUDGET.initialJavaScriptTransferBytes,
  );
  expect(metrics.initialJavaScriptDecodedBytes, "initial decoded JavaScript").toBeLessThanOrEqual(
    MOBILE_HOME_BUDGET.initialJavaScriptDecodedBytes,
  );
  expect(seriousOrCritical, "serious or critical axe violations").toHaveLength(
    MOBILE_HOME_BUDGET.seriousOrCriticalAccessibilityViolations,
  );
});
