# Implementation evidence — Mereka at Oriental staging voice perfection

## Exact candidate and live boundary

- Candidate implementation: `0459383d109955316bf0df93fecdb246b250024c`.
- Base: `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e` (`origin/main`).
- The candidate implementation is five commits ahead and zero commits behind
  main; the following evidence-only commit does not alter runtime code.
- `pnpm --silent ops:status --json` on 2026-07-17 reported both canonical
  environments healthy on the unchanged base SHA. Production reported
  `baseline/control/gpt-realtime-2/low/adaptive`, picker false.
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
- `lib/eval/voice-eval.ts` and `scripts/eval-voice.ts` add PII-free
  integrity/style counters and fully attributed experiment grouping. The
  harness enriches only missing bulk-query attribution through the already
  deployed read-only `voiceSessionByReviewId` function with bounded
  concurrency; no shared Convex function deploy is required.
- `lib/server/convex.ts` preserves the complete staging snapshot against the
  deployed legacy validator. The API logs canonical `clear_fields` before
  persistence, while the durable wire sample uses the compatible
  `clear_field` alias and retains its sequence, outcome, execution and response
  timings, turn aggregates, transport, runtime/model/voice/variant attribution,
  and email-verification metadata. There is no candidate diff under `convex/`.

## Executed evidence on the rebased candidate

- `pnpm test`: 61 files, 612 tests passed.
- Focused reducer/session/fuzz proof: 3 files, 257 tests passed.
- `pnpm lint`: 233 files clean.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, including Next.js route generation.
- `pnpm test:e2e`: 38 passed; 38 token-gated admin cases skipped as designed.
- `pnpm test:performance`: mobile performance budget passed with 480 ms LCP,
  zero CLS, and zero serious/critical accessibility violations.
- Managed Infisical contracts passed in both environments with production-mode
  secret validation. Staging is candidate/picker-on; production is
  control/picker-off. ClickUp token presence and staging/production token parity
  were proven without exposing the credential.
- Independent responsive audit: all 15 requested viewports passed; at 844x390
  and 1024x390 the expanded picker stayed between top 20px and bottom 370px,
  with all five options and Hide reachable and no overflow or console errors.
- Independent post-rebase audit preserved PR #67's GA runtime configuration and
  dark admin styling, proved staging picker-on and canonical production
  picker-off together, and caught one screen-reader-only identity leak. The
  caption now says "Mereka at Oriental"; 20 focused tests, lint, and diff-check
  passed after reconciliation.
- Independent email protocol review replayed medium substitutions, exact and
  contaminated readbacks, stale correction races, clear-all out-of-order
  completions, duplicates, unknown/reused IDs, and untagged events. All P1
  findings were fixed. The final reserved-local-part P2 is covered by ten full
  wrapper regressions and equality checks after every wrapper-removal step.
- `git diff --check`: clean. The worktree was clean before this evidence file.
- Zero-shared-Convex compatibility proof: 2 focused files, 18 tests passed;
  typecheck passed. The integration test proves a legacy bulk row is enriched
  read-only into the exact `kl-polished/marin/1.22` experiment cell without
  writing files or exposing identifiers.

## Remaining post-merge gates

After GitHub CI and merge, freeze the exact full main SHA. Run managed Infisical
cell checks and release preflight. Do **not** deploy Convex or mutate any shared
production data plane. Deploy only that exact web SHA to canonical staging with
the live staging SHA as `--expected-current-sha`. Run deterministic release
verification, real WebRTC/audio reactivity smoke, and synthetic no-submit
intake smoke. Finally prove production SHA/model/picker/image remain unchanged.
Historical candidate eval rows and picker-audition rows must not be presented
as a clean model comparison.
