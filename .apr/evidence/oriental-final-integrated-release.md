# Oriental final integrated release — executable evidence

## Exact implementation boundary

- Review base: `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e`
- Integrated implementation head before this evidence-only commit:
  `3c70f34bf031bca30607eadcbe3b59481a4e77d4`
- Integrated implementation tree: `c1de44d01edaaecde1c9ccc86eb308efcf6bfeda`
- Scope: 102 files, 5,179 insertions and 794 deletions spanning the admin
  console, safe evaluation, consented analytics, Google release wiring,
  responsive voice UI, reactive brand motion, capture correctness, PII-free
  tool telemetry, managed-environment convergence, and release verification.
- This document is evidence-only. APR MUST inspect the checked-out exact tree;
  no staging or production mutation is claimed by this pre-merge gate.

## Admin, evaluation, and analytics closure

- The admin UI uses one scoped dark design system, an admin-owned portal
  boundary, a named command-palette modal, focus trap, inert background, Escape
  close, and focus restoration. Search results resolve through the typed
  `Enquiries` group on desktop and mobile.
- Admin evaluation retains authorization and a small judge-model allowlist.
  Untargeted work scans a bounded backlog, skips rows already scored by the same
  model, caps each synchronous batch at 12, uses a Redis-backed five-minute
  lease with memory fallback, bounds provider retries, and enforces shared
  judge and whole-run deadlines. Only normalized scores and model metadata are
  persisted; errors are returned and logged as aggregate categories.
- GA validates its public identifier and loads only after Allow analytics.
  Denial remains fail-closed; withdrawal denies future collection and attempts
  `_ga`/`_ga_*` cleanup. Page locations omit query/fragment data, public
  tracking excludes admin/API paths, and the bilingual privacy page provides a
  persistent consent-revision path.
- Docker, direct-host staging, and Coolify production all receive the validated
  public Google identifiers at build time. The deterministic verifier proves
  site-verification metadata, no pre-consent GA request, exactly one expected
  GA asset after consent, and no admin GA request.

## Voice UX, capture, and brand closure

- The approved Mereka M is a bounded point-cloud/WebGL surface with deterministic
  reduced-motion fallback, adaptive audio floor and hysteresis, and a normal
  production visual rather than an environment experiment.
- Deterministic Playwright screenshots and geometry checks passed at 390x844,
  768x1024, 1440x900, and 844x390. The dialog had zero body/root horizontal
  overflow. The M remained centered and legible, the initial voice action stayed
  visible, mobile/tablet continued into a scrollable handoff, desktop retained
  independent three-pane layout, and short landscape preserved the action.
- Typed-only handoff edits survive close/reopen. Email correction invalidates
  prior verification immediately. Typed mutation invalidates stale model
  responses. Clear-all uses `clear_fields` through tool definition, reducer,
  schema, bounded validator, Convex persistence, and aggregate reporting.
- Browser telemetry persists only canonical tool name, outcome, and bounded
  execution/response timing samples. Aggregate-only output exposes counts and
  p50/p95 values overall/by tool while omitting IDs, arguments, contact values,
  transcripts, captures, attention lists, and raw browser timestamps. Routing
  still waits for durable handoff success.

## Experiment and deployment closure

- Staging candidate and voice-picker controls are orthogonal: `clean` is the
  governed picker-off evidence mode and `audition` is the explicit picker-on
  human-listening mode. Production rejects both candidate and audition paths.
- `release:preflight` forces production-only secret validation even when the
  caller did not inherit `NODE_ENV=production`.
- Staging automatically selects the available Linux or WSL Tailscale client,
  authenticates to Infisical when required, streams the complete dotenv scope
  through encrypted stdin, and atomically reconciles managed keys under a
  deployment lock. A mode-0600 sidecar records managed keys so retired values
  are removed without deleting compose-owned settings.
- Production reads the complete approved application scope and the separate
  Coolify operator scope, excludes deploy-only values, reconciles exactly one
  entry per runtime key with only public `NEXT_PUBLIC_*` values build-enabled,
  reads back value/scope parity without logging secrets, changes the frozen SHA,
  and re-fetches the app to require the exact commit, `running:healthy`, enabled
  health checking, and host `127.0.0.1`.
- The release verifier supports separate staging clean/audition expectations,
  rejects audition for production, proves both cells and picker states, and
  adds browser Google/canonical-host/DNS-only/legacy-host assertions.
- Convex must deploy first because this patch adds canonical `clear_fields` to
  the bounded function validator. The web application deliberately contains no
  lossy alias that could conceal an older function deployment.

## Exact-tree validation

- Biome: 241 files checked, no findings.
- TypeScript: passed with strict project configuration.
- Vitest: 64 files, 643 tests passed, zero failures.
- Focused integration suites: 137 tests passed, zero failures.
- Next.js 16.2.10 production build: passed; 9 static pages generated.
- Admin Chromium matrix: 43 passed, one intentional mobile mutation skip,
  zero unexpected and zero flaky results.
- Responsive homepage/voice Chromium matrix: 38 passed, zero failures.
- Performance/a11y: mobile LCP 460 ms, CLS 0, 411,086 transferred JavaScript
  bytes, 1,411,896 decoded bytes, 14 requests, and zero serious/critical Axe
  violations.
- Working tree was clean after the combined implementation validation.

## Honest post-merge boundary

- Read-only live evidence before this patch found 100 recent rows: 56 customer
  call rows across 48 conversations after excluding 44 synthetic rows. There
  were 21 activation attempts, tap-to-live p50 4,220 ms, tap-to-audible p50
  5,715 ms, zero useful starts within two seconds, and seven upstream quota
  failures. All runtime-profile samples were baseline; `instant-v1` had zero
  clean samples and correctly remained `insufficient_data`.
- Production therefore remains control `gpt-realtime-2`. Staging remains the
  clean `gpt-realtime-2.1` candidate only. Neither instant runtime promotion nor
  Malaysian human-quality approval is claimed.
- After merge and green CI: freeze the merge SHA, deploy changed Convex
  functions, reconcile/deploy/prove staging, run each governed smoke once,
  reconcile/deploy/prove production, require both canonical hosts on the same
  exact SHA, and rerun the aggregate-only evidence query. The external OpenAI
  quota failure must remain an open issue if it persists.
