---
title: "Oriental Mobile Page Performance Budget"
type: "performance_spec_and_runbook"
status: "implemented"
owner: "Mereka Engineering"
last_updated: "2026-07-16"
---

# 14 — Mobile Page Performance Budget

## Scope and non-goals

This contract protects the production home page against material mobile
rendering, JavaScript, layout-stability, and accessibility regressions. It is a
deterministic build gate, not a substitute for field Core Web Vitals, real
network segmentation, or subjective visual review.

## Requirements

- The production build MUST be tested with the Pixel 7 Playwright profile and
  one isolated Chromium worker.
- Largest Contentful Paint MUST be at most 2,500 ms on the local production
  server.
- Cumulative Layout Shift MUST be at most 0.1.
- Initial `/_next/static/` JavaScript MUST be at most 450 KiB transferred and
  1,500 KiB decoded.
- The rendered home page MUST have zero serious or critical WCAG 2/2.1 A/AA
  violations reported by axe-core.
- CI MUST retain the JSON metrics, trace, screenshot, and HTML report when the
  gate fails.

## Acceptance criteria

- [x] `pnpm build && pnpm test:performance` starts the built app, runs the
  mobile gate, and exits non-zero on any exceeded budget.
- [x] CI runs the gate after the production build.
- [x] The test uses observable browser performance entries and axe results,
  not source-code size guesses.
- [x] The gate does not call staging or production unless an operator supplies
  `PERFORMANCE_BASE_URL` explicitly.

Automated mapping: `tests/performance/home-performance.spec.ts`,
`playwright.performance.config.ts`, and `.github/workflows/ci.yml`.

## Failure handling

Inspect the uploaded `mobile-home-performance.json` first. For JavaScript
regressions, identify newly loaded initial chunks and defer non-critical client
components. For LCP, inspect the LCP element, fonts, and hero asset priority.
For CLS, look for late dimensions/font swaps. For accessibility, fix the named
axe nodes; do not weaken the impact filter or budget to make CI green.

Transient infrastructure failures are not performance passes. Reproduce once
with the same build; repeated failure requires diagnosis before merge.

## Rollout and rollback

The gate is CI/test-only and does not alter runtime behavior. If browser
packaging itself breaks, pin or repair the Playwright/Chromium runner in a
focused PR. Runtime regressions must be reverted or optimized; raising a budget
requires an explicit product/performance decision and measured evidence.
