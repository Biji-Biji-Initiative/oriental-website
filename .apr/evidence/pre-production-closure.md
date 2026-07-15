# Oriental Instant Voice — pre-production closure evidence

Evidence date: 2026-07-15 (Asia/Kuala_Lumpur)

## Review source and tool

- Both shared-chat identifiers were searched through the ACFS shared CASS
  bridge. The shared index had no URL-keyed hit, so the complete 1,297-line
  source conversation already preserved in the local Codex session archive was
  re-read without reopening it in a browser. The newer public share was also
  decoded directly from its serialized page payload; it is the same design
  thread plus the PR 11 audit, not a separate untracked requirements list.
- APR round 1 is tracked at
  `.apr/rounds/oriental-voice-instant/round_1.md`.
- Round 1 findings about commit/PR drift, missing command/runtime evidence,
  prompt/tool rollback, and `AGENTS.md` drift were fixed before merge.

## GitHub truth

- PR 13 merged at `2026-07-15T12:41:43Z`.
- Merge commit: `7fb9fdc58b49f97f5dcd70ccd7da89ca26e5d1c7`.
- Final source commit in the merge history:
  `da715af152261d69d9a49be78e3f74911e16692e`.
- Main CI run `29416201140` passed on the merge commit.
- PRs 11 and 12 are closed as superseded; their focused commits remain in the
  merged history.

## Verification truth

- Before the closure branch, local full-suite evidence was 35 test files / 214
  tests, lint, typecheck, Convex typecheck, production build, public Playwright,
  and fixture-backed admin Playwright.
- Final-head GitHub CI passed lint, typecheck, tests, secret checks, and build.
- `git diff --check origin/main...HEAD` is clean before any closure edits.
- Convex schema/functions were deployed to
  `https://wary-hornet-265.eu-west-1.convex.cloud` before the final staging web
  deploy. Later commits changed review evidence and the staging smoke utility,
  not the Convex runtime.

The closure branch adds exact tap-to-live measurement and currently passes:

- lint across 162 files;
- app and Convex TypeScript checks;
- 35 test files / 216 tests;
- a production Next.js build;
- public Playwright: 28 passed, 10 intentionally skipped without admin auth;
- fixture-backed admin Playwright: 11 passed, 1 intentional mobile skip; and
- `git diff --check`.

Existing focused proof that was omitted from the first evidence summary:

- `tests/voice-cues.test.ts` bounds local cue scheduling below 100 ms in the
  deterministic browser contract; it is not a production p50 distribution.
- `tests/voice-audio-activity.test.ts` proves remote-audio activity-detector
  thresholding, hysteresis, and sustained-silence behavior. Source inspection
  of `components/voice-agent/useVoiceAudioLevel.ts` confirms analyser sampling
  and activity callbacks remain active under reduced motion while only visual
  CSS writes are suppressed.
- `tests/voice-session-route.test.ts` proves parse, rate-limit, OpenAI mint, and
  total `Server-Timing` fields.
- `tests/voice-latency.test.ts` proves endpoint, response-created, first-output,
  remote-audio, playout, browser-tool, interruption, and rapid-resume
  decomposition.
- `tests/voice-session-policy.test.ts` proves the consolidated typed duration
  policy.
- `tests/voice-tentative-extraction.test.ts` and
  `tests/realtime-events.test.ts` prove conservative reversible tentative email
  extraction and correction behavior.

## Live environment truth before promotion

- Canonical staging root is
  `https://staging.oriental.mereka.io` with no redirect.
- Staging health reports exact source version
  `da715af152261d69d9a49be78e3f74911e16692e` and `convex: true`.
- Staging Compose image and `SOURCE_COMMIT` / `GIT_SHA` are pinned to that exact
  source SHA.
- Production health reports `606f46e` and `convex: true`.
- Production Compose image and `SOURCE_COMMIT` / `GIT_SHA` are pinned to
  `606f46e` before promotion.
- Neither environment explicitly sets `VOICE_RUNTIME_PROFILE`,
  `VOICE_MODEL_CELL`, or `VOICE_REASONING_CELL`. Runtime defaults in
  `lib/server/openai-realtime.ts` are therefore `baseline`, `control`, and
  `low`.
- Both environments run on the same Singapore Coolify application host. Their
  `REDIS_URL` resolves through the host-local Docker network, so the session
  route does not add a cross-region Redis hop. The Node fetch runtime provides
  pooled outbound connection reuse; no edge rewrite is justified without a
  benchmark showing the existing upstream mint/SDP path is the bottleneck.
- Rollback is an exact image redeploy to `606f46e`; the deployment helper makes
  timestamped Compose and environment backups before replacement.

## Live voice truth

- A canonical staging WebRTC smoke produced live remote audio, a 200 session
  mint, a 200 review snapshot, typed interruption recovery, and zero browser or
  application errors.
- The successful run measured connection at 3,527 ms, opener remote audio at
  928 ms after connection, and interruption recovery at 679 ms.
- This proves the live transport and automated cancellation path. It does not
  prove subjective Malaysian voice quality or the returning-visitor
  click-to-live target.
- Subsequent retries reached the staging mint/debug paths successfully but the
  upstream OpenAI Realtime call returned HTTP 429. This is an upstream capacity
  result, not a staging application error.

## Promotion boundary

- The repository's advisory gate correctly reports `insufficient_data` for
  `instant-v1`; there are not enough qualifying candidate sessions to approve
  it.
- The owner has explicitly authorized staging and production deployment of the
  reviewed code.
- Production deployment must keep the safe `baseline` / `control` / `low`
  defaults. It must not set `instant-v1`, the candidate model, or minimal
  reasoning as part of this promotion.
- A subjective Malaysian voice-quality result remains unknown and must not be
  represented as passed. Owner authorization permits web-code promotion, not a
  fabricated human listening result.
- PR4 prompt/tool implementation is merged and deterministic tests pass, but it
  was implemented before PR3 accumulated the sequential plan's controlled
  evidence. Treat implementation as complete and activation/attribution as
  evidence-deferred. The exact pre-slice rollback boundary is `b4a11f1`; do not
  claim the compact prompt/atomic tool slice won a controlled latency or quality
  comparison.

## Closure changes after the pre-production audit

- Direct-talk activation now records the exact monotonic initiating tap through
  the Realtime data channel becoming live as `tapToLiveMs`. The tap marker never
  enters review metadata; only its bounded duration is persisted.
- Convex analytics, the admin QA rollup, the voice-eval report, runtime-profile
  comparisons, and model/reasoning-cell comparisons expose tap-to-live p50/p95.
- Focused validation covers the cue measurement, latency reducer/eval,
  persistence schemas, review snapshot, and debug route. The candidate gate
  still remains sparse until real controlled sessions exist.
- The controlled human QA script covers pauses, email dictation, corrections,
  Bahasa Melayu, and interruption. Manglish and explicit per-cell result
  recording are added to the instant-voice release protocol; no unperformed
  human result is represented as passed.

## APR adjudication

- The concise APR ship-blocker adjudication is tracked at
  `.apr/rounds/oriental-voice-final-verdict/round_1.md`.
- It returned `VERDICT: SHIP SAFE DEFAULTS`: production promotion is defensible
  only while `instant-v1`, candidate model, and minimal reasoning remain off.
- Its missing-proof findings above were reconciled with named test evidence.
  Its correctly identified empirical gaps remain open: no qualifying
  returning-visitor distribution, controlled multilingual/correction results,
  false-endpoint/contact-correction comparison, or human Malaysian voice
  sign-off exists.
- Focused correction review
  `.apr/rounds/oriental-voice-final-verdict/round_2.md` confirmed the PR4
  classification, required only the reduced-motion evidence-attribution wording
  now used above, found no runtime/privacy/persistence/rollback blocker, and
  again returned `VERDICT: SHIP SAFE DEFAULTS`.

## Requested APR decision

Find any source-conversation requirement or release risk still absent from the
plan, contract, tests, or runtime evidence. Then decide whether the exact merged
code can be promoted under the safe default profile and list the smallest
concrete corrections required before and after that production deploy.
