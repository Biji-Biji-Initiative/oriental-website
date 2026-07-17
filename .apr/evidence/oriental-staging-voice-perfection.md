# Implementation evidence — Mereka at Oriental staging voice perfection

## Exact candidate and live boundary

- Candidate: `f315523c3ee4d8c8e510a5378c6c1424c7cec58d`.
- Base: `c87c522374d711f5870e4b14ee108157e3561a03` (`origin/main`).
- The candidate is one commit ahead and zero commits behind main.
- `pnpm --silent ops:status --json` on 2026-07-17 reported both canonical
  environments healthy on the unchanged base SHA. Production reported
  `baseline/control/gpt-realtime-2/low`, strict email mode, picker false.
  Staging reported `baseline/candidate/gpt-realtime-2.1/low/adaptive`, picker
  false because this candidate has not been deployed.
- No production or staging web deployment was performed while building or
  reviewing this branch.

## Implementation map

- `components/brand-motion/NebulaM.tsx`, `lib/voice/audio-reactivity.ts`,
  `components/voice-agent/useVoiceAudioLevel.ts`, and `app/globals.css` implement
  bounded voice-reactive brand motion, fallback, and responsive geometry.
- `app/api/client-config/route.ts`, `app/api/voice/session/route.ts`,
  `scripts/lib/release-governance.ts`, `scripts/deploy-coolify-host.sh`, and
  `scripts/release-verify.ts` enforce staging picker/model materialization and
  production fail-closed behavior; `scripts/smoke-staging-voice.ts` proves the
  effective variant, audio, and renderer. The verifier derives expected picker
  visibility from the governed target voice cell, so staging candidate requires
  picker-on while staging baseline and production require picker-off.
- `lib/voice/realtime-events.ts` combines main's authoritative-email response
  binding with exact/high auto-confirmation, approximate/medium readback,
  literal mismatch rejection, bounded exact-readback parsing, explicit
  replacement, full clear-all, and item-ID tombstones.
- `lib/voice/profile.ts`, `components/voice-agent/voice-dialog-copy.ts`, and the
  operator copy identify Mereka as the team and Oriental Building as the place,
  and remove the repeated "quick one" phrase.
- `lib/eval/voice-eval.ts`, `scripts/eval-voice.ts`, and `convex/leads.ts` add
  PII-free integrity/style counters and fully attributed experiment grouping.

## Executed evidence on the rebased candidate

- `pnpm test`: 59 files, 598 tests passed.
- Focused reducer/session/fuzz proof: 3 files, 257 tests passed.
- `pnpm lint`: 224 files clean.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, including Next.js route generation.
- `pnpm test:e2e`: 38 passed; 38 token-gated admin cases skipped as designed.
- Managed Infisical contracts passed in both environments with production-mode
  secret validation. Staging is candidate/picker-on; production is
  control/picker-off. ClickUp token presence and staging/production token parity
  were proven without exposing the credential.
- Independent responsive audit: all 15 requested viewports passed; at 844x390
  and 1024x390 the expanded picker stayed between top 20px and bottom 370px,
  with all five options and Hide reachable and no overflow or console errors.
- Independent email protocol review replayed medium substitutions, exact and
  contaminated readbacks, stale correction races, clear-all out-of-order
  completions, duplicates, unknown/reused IDs, and untagged events. All P1
  findings were fixed. The final reserved-local-part P2 is covered by ten full
  wrapper regressions and equality checks after every wrapper-removal step.
- `git diff --check`: clean. The worktree was clean before this evidence file.

## Remaining post-merge gates

After GitHub CI and merge, freeze the exact full main SHA. Run managed Infisical
cell checks and release preflight, deploy any changed Convex function first,
then deploy only that exact SHA to canonical staging with the live staging SHA
as `--expected-current-sha`. Run deterministic release verification, real
WebRTC/audio reactivity smoke, and synthetic no-submit intake smoke. Finally
prove production SHA/model/picker remain unchanged. Historical candidate eval
rows and picker-audition rows must not be presented as a clean model comparison.
