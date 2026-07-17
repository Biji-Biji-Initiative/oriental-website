# Oriental final integrated release — executable evidence

## Exact implementation boundary

- Review base: `87362df959561702e36a188e402d91ad34d2b8be` (`origin/main`).
- Exact implementation head before review-artifact updates:
  `992d35b1fd557c34b4d92d8570f96f925280ac9b`.
- Exact implementation tree: `011f3d1f2d9386f648034f7d61701a3b62c04411`.
- Runtime/config/test delta outside prose and APR artifacts: 157 files, 12,040
  insertions, 1,271 deletions.
- APR receives the deterministic 114-file runtime/config plus high-risk-test
  patch at `.apr/evidence/oriental-final-implementation.patch` (511,831 bytes,
  SHA-256
  `c77cab32fdc096b79d345be4f80c0e1d00354819ee44716402d1d7ed92cbb10a`). It
  contains every changed runtime/config source plus focused auth, privacy,
  retention, Convex, deployment, byte-bound, and homepage browser tests. Prose,
  APR's own artifacts, and redundant lower-risk test files are omitted to stay
  within Oracle's 196K-token input limit; the release runbook and specification
  are attached separately. A full current SLA route supplement disambiguates
  zero-context diff hunk labels, and the complete 756-test result remains
  recorded below.
- The feature candidate is not represented as live. Both canonical hosts run
  the auth-only safety boundary `87362df959561702e36a188e402d91ad34d2b8be`.
  The old shared admin alias was rejected with HTTP 401 on staging while the
  rotated governed credential returned 200 and a secure application cookie.
- This is the pre-merge code gate. The final merged SHA still requires Convex,
  staging, smoke, production, and post-release evidence in that order.

## Email capture and attribution closure

- Mobile and short landscape render one email editor beside the voice action;
  desktop places email first in DOM and tab order. The same logical field
  transfers focus across the 1024px breakpoint without stealing it during
  ordinary renders. A valid email is the only routing requirement.
- Invalid, medium-confidence pending, and confirmed email states are visibly
  distinct and truthful. Valid short-landscape capture scrolls the nearby Send
  action into view with a double animation-frame handoff; the action is at
  least 44×44 CSS pixels. Breakpoint, clipping, focus, source-order, contrast,
  long-caption, and scoped Axe assertions are browser-backed.
- Entry location/method and submission method distinguish persistent header,
  mobile navigation, hero/inline/floating CTAs, typed button, voice command,
  and email-capture send. Six fixed fields retain method, last-input method,
  edit/correction/clear counts, and mixed provenance without values.
- Client provenance is explicitly labelled client-reported diagnostic evidence,
  not an independent observation or model-promotion signal. Any voice, chat, or
  mixed claim requires a cryptographically valid signed review linkage.
- The admin separates accepted submitted leads from all engaged logical voice
  conversations. The voice funnel deduplicates reconnects by conversation ID,
  excludes unused prewarms, and reports pending/rejected email, corrections,
  clears, typed fallback, recoverable failures, and abandonment with explicit
  bounded-window/truncation labels.

## Privacy, retention, and data-integrity closure

- Captured and lead emails persist normalized lookup fields. Legacy
  normalization is bounded and indexed; subject deletion cannot proceed while
  legacy matching remains incomplete, preventing mixed-case false success.
- Subject deletion first builds a bounded plan, requires manual confirmation
  for delivered email and unaddressable legacy mirrors, deletes addressable
  Slack messages and ClickUp tasks idempotently, and only then authorizes Convex
  erasure. A saturated bounded deletion returns retryable HTTP 409 with
  `ok=false` until the mutation reports `complete=true`; only then does the route
  log completion. Responses, logs, and audit rows omit the subject email.
- Voice records use `snapshotSequence` and monotonic submitted/linkage state so
  stale heartbeats cannot overwrite a final snapshot. Automatic evaluation is
  queued atomically with the accepted close snapshot and cannot consume a lease
  without owned work.
- Transcript aggregates are capped at both 8,000 UTF-16 code units and 24,000
  UTF-8 bytes without splitting Unicode code points. Multibyte and surrogate-
  boundary tests prove both ceilings. New and migrated rows carry `payloadSafe`;
  admin/eval/SLA/count reads use bounded indexes and exclude unmigrated rows.
  Lead counts scan at most 750+1 and render `≥`/lower-bound labels when
  truncated rather than claiming exact totals.
- Indexed retention deletes unsubmitted voice diagnostics after 30 days,
  submitted diagnostics after 90 days, strips copied lead transcript content at
  90 days, and deletes archived leads/workflow history 730 days after archival.
  Each mutation backfills 4 legacy leads and 4 legacy sessions, deletes up to 24
  expired sessions, strips 24 lead transcripts, and deletes 2 archived leads;
  the job exposes `hasMore` plus deleted and redacted counts.
- Release ordering requires repeated retention calls after the Convex deploy
  until `hasMore=false`; remaining legacy rows are a release blocker because
  safe indexed reads intentionally hide them.

## Authorization, privacy, and observability closure

- Admin cookies are v2 HMAC sessions binding actor and role. Interactive review,
  ops automation, and privacy deletion use three distinct >=32-character
  credentials and disjoint principals. Machine tokens cannot log in or cross
  permissions; interactive roles cannot invoke ops retention/SLA or privacy
  erasure.
- Cookie mutations and login require same-origin `application/json`, including
  proxy-aware host/protocol validation. Login remains trusted-proxy-IP rate
  limited. The login form retains a native POST fallback so a pre-hydration
  submit cannot place the token in a URL; the JSON-only route rejects that
  fallback fail-closed. Logout is a same-origin JSON action.
- GitHub scheduled work uses only `OPS_AUTOMATION_TOKEN`. Infisical staging and
  production hold distinct admin/ops/privacy credentials plus explicit actor and
  role; GitHub's ops and transitional admin credentials were rotated without
  printing values.
- Browser, edge, and server Sentry hooks remove request data, query strings,
  user data, breadcrumbs, extras, contexts, log messages, exception values,
  credentials, and non-allowlisted span attributes while retaining safe error
  type/stack and operational timing.
- Automated judging caps and delimits untrusted transcript text, tokenizes
  captured/recognizable email, phone, and URL values, and tells the evaluator to
  ignore embedded instructions. The bilingual privacy notice truthfully states
  that uncaptured names/organisations may remain in the bounded extract.
- Debug persistence reduces errors to bounded codes, rate limits per review,
  and requires three distinct production signals before alerting. Tool telemetry
  retains only canonical outcome and response-created-to-call, execution, and
  response-created-to-result durations, with PII-free p50/p95 aggregation by
  canonical tool.

## Voice, brand, and experiment closure

- The homepage/voice surface uses the canonical Mereka path-and-dot/particle M,
  including loading and success fallbacks; there is no generic blue orb.
- The entrance effect is pointer-transparent, never locks scroll, runs once per
  tab for at most 700 ms, and is omitted for admin/API/reduced-motion loads.
- Staging clean mode is
  `baseline/candidate/gpt-realtime-2.1/low/adaptive`, picker off. Audition mode is
  a separately labelled staging-only picker-on surface. Production rejects both
  candidate and audition and remains
  `baseline/control/gpt-realtime-2/low/adaptive`, picker off.
- Latency/provenance telemetry does not promote a model. Candidate promotion
  remains evidence- and Malaysian-human-listening-gated; the open upstream
  Realtime quota issue remains honest product availability evidence.

## Deployment and rollback closure

- Canonical hosts are `staging.oriental.mereka.io` and `oriental.mereka.io`;
  legacy `deploy.mereka.io` names redirect. Cloudflare remains DNS-only and
  Coolify Traefik terminates TLS.
- Staging streams the complete Infisical dotenv scope through encrypted stdin,
  atomically reconciles managed keys under the host lock, uses exact current and
  candidate SHAs, and automatically restores Compose plus `.env`, recreates the
  previous image, and proves exact public SHA on failure. Unknown rollback state
  exits 70.
- Production reconciles the complete managed scope through one Coolify bulk
  write. The successful response must acknowledge every key and exact
  runtime/build/literal/multiline scope; visible values are compared, while
  locked values stay hidden from the least-privilege `read`/`write`/`deploy`
  token and are verified inside the running container after release.
- A live key missing from Infisical blocks before mutation unless it has a
  code-reviewed retirement tombstone. `OWNER_AI` and `OWNER_CULTURAL` were
  removed from both native scopes and remain governed empty tombstones in
  Coolify. `TURNSTILE_ENFORCEMENT=relaxed`, `VOICE_SESSION_DAILY_LIMIT=80`, and
  picker off are native governed values for both environments.
- A terminal Coolify deployment may precede application/public health
  convergence; the deployer waits up to 90 seconds. Any later candidate failure
  re-pins and redeploys the previous SHA. If Coolify briefly resolves a stale
  commit after re-pinning, that rollback deployment is cancelled and retried up
  to three times. Unit tests cover lost PATCH/trigger responses, stale commits,
  delayed health, public mismatch, and executable host rollback.
- The auth-only production rollout exposed both real API behaviours above. The
  old candidate stayed publicly healthy while the control-plane pin was
  manually reconverged to the same SHA; five repeated control/public checks and
  the deterministic dual-host verifier then passed. The full candidate uses the
  hardened code and has not yet been deployed.

## Exact-tree executable validation

- `pnpm lint`: 272 files, no findings.
- `pnpm typecheck`: generated route types and strict TypeScript passed.
- `pnpm test`: 80 files, 756 tests passed.
- `pnpm build`: optimized Next.js 16.2.10 production build passed, including
  privacy and admin retention routes.
- Public Playwright: 44 desktop/mobile tests passed; 46 credential-gated admin
  cases were intentionally skipped in that unauthenticated run.
- Fixture-backed admin Playwright: 45 desktop/mobile cases passed with one
  intentional mobile duplicate-mutation skip. The first run found two stale
  assertions expecting the superseded absolute no-deletion copy; after aligning
  them to the truthful two-year retention copy, the exact desktop/mobile archive
  flow passed 2/2.
- Performance/a11y: mobile LCP 484 ms, CLS 0, 416,507 transferred JavaScript
  bytes, 1,429,393 decoded bytes, 14 requests, zero serious/critical Axe issues.
- Real production Convex dry-run: schema/function typecheck passed, no indexes
  deleted, and 12 additive safe indexes would be created.
- Focused byte-bound regression: 59 schema/Convex/payload tests passed, including
  multibyte UTF-8 and Unicode-boundary cases; strict TypeScript passed again.
- `git diff --check`: clean; worktree clean before this evidence-only update.

## Honest remaining post-merge gates

1. APR must return the exact merge verdict for this tree, then GitHub CI must be
   green on the final PR head.
2. Merge once, freeze the exact `main` SHA, and rerun managed preflight.
3. Deploy Convex first; call retention until `hasMore=false` so no safe data is
   hidden by migration backlog.
4. Deploy/prove that exact SHA on canonical staging, run deterministic intake
   and real WebRTC/audio/persistence smoke once, and inspect live funnel data.
5. Promote the same web SHA through Coolify with production control model,
   verify runtime secret parity inside the container, then prove both canonical
   hosts and legacy redirects.
6. Report upstream availability and candidate/human-quality evidence honestly;
   this engineering release does not manufacture product proof.
