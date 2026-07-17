# Oriental admin analytics release — implementation evidence

## Patch identity and boundary

- Review head: `61d529c` (full SHA resolved by Git at review time)
- Review base: `c87c522374d711f5870e4b14ee108157e3561a03`
- Scope: admin-console redesign and accessibility, authenticated on-demand
  voice evaluations, explicit-consent GA4, Google site verification, and
  aggregate per-tool latency.
- No staging or production mutation is claimed by this pre-merge evidence.
  Convex and web deployment are intentionally sequenced after merge.

## Admin usability and accessibility

- The admin shell, CRM workspace, voice-quality workspace, forms, badges, and
  enquiry table use one scoped dark design system.
- Base UI Dialog, Select, and Dropdown portals resolve through an admin-owned
  portal boundary so portaled content inherits that theme.
- The command palette is a named modal with a visible close action, inert
  background, focus trap, Escape handling, and focus restoration.
- Playwright covers desktop and mobile admin behavior, Axe checks, overlay
  theming, command-palette keyboard behavior, and modal semantics.

## Evaluation safety and privacy

- `app/api/admin/evals/route.ts` retains the authenticated admin permission
  boundary and accepts only models declared in `lib/eval/admin-models.ts`.
- Every untargeted run scans a bounded 200-row window before filtering and
  slicing, so recently evaluated rows cannot starve older unscored sessions.
- A Redis-backed global five-minute lease has an explicit memory fallback and
  returns `Retry-After` on rejection. The synchronous batch is capped at 12
  sessions, with a shared 60-second judge budget and a 90-second whole-run
  deadline; abort races also settle cancellation-resistant provider promises.
- Untargeted runs skip sessions already evaluated by the same model. Explicit
  review IDs remain the deliberate rescore mechanism.
- The OpenAI client uses a 30-second timeout and one SDK retry. Provider
  timeout, rate-limit, authentication, empty-response, invalid-response, and
  generic errors are returned and logged as aggregate counts.
- Only normalized scores and model metadata are persisted. Tests assert that
  transcripts and captured values are not sent to persistence or returned by
  the admin route.

## Analytics consent and build wiring

- `GoogleAnalytics` validates the public measurement ID and does not request a
  Google script until the visitor explicitly selects Allow analytics.
- Denial is fail-closed. Withdrawal updates consent to denied and attempts to
  remove `_ga` and `_ga_*` cookies across the host and parent-domain paths.
- Page locations strip query strings and fragments. IP anonymization is
  requested; Google signals and ad-personalization features are disabled.
- The component is excluded from admin/API paths. A bilingual privacy page and
  persistent privacy-settings control explain purpose, data categories,
  retention, withdrawal, and contact route.
- `Dockerfile` declares builder `ARG`/`ENV` values for GA measurement and site
  verification identifiers. The direct-host staging deploy reads, validates,
  and forwards the same public values without logging their contents.
- The production deployer validates the managed values, reconciles each into
  exactly one Coolify production entry with both build-time and runtime enabled,
  and reads exact parity back before changing the frozen SHA. The live verifier
  requires the exact metadata, observes no GA request before consent, observes
  the expected asset after the visitor opts in, and proves consented admin
  traffic never requests GA.

## Independent blocker closure

An independent code review initially returned `VERDICT: DO NOT SHIP` with four
concrete blockers. Each now has executable closure:

- evaluated rows starving the backlog: fixed by the 200-row scan and a test
  with 26 evaluated conversations ahead of an older unscored conversation;
- evaluation work outliving its cost lock: fixed by the lower cap, shared judge
  budget, hard run deadline, and longer global lease, including hanging-query
  and cancellation-resistant-provider tests;
- enquiry search silently discarded by a group-name mismatch: canonicalized to
  a typed `Enquiries` group with desktop/mobile open-record E2E proof; and
- Google values not governed on production: fixed by Coolify reconciliation and
  exact readback plus deterministic live consent/meta/admin verification.

## Aggregate tool telemetry

- Browser telemetry already records only tool name, outcome, execution time,
  response-to-call time, and response-to-result time.
- Aggregate-only output now folds those samples into overall and per-tool
  counts and p50/p95 values. The privacy projection continues to omit session,
  review, lead, transcript, capture, and attention-list fields.
- A read-only production aggregate found 12 tool samples: ordinary local tools
  executed in 0–4 ms; routing executed in 1.2–1.7 seconds because it waits for
  the lead submission truth boundary. Server-side lead handling already starts
  Convex persistence and all notification transports concurrently and logs
  aggregate sub-operation timings. The patch does not weaken durability or let
  the assistant claim success early.

## Exact-head verification

- Theme/accessibility isolation: lint and typecheck passed; 556 Vitest tests
  passed; production build passed; admin desktop/mobile E2E reported 41 passed
  with one intentional mobile mutation skip; focused theme/accessibility gates
  passed 4/4 and production-build palette gates passed 2/2.
- Eval, analytics, Docker, deploy-script, and aggregate privacy suites passed in
  focused runs before this exact combined head.
- The clean combined head passed lint across 236 files, Next route generation
  and TypeScript, 574/574 Vitest tests across 62 files, and the Next 16.2.10
  production build (9/9 static pages).
- The performance gate passed with mobile LCP 508 ms, CLS 0, 408,788 bytes of
  JavaScript transfer, 14 requests, and no serious/critical accessibility
  violations.
- The exact combined admin E2E matrix passed 41 checks across desktop Chromium
  and Pixel 7, with one intentional mobile-only workflow-mutation skip.
- After blocker closure, eval-focused tests passed 17/17 and the full suite
  passed 577 tests; Google release/privacy governance passed 31 focused tests.
  A second clean combined-tree validation and independent re-review are running
  as redundant final gates.

## Post-merge release boundary

After an exact-tree merge verdict and green CI, freeze the merge SHA, deploy
the changed Convex function before the web image, reconcile public analytics
identifiers from Infisical into the two build systems, deploy staging first,
then deploy production with the unchanged control voice cell. Both canonical
hosts must report the same exact SHA and healthy Convex/Redis state. Verify that
GA is absent before consent, appears after consent only on public pages, remains
absent on admin, and that the site-verification metadata is present before
requesting Google property verification and sitemap submission.
