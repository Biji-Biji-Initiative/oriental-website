# Implementation evidence — staging-only voice perfection integration

## Exact boundary

- Integration base: `401a04f12119bd41751af172f9255bdb25bacf38`
  (current `origin/main` after the final conflict-free rebase).
- The branch ports the two independently reviewed hardening commits onto that
  base while preserving main's newer privacy, analytics, responsive focus, and
  tool-latency behavior.
- The review target is the exact Git tree attached to the canonical APR run;
  stale SHAs in prose are not release authority.
- No staging, production, shared Convex, DNS, backfill, retention, Infisical,
  or Coolify mutation has been performed from this branch yet.
- Read-only pre-merge baseline: both public hosts run
  `401a04f12119bd41751af172f9255bdb25bacf38`; production is
  `baseline/control/gpt-realtime-2/low/adaptive` with picker off. That older
  production image already renders Trace and the Nebula. This staging-only
  release must leave its SHA and live surface unchanged; the reviewed legacy/
  no-Trace production fallback is code evidence, not a claim that production
  already runs this candidate.

## Implementation map

- `lib/brand-motion.ts`, `VoiceSessionStage.tsx`, `MerekaSiteLoader.tsx`, and
  `MiniOrb.tsx` make preview enablement a two-key decision: the public build
  flag plus exact staging/local host. Production falls back to the legacy orb
  and no Trace entrance.
- `NebulaM.tsx` remains raw WebGL with about 2,100 bounded point sprites,
  pointer tilt, microphone/remote-audio envelopes, reduced-motion behavior,
  and static-mark fallback.
- `voice-state.tsx`, `VoiceAgentDialog.tsx`, and `prefill-request.ts` implement
  versioned, compare-and-swap one-shot prefill revocation without regressing
  main's responsive focus, analytics, or typed-draft continuity.
- `realtime-events.ts` contains the reviewed deterministic address-authority
  grammar for selection, correction, direct/anaphoric rejection, competing
  literals, third-party/department/historical/example scoping, typed authority,
  and out-of-order ASR fencing.
- `voice-submission-evidence.ts`, `server/voice-submission-evidence.ts`, the lead
  route, and schema transform bind the accepted lead to review/session/email/
  transcript authority with HMAC evidence. Sequence rebasing preserves the
  evidence window after transcript byte/character bounding.
- `voice-eval.ts` and `scripts/eval-voice.ts` recover immutable lead evidence,
  join before reconnect folding, bound the lead scan to the live Convex cap,
  query exact durable sessions for signed leads outside `--limit`, and expose
  only PII-free aggregate outcomes/tool latency. Aggregate schema v2 adds a
  strict post-cutoff/environment/model cohort, proves the existing 200-row
  updated-at window and bounded created-at lead window cover the cutoff, rejects
  empty current quality evidence, and refuses to treat exact-limit reconnect
  history as complete or promotion-eligible. It separates synthetic pipeline
  health from customer quality and promotion, and reports pre-cohort
  missing/invalid v1 only as bounded non-authoritative evidence debt. No
  Convex/schema deployment or backfill is required.
- The current contract and repo guidance explicitly forbid production, Convex,
  and backfill mutation for this staging-only release and require Oracle/APR
  only through `ssh g` or `ssh mereka`.
- The production hostname now overrides a stale candidate model-cell setting at
  session mint time, and the host deployer rejects an omitted source SHA instead
  of resolving a moving `origin/main`.

## Executed final-tree evidence

- `pnpm exec vitest run` on the five changed runtime/eval suites: 5 files,
  1,635 tests passed. The reducer/session subset passed 1,528 tests.
- Full `scripts/run-release-tests.ts` harness: 82 files, 2,177 tests passed.
  This includes release governance, secret policy, deploy/rollback contracts,
  realtime ordering/fuzzing, email authority, immutable submission evidence,
  aggregate-only eval failure semantics, privacy, telemetry, and UI contracts.
- `pnpm lint`, `pnpm typecheck`, `git diff --check`, and the optimized
  `pnpm build`: passed on the exact uncommitted tree described here.
- Full Playwright matrix: 90 cases, 44 public/voice/responsive desktop and
  mobile cases passed; 46 credentialed admin cases were intentionally skipped.
  Passing cases include the short-landscape picker/dialog, returning microphone
  prewarm, viewport containment, breakpoint email correction, staging picker,
  long captions, mobile focus/source order, and no duplicate lead posts.
- Independent responsive review reran 62/62 visual/gating contracts and
  1,241/1,241 runtime-to-UI boundary contracts. Independent language/authority
  and final-diff/lifecycle reviewers both returned `MERGE` on the exact tree.
- The deterministic correction matrix covers typed, tagged ASR, and tagged ASR
  with an active response; single and batched capture tools; punctuation,
  ellipsis, newline, filler, and contraction variants; final-vs-stale correction
  ordering; third-party/department/history/example ownership; and persistence
  across the next benign server event.
- Earlier performance/a11y proof on the unchanged visual implementation showed
  LCP 476 ms, CLS 0, and zero serious/critical accessibility findings. The final
  exact browser/build gates above are release authority for this tree.
- Read-only live evidence before merge found the current staging candidate
  cohort historically fails promotion quality (including prior quota and email
  failures) while the synthetic pipeline passes. This release therefore does
  not claim a green live promotion gate before deployment; post-deploy staging
  sessions must establish the new cohort. No eval, lead, backfill, retention, or
  Convex mutation was used to manufacture evidence.

## Remaining release gates

1. Commit and push this tested tree, then obtain a canonical hermetic APR ship
   verdict for the exact pushed SHA via `ssh g` or `ssh mereka`.
2. Require exact-head green CI, merge once, and freeze the full
   merged SHA.
3. Capture read-only live baselines, converge only the staging Infisical source
   needed for the candidate audition/picker, and deploy the exact merged SHA to
   canonical staging with `--expected-current-sha`, `--voice-model-cell
   candidate`, and `--voice-picker-mode audition`. The host deployer owns the
   staging-only brand-preview build flag and forces every production build off.
4. Run deterministic staging verification, WebRTC/audio smoke, responsive
   browser proof, and synthetic no-submit intake proof. Do not create/backfill a
   real lead because staging shares production data and notification planes.
5. Prove production remained unchanged in SHA, runtime/model cell, picker, and
   current live visual surface. Do not run the production or Convex deployment
   paths.
