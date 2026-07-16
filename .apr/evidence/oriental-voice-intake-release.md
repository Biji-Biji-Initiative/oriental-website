# Oriental voice intake release — implementation evidence

## Change boundary

- `lib/voice/realtime-call-failure.ts` parses cloned SDP error responses and
  separates transient capacity, exhausted quota, and transport failures.
- `useRealtimeVoiceSession.ts` classifies each failed response before retry
  selection; only `realtime_busy` enters the existing one-shot jittered loop.
- `realtime-events.ts` carries explicit capture mode and verification state.
  Adaptive mode accepts only syntax-valid, model-evidence-grounded, latest-turn
  exact/bounded-ASR email values; strict retains exact readback and explicit
  confirmation. Corrections invalidate and re-evaluate prior evidence.
- `VoiceAgentDialog.tsx`, `useVoiceRuntime.ts`, and `HandoffPanel.tsx` keep the
  editable draft visible, focus failed fields, make typed edits authoritative,
  and stop unconfirmed voice submission.
- `/api/leads` requires the verification marker for voice source and strips it
  before persistence. Form submissions are unchanged.
- Typed turns always serialize cancel, clear, text, response. Expected cancel
  races remain review data but are filtered from actionable warnings.
- Convex review heartbeats update `leadId` only when provided, preserving the
  durable submission relationship.
- Evaluation separates quota/capacity/transport totals and excludes only
  reserved `@example.test`/named smoke sessions.
- `capture_fields` now applies one reducer transaction per turn while retaining
  independently valid fields and returning rejected entries for focused retry;
  duplicate keys abort before commit.
- Native-audio name drift is constrained by an explicit name cue plus a
  one-edit phonetic skeleton, with a negative regression proving that Gareth
  cannot ground Gurpreet. Adaptive email drift is accepted only with an email
  cue and edit distance `<= min(3, floor(18% length))`; strict keeps it pending.
- Review snapshots persist only PII-free capture mode plus email-verification
  source/status/confidence/match provenance through the Convex validator and
  schema. The compatibility retry strips the new field only when talking to an
  older Convex deployment.
- The dialog has an automated 320x568, 360x800, 390x844, 844x390, 1024x600,
  1024x390, 1024x651, 1024x675, 1024x700, 1280x651, 1280x675,
  1280x720, 1440x651, 1440x690, and 1440x900 containment and responsive-scroll reset regression
  across desktop and mobile projects. The primary action is asserted inside
  the initial scroll region before any scroll. >=1024 uses three independent
  scrolling panes. Short/mobile layouts focus the dialog rather than an input;
  wide desktop retains first-field focus. The approved Mereka M geometry
  replaces the generic blue orb in compact UI and the particle M remains
  resolved at rest.
- Mobile DOM order now matches the visible voice, partner, handoff order; the
  first Tab stays in the voice region without scrolling the layout. Desktop
  uses explicit grid placement. The tuner label passes 4.5:1 contrast.
- The live assistant caption has separate bounded styling from the idle
  headline, remains visually above the primary action, is `aria-hidden` to
  avoid duplicate announcements, and leaves the transcript as the accessible
  log. A 220-character fixture proves the action remains initially visible at
  320x568, 844x390, and 1024x600.
- Permission copy no longer promises a one-time browser prompt: it explains
  every-visit versus one-time access, and blocked-mic recovery points to the
  browser address-bar control. Mic tracks are still released on close.
- Latency telemetry now stores bounded PII-free per-tool name/outcome,
  response-created-to-call, execution, and result-dispatch samples. Structured
  logs aggregate p50/p95 by tool. Completed tool samples publish review
  metadata immediately, including `wait_for_user` and replacement of the
  oldest sample after the 120-sample buffer fills. Lead persistence and
  notification fan-out start concurrently, preserving all prior durability and
  failure semantics.
- The live voice smoke derives its expected model/cell from `/api/health` unless
  an operator explicitly pins an expected value, so safe-control release proof
  cannot accidentally require or claim candidate promotion.

## Verification surface

Focused tests cover classifier bodies (including malformed 429), capacity-only
retry selection, adaptive/strict email grounding/correction, API 409,
typed event ordering, durable lead linkage, PII-free telemetry, aggregate
availability, and synthetic exclusion. `smoke-staging-intake.ts` uses the
reserved `qa.nebula@example.test` address. Its executable assertions:

1. wait until the normalized address populates the Email input;
2. require adaptive capture copy and prove its closest form label is Email;
3. require mandatory-confirmation copy to remain absent;
4. require a subsequent Reka transcript turn without sending a confirmation;
5. require the captured address to remain exact and the `/api/leads` POST count
   to remain zero; and
6. end voice cleanly and require zero page or console errors.

That script passed against the source staging stack at `17992e8` before
integration. It must run again against the final merge SHA; historical proof is
not substituted for the final release gate.

Staging currently remains on
`ba9e22dd15a4087aa96a7cea1d3aa685d0d588c4`; production remains frozen on
`bb8e2673e5f129f342fba78f3eb653a54de8763b`. Neither is final candidate proof.
Only the merged SHA may move to staging in this release; production mutation is
outside the approved boundary.

The governed production contract is `baseline/control/low/adaptive`. The
runtime/model/reasoning evidence gate remains
`insufficient_data`; this release does not alter that decision.

## Post-round-4 delta closure

APR round 4 predates the final responsive, capped-telemetry, and release-cell
closures below. It is historical evidence, not the final verdict for this
candidate.

- `6b39882` changed metadata publication from array-length comparison to array
  identity. The reducer always creates a new bounded array for a valid sample,
  so the 121st call still publishes even though retained length stays 120. Unit
  tests cover both `wait_for_user` and the full-buffer replacement.
- The release-governance delta made the picker fail closed unless its literal
  value is `false`, added an executable voice-cell parity check, and made
  staging's governed `.env` materialization use fully rendered same-directory
  files, fsync, and atomic replace while preserving file modes and unrelated
  settings. The selected model cell defaults to control, candidate requires an
  explicit staging argument, and every production host path rejects candidate.
  The embedded reconciler fixture executes the actual deployment heredoc.
- Native Infisical environments passed the executable redacted parity check on
  2026-07-16: staging is
  `baseline/candidate(gpt-realtime-2.1)/low/adaptive`, picker `false`; production
  is `baseline/control(gpt-realtime-2)/low/adaptive`, picker `false`. Neither
  secret values nor credentials were printed, and running production was not
  changed.
- `5087f5b` integrated the teammate-reviewed initial-fit correction. It moves
  the primary action ahead of composer/topics, bounds the live caption, covers
  the 651–700px height cliff, and adds both component DOM/accessibility proof
  and full browser viewport proof.
- `487777a` closes the exact 1024x390 three-pane cliff, aligns mobile source and
  focus order, keeps the first Tab in the voice region, and fixes tuner-label
  contrast. Runtime tuner resolution now consumes `/api/client-config` and
  fails closed, so query/local preferences cannot expose a picker that the
  environment disables.

## Current clean candidate verification

Runtime candidate `017c1cf` was verified from a clean,
detached worktree so unrelated shared-checkout admin edits could not enter the
release evidence.

- `pnpm lint`: 197 files, no findings.
- `pnpm typecheck`: passed.
- `pnpm test`: 51 files and 325 tests passed.
- `pnpm check-secrets`: contract passed; local credentials intentionally absent.
- `pnpm build`: production standalone build passed.
- `pnpm test:performance`: LCP 576 ms, CLS 0, initial JavaScript 397,230
  transferred / 1,367,784 decoded bytes, zero serious/critical axe findings.
- Full Playwright run: 32 public-site tests passed across Chromium desktop and
  Pixel 7 projects; 12 admin tests were explicitly skipped because the local
  admin credential was absent. The responsive, long-caption, Mereka-mark, and
  permission-focused checks passed across both projects. The live-caption
  component contract also passed independently.
- `git diff --check`: passed.

During integration review, quota classification was found to occur only after
the retry loop. The hook now parses every failed response before calling
`shouldRetryRealtimeCall`; that policy accepts `realtime_busy` only. A focused
test explicitly rejects retry for `realtime_quota_exhausted`.

## APR round 1 correction closure

The first combined intake review blocked because the evidence summarized only
the smoke's no-submit assertion and did not attach the retry/revival proof.
The six concrete smoke assertions are now enumerated above. The actual browser
connection hook received a separate full-code APR trace at
`.apr/rounds/oriental-realtime-busy-recovery/round_4.md`: it proves retry reuse
of the same mint/peer/data channel/offer/stream, monotonic attempt ownership,
manual teardown invalidation, stale-catch isolation, and duplicate-mint gates,
ending `VERDICT: SHIP`.
