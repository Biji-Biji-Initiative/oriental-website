# Implementation evidence — Mereka at Oriental staging voice perfection

## Exact candidate and live boundary

- Candidate implementation: `1b2fd629bdfc625da3227686f80aebba945405cf`.
- Base: `82b95bf97cd53dbb68687f557dd06c064947415b` (`origin/main`).
- The candidate implementation is thirteen commits ahead and zero commits behind
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
  literal mismatch rejection, unique authorized correction selection,
  whole-turn exact-readback parsing, explicit replacement, full clear-all, and
  bounded fail-closed item-ID tombstones.
- `lib/voice/profile.ts`, `components/voice-agent/voice-dialog-copy.ts`, and the
  operator copy identify Mereka as the team and Oriental Building as the place,
  and remove the repeated "quick one" phrase.
- `lib/eval/voice-eval.ts` and `scripts/eval-voice.ts` add PII-free
  integrity/style counters and fully attributed experiment grouping. The
  harness enriches missing render attribution through the already deployed
  read-only `voiceSessionByReviewId` query and compares corrections to the
  immutable routed lead through the existing bounded `adminLeadTable` query;
  no shared Convex function deploy is required. Missing, invalid, ambiguous, or
  unavailable attribution fails closed at the default zero-tolerance capture
  gate. Experiment proof requires one complete control voice-profile baseline
  and rejects reconnect drift across environment, runtime, input policy, model,
  reasoning, variant, voice, or speed before aggregation.
- `lib/server/convex.ts` preserves the complete staging snapshot against the
  deployed legacy validator. The API logs canonical `clear_fields` before
  persistence, while the durable wire sample uses the compatible
  `clear_field` alias and retains its sequence, outcome, execution and response
  timings, turn aggregates, transport, runtime/model/voice/variant attribution,
  and email-verification metadata. There is no candidate diff under `convex/`.
- `components/voice-agent/VoiceAgentDialog.tsx` treats ordinary hidden-tab and
  BFCache transitions as non-terminal keepalive snapshots, while a real page
  exit shares a per-review one-shot close guard with normal teardown.
  `app/api/voice/debug/route.ts` requires a persisted snapshot, a close reason,
  and `closedAt` before auto-evaluation, deduplicates successful scoring, and
  deliberately permits a repost to retry when every judge produced zero
  persisted scores.

## Executed evidence on the rebased candidate

- `pnpm test`: 63 files, 673 tests passed.
- Focused realtime/fuzz/notification proof: 289 tests passed.
- Focused evaluator matrix: 5 files, 99 tests passed.
- `pnpm lint`: 237 files clean.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, including Next.js route generation.
- `pnpm test:e2e`: 38 passed; 38 token-gated admin cases skipped as designed.
- `pnpm test:performance`: mobile performance budget passed against the exact
  production build with 564 ms LCP, zero CLS, and zero serious/critical
  accessibility violations.
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
- Independent lifecycle review verified hidden-tab heartbeat, BFCache,
  terminal one-shot, `closedAt` gating, successful-eval deduplication, and the
  zero-persisted retry path. Its focused matrix passed 14 tests, typecheck,
  Biome, and diff-check after the final fix.
- `git diff --check`: clean. The worktree was clean before this evidence file.
- Zero-shared-Convex compatibility proof: 2 focused files, 18 tests passed;
  typecheck passed. The integration test proves a legacy bulk row is enriched
  read-only into the exact `kl-polished/marin/1.22` experiment cell without
  writing files or exposing identifiers.
- APR round 1 ran hermetically on canonical host `g` against exact PR head
  `02fdab674eb0ce47a40b7a810ebaaeeaadd2efcb`, base
  `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e`, and complete patch SHA-256
  `04a6642d8b38f1c9db16ee20e6aecc014e122d028644d9f1ae67b9e9ac8faff6`.
  Its saved `VERDICT: DO NOT MERGE` identified four blockers. Commit
  `d8e18b7c88a6c398b1541bdec0f8aed2b4e77f08` closes all four: picker and
  submitted variants now require the canonical staging hostname; URL/storage
  visibility authority is removed; stale submissions no longer depend on a
  rejection event; and attribution/confound validation fails closed. The
  post-fix focused matrix passed 78 tests, including query failure, missing
  profile, candidate-only baseline, voice/speed drift, and mixed reconnects.
- APR round 2 ran hermetically on canonical host `g` against exact PR head
  `0562883b9c06bf1917d9e56959fa6421c2b09058`, base
  `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e`, and complete patch SHA-256
  `fcdb7e50073a8fade4235b618eedb9caac0c51e263166375dab6eaee4e9bbe63`.
  Its authoritative saved result has SHA-256
  `98331c926352ad8ef0bc296af5925bb3efd4c8b8daed94c316688d4ccb80310a`
  and `VERDICT: DO NOT MERGE`. The candidate closes all seven findings:
  contradicted and competing literals fail closed; contaminated readbacks
  cannot confirm; immutable routed-email attribution recognizes spoken
  corrections; every full reconnect experiment profile is fenced; settled and
  evicted transcript IDs stay retired; the audio envelope learns the complete
  bounded signal range while recovering quiet speech after environment changes;
  and email, Slack, and ClickUp operator copy consistently says Mereka at
  Oriental. Independent adversarial replays plus the full matrix above are
  green after integrating current `origin/main`.

## Remaining post-merge gates

After GitHub CI and merge, freeze the exact full main SHA. Run managed Infisical
cell checks and release preflight. Do **not** deploy Convex or mutate any shared
production data plane. Deploy only that exact web SHA to canonical staging with
the live staging SHA as `--expected-current-sha`. Run deterministic release
verification, real WebRTC/audio reactivity smoke, and synthetic no-submit
intake smoke. Finally prove production SHA/model/picker/image remain unchanged.
Historical candidate eval rows and picker-audition rows must not be presented
as a clean model comparison.
