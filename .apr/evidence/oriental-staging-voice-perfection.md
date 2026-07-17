# Implementation evidence — PR68 corrective release integration

## Exact implementation and live boundary

- Corrective implementation: `24349a2207e450265aa02e3f77fb9a8d49d9c83c`.
- Base: `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e` (`origin/main` when
  the isolated integration branch was created).
- The implementation commit follows the two rebased PR68 commits
  `63ef9cdc1a4abe747cca4bfdeeb008351e082c6c` and
  `924823282f49e970b9821286300c806723c5a562`.
- Read-only public health on 2026-07-17, after the operator reported the site
  live, showed canonical staging healthy on
  `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e` with
  `baseline/candidate/gpt-realtime-2.1/low/adaptive`, picker off. Production was
  healthy on `0f5c07e60d956abadff2e9d1e346db585e41a9be` with
  `baseline/control/gpt-realtime-2/low/adaptive`, picker off.
- The corrective implementation SHA is not represented as deployed. No
  staging, production, Infisical, Coolify, DNS, or Convex mutation was performed
  from this isolated worktree.
- The parent release owner will integrate this commit with the concurrent admin
  and release work. That combined exact tree receives the authoritative APR and
  live release evidence; the force-updated PR68 branch review is not evidence
  for the combined tree.

## Corrective implementation map

- `components/brand-motion/NebulaM.tsx`,
  `components/brand-motion/MerekaSiteLoader.tsx`, `app/layout.tsx`, and
  `app/globals.css` make the approved Mereka M nebula and entrance treatment
  normal staging-and-production visuals. The obsolete public build flag and
  hostname gate were removed; reduced-motion and WebGL failure still use the
  canonical SVG fallback.
- `lib/voice/audio-reactivity.ts` raises the learnable floor, adds separate
  open/close thresholds, and proves that sustained 0.12, 0.16, and 0.20 room
  noise converges inactive after a long capture while quiet speech remains
  visible.
- `components/voice-agent/VoiceAgentDialog.tsx` and
  `lib/voice/conversation.ts` keep an unfinished typed-only handoff when the
  visitor closes and reopens the same intake. Form mode controls focus; an
  external email prefill or completed submission still starts clean.
- `scripts/lib/release-governance.ts`, `scripts/deploy-coolify-host.sh`,
  `scripts/release-preflight.ts`, `scripts/release-verify.ts`, and
  `scripts/smoke-staging-voice.ts` split clean candidate runs from human voice
  auditions. Clean staging candidate is picker-off; audition is explicit,
  staging-only, and invalid as model-promotion evidence. Production remains
  control/picker-off and rejects audition mode.
- `clear_fields` remains the canonical clear-all tool label in the runtime,
  bounded schema, Convex validators/schema, persistence path, and aggregate
  output. It is not rewritten to the distinct single-field `clear_field`
  operation. This validator change requires the reviewed Convex functions to
  deploy before the web image.
- `lib/eval/voice-eval.ts` reports PII-free tool counts, outcomes, and p50/p95
  execution/response latency overall and by canonical tool name.
  `scripts/eval-voice.ts` enriches only missing historical voice profile fields
  through the existing per-session query with bounded concurrency. Aggregate
  mode remains zero-mutation, identifier-free, judge-free, and report-free.
- `AGENTS.md`, infrastructure/runbook/spec documents, and APR workflows now
  encode the same release contract. Production preflight explicitly runs with
  `NODE_ENV=production`, and final dual-host verification explicitly expects
  clean candidate staging rather than silently defaulting staging to control.

## Executed evidence on the corrective implementation

- Focused corrective proof: 9 files, 117 tests passed.
- `pnpm test`: 61 files, 616 tests passed.
- `pnpm lint`: 233 files clean.
- `pnpm typecheck`: route generation and TypeScript passed.
- `pnpm build`: optimized Next.js production build and route generation passed.
- `pnpm exec playwright test tests/e2e/home.spec.ts`: 38/38 desktop and mobile
  cases passed. The first run exposed the typed-only close/reopen reset; after
  fixing the open/reset boundary, the exact regression passed 2/2 and the full
  matrix passed 38/38.
- `git diff --check`: clean before the implementation commit.
- Four unrelated zero-byte package/lock artifacts in `/home/gurpreet` broke
  Node package-scope validation. After explicit parent authorization they were
  preserved, not deleted, under
  `/home/gurpreet/.quarantine/oriental-node-artifacts-20260717T153900+0800/`;
  the clean validation above then ran without package-resolution warnings.

## Remaining integration and release gates

1. Apply the implementation and this evidence commit to the concurrent combined
   release tree and resolve any overlaps there.
2. Run the authoritative automated plan review against that exact combined tree,
   then require green GitHub CI and freeze the final merged SHA.
3. Run managed Infisical parity for clean staging candidate and production
   control, plus production-mode release preflight.
4. Deploy the reviewed Convex schema/functions first because the bounded tool
   validator now accepts canonical `clear_fields`.
5. Deploy and prove the exact final SHA on canonical staging in clean mode; run
   deterministic verification, real WebRTC/audio smoke, and synthetic no-submit
   intake smoke. Run human picker auditions only as a separately labelled mode.
6. Promote that same proven web SHA through the Coolify production API while
   retaining `baseline/control/gpt-realtime-2/low/adaptive`, picker off, then
   verify both canonical hosts with the explicit clean staging candidate flags.
7. Collect fresh aggregate-only evidence after release. Candidate promotion
   remains `insufficient_data` until the defined sample and human-quality gates
   pass; this code integration does not claim the product experiment is proven.
