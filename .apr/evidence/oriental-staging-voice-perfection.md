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

## Executed evidence so far

- Post-rebase focused integration proof: 11 files, 549 tests passed.
- Full release-test harness: 82 files, 962 tests passed.
- `pnpm typecheck`: Next route generation and TypeScript passed.
- `pnpm lint`, `pnpm build`, and `git diff --check`: passed.
- Responsive Playwright home proof: 42 desktop/mobile cases passed, including
  the short-landscape picker/dialog, returning-microphone, email-correction,
  and staging brand-motion paths.
- Production performance/a11y proof: LCP 476 ms, CLS 0, 420,731 initial
  JavaScript transfer bytes, and zero serious/critical accessibility findings.
- Focused tests include 399 deterministic email/realtime cases, immutable
  submission evidence, 106 focused eval/data-integrity cases including strict
  cohort completeness and historical debt partitioning, versioned prefill,
  staging/production visual gating, and the long-transcript authority-rebase
  route regression.

## Remaining release gates

1. Run lint, full release tests, secret scan, production build, diff checks,
   responsive Playwright, and relevant performance/a11y gates on the final tree.
2. Obtain a canonical hermetic APR ship verdict via `ssh g` or `ssh mereka`.
3. Push a clean PR, require exact-head green CI, merge once, and freeze the full
   merged SHA.
4. Capture read-only live baselines, converge only the staging Infisical source
   needed for the candidate audition/picker, and deploy the exact merged SHA to
   canonical staging with `--expected-current-sha`, `--voice-model-cell
   candidate`, and `--voice-picker-mode audition`. The host deployer owns the
   staging-only brand-preview build flag and forces every production build off.
5. Run deterministic staging verification, WebRTC/audio smoke, responsive
   browser proof, and synthetic no-submit intake proof. Do not create/backfill a
   real lead because staging shares production data and notification planes.
6. Prove production remained unchanged in SHA, runtime/model cell, picker, and
   current live visual surface. Do not run the production or Convex deployment
   paths.
