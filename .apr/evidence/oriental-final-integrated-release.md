# Oriental final integrated release — executable evidence

## Exact implementation boundary

- Review base: `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e`
- Integrated implementation head before this evidence update:
  `c8103c6d1b138479a88e520b65a71d032a3017c9`
- Integrated implementation tree: `c625b86da54303a1644f5115c7788c082d730d24`
- Scope: 144 files, 8,783 insertions and 1,053 deletions spanning the admin
  console, safe evaluation, consented analytics, Google release wiring,
  responsive voice UI, reactive brand motion, capture correctness, PII-free
  tool and intake-attribution telemetry, managed-environment convergence,
  scheduled analytics operations, and release verification.
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
  persisted; provider prose is discarded at the persistence boundary and the
  displayed summary is deterministically reconstructed from numeric scores, so
  an echoed name, email, organisation, captured value, or transcript excerpt
  cannot reach Convex. Errors are returned and logged as aggregate categories.
- Auto-evaluation on verified session close uses the same bounded runner, while
  explicit force/targeted rescoring remains deliberate. The managed environment
  owns `EVAL_AUTO_ON_CLOSE`. A canonical-host GitHub workflow invokes a valid
  12-session maximum nightly and an authenticated ownership-SLA sweep hourly;
  network failures fail the job and the expected `no_sessions` result remains
  machine-readable.
- GA validates its public identifier and loads only after Allow analytics.
  Denial remains fail-closed; withdrawal denies future collection and attempts
  `_ga`/`_ga_*` cleanup, and a later regrant explicitly restores
  `analytics_storage: granted`. Page locations omit query/fragment data, public
  tracking excludes admin/API paths, and the bilingual privacy page provides a
  persistent consent-revision path.
- Funnel and conversion events now use one client pipeline. Event-specific
  TypeScript maps and runtime allowlists accept only bounded entry/submit
  categories, segment/variant labels, and 0..6 counters. A retained `gtag`
  function cannot emit after consent withdrawal, and runtime tests prove that
  email-shaped, free-form, cross-event, and invalid-category parameters are
  discarded.
- Docker, direct-host staging, and Coolify production all receive the validated
  public Google identifiers at build time. The deterministic verifier proves
  site-verification metadata, no pre-consent GA request, exactly one expected
  GA asset after consent, and no admin GA request.

## Voice UX, capture, and brand closure

- The approved Mereka M is a bounded point-cloud/WebGL surface with deterministic
  reduced-motion fallback, adaptive audio floor and hysteresis, and a normal
  production visual rather than an environment experiment.
- The public entrance trace is pointer-transparent, never locks scrolling,
  lasts at most 690 ms once per tab, and is absent on admin/API and
  reduced-motion loads. Admin command navigation uses the Next router and does
  not force document reloads.
- Deterministic Playwright screenshots and geometry checks passed at 390x844,
  768x1024, 1440x900, and 844x390. The dialog had zero body/root horizontal
  overflow. The M remained centered and legible, the initial voice action stayed
  visible, mobile/tablet continued into a scrollable handoff, desktop retained
  independent three-pane layout, and short landscape preserved the action.
- Typed-only handoff edits survive close/reopen. Email correction invalidates
  prior verification immediately. Typed mutation invalidates stale model
  responses. Clear-all uses `clear_fields` through tool definition, reducer,
  schema, bounded validator, Convex persistence, and aggregate reporting.
- Mobile and short-landscape layouts expose one email editor beside the voice
  action; desktop places the same logical field first in DOM/tab order. Focus
  transfers deterministically across the 1024px boundary, a valid email is the
  only routing requirement, and invalid/pending/confirmed states use truthful
  accessible copy. Exact/high-confidence speech is usable immediately;
  medium-confidence speech remains visible and pending for an explicit check.
- Entry attribution locks on the first explicit logical open and ignores
  background prewarms. Submission attribution distinguishes handoff button,
  voice command, and email-capture button. Six fixed field-provenance records
  retain bounded voice/manual/mixed edit, correction, and clear counts without
  values. Server schemas reject impossible source/method pairs, and a voice
  command must carry cryptographically valid review credentials rather than
  substituting a Turnstile proof.
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
- Production fails closed on the control voice cell before reading credentials
  or making a Git, health, or Coolify request. It reads the complete approved
  application scope and the separate Coolify operator scope, excludes
  deploy-only values, reconciles exactly one
  entry per runtime key with only public `NEXT_PUBLIC_*` values build-enabled,
  writes concrete Infisical values as literals, and reads back effective value,
  literal, multiline, runtime, and build scope without logging secrets. A live
  value missing from the supplied scope stops before any mutation; clearing is
  allowed only through a code-reviewed retirement tombstone introduced with
  the source removal and retained as ownership history. It re-reads the expected-current Coolify SHA,
  `running:healthy` state, enabled health checking, and host `127.0.0.1`
  immediately before the first environment mutation and again before changing
  the frozen SHA; the same state is re-fetched after deployment.
- The release verifier supports separate staging clean/audition expectations,
  rejects audition for production, proves both cells and picker states, and
  adds browser Google/canonical-host/DNS-only/legacy-host assertions.
- Convex must deploy first because this patch adds canonical `clear_fields` to
  the bounded function validator. The web application deliberately contains no
  lossy alias that could conceal an older function deployment.
- Convex stores the optional bounded attribution record idempotently and
  aggregates entry coverage, CTA/open/submit dimensions, cross-dimension
  matrices, completion provenance, correction counts, and clear actions. Its
  compatibility fallback retries only confirmed unknown-field validation
  failures, never generic transport failures that could duplicate a write.

## Exact-tree validation

- Biome: 251 files checked, no findings.
- TypeScript: passed with strict project configuration.
- Vitest: 69 files, 684 tests passed, zero failures.
- Next.js 16.2.10 production build: passed; 9 static pages generated.
- Admin Chromium matrix: 43 passed, one intentional mobile mutation skip,
  zero unexpected and zero flaky results.
- Responsive homepage/voice Chromium matrix: 44 passed, zero failures,
  including email focus/correction behavior across short mobile, desktop, and
  the 1024px layout boundary.
- Performance/a11y: mobile LCP 500 ms, CLS 0, 415,579 transferred JavaScript
  bytes, 1,426,149 decoded bytes, 14 requests, and zero serious/critical Axe
  violations.
- The tested implementation commit was clean before this evidence-only update.

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
