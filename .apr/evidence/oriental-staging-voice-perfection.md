# Implementation evidence — staging-only voice perfection integration

## Exact boundary

- Integration base: `d983450c706c734fa7597f907655cf951876ced0`
  (`origin/main` when `fix/staging-voice-final` was created).
- The branch ports the two independently reviewed hardening commits onto that
  base while preserving main's newer privacy, analytics, responsive focus, and
  tool-latency behavior.
- The review target is the exact Git tree attached to the canonical APR run;
  stale SHAs in prose are not release authority.
- No staging, production, shared Convex, DNS, backfill, retention, Infisical,
  or Coolify mutation has been performed from this branch yet.

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
  only PII-free aggregate outcomes/tool latency.
- The current contract and repo guidance explicitly forbid production, Convex,
  and backfill mutation for this staging-only release and require Oracle/APR
  only through `ssh g` or `ssh mereka`.

## Executed evidence so far

- Focused integration proof: 6 files, 512 tests passed.
- `pnpm typecheck`: Next route generation and TypeScript passed.
- Focused tests include 399 deterministic email/realtime cases, immutable
  submission evidence, bounded `--limit` evaluation, versioned prefill,
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
   legacy visual surface. Do not run the production or Convex deployment paths.
