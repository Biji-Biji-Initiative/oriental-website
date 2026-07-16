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
  source/status/confidence/match provenance through the Convex validator and schema. The compatibility
  retry strips the new field only when talking to an older Convex deployment.
- The dialog has an automated 320x568, 360x800, 390x844, 844x390, 1024x600,
  1280x720, and 1440x900 containment and responsive-scroll reset regression
  across desktop and mobile projects. >=1024 uses three independent scrolling
  panes. Mobile opens on the
  dialog rather than focusing an input and summoning the keyboard; desktop
  retains first-field focus. The approved Mereka M geometry replaces the
  generic blue orb in compact UI and the particle M remains resolved at rest.
- Permission copy no longer promises a one-time browser prompt: it explains
  every-visit versus one-time access, and blocked-mic recovery points to the
  browser address-bar control. Mic tracks are still released on close.
- Latency telemetry now stores bounded PII-free per-tool name/outcome,
  response-created-to-call, execution, and result-dispatch samples. Structured
  logs aggregate p50/p95 by tool. Lead persistence and notification fan-out
  start concurrently, preserving all prior durability and failure semantics.
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

The source staging stack was already live at
`17992e88405c29b5f800da30922a39d87d9495f9` before this integration. The final
governed merge SHA will include later operations/performance changes and must be
redeployed/re-proven; the historical staging SHA is not final release evidence.

The governed production contract is `baseline/control/low/adaptive`. The
runtime/model/reasoning evidence gate remains
`insufficient_data`; this release does not alter that decision.

## Current clean candidate verification

Candidate `c9aece4330a0022e21f53a22ba52fed54411fd56` was verified from a clean,
detached worktree so unrelated shared-checkout admin edits could not enter the
release evidence.

- `pnpm lint`: 195 files, no findings.
- `pnpm typecheck`: passed.
- `pnpm test`: 50 files and 319 tests passed.
- `pnpm check-secrets`: contract passed; local credentials intentionally absent.
- `pnpm build`: production standalone build passed.
- `pnpm test:performance`: LCP 456 ms, CLS 0, initial JavaScript 397,042
  transferred / 1,367,268 decoded bytes, zero serious/critical axe findings.
- Full Playwright run: 30 public-site tests passed across Chromium desktop and
  Pixel 7 projects; 12 admin tests were explicitly skipped because the local
  admin credential was absent. The focused Mereka mark, permission-copy, and
  seven-viewport matrix passed 8/8 across both projects.
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
