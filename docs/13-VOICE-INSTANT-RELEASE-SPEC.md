---
title: "Oriental Instant Voice Architecture v1"
type: "voice_ai_spec"
status: "implemented_evidence_gated"
owner: "Mereka Engineering"
vehicle: "web_webrtc"
last_updated: "2026-07-16"
links:
  related_docs:
    - "05-VOICE-AGENT-SPEC.md"
    - "06-API-CONTRACTS.md"
    - "11-INFRASTRUCTURE.md"
---

# Human Summary

## What this release does

This release makes Reka acknowledge activation immediately, measures the real
browser voice path without mislabelling transcript events as audible audio,
adds a rollback-safe adaptive endpointing profile, and shortens the permanent
prompt/tool path. Model, reasoning, endpointing, and voice-persona choices stay
independent so evaluation remains attributable.

## Why it matters

Visitors should feel that voice has started immediately and should receive a
faster response without increasing false cutoffs, barge-in lag, or contact
corrections. Operators must be able to compare cells, roll back each risky
dimension, and prove the exact staged commit before promotion.

# Agent Contract

## Scope

- WebRTC browser voice on Oriental production and staging.
- Activation, turn phase, endpoint/VAD, model/tool/playout telemetry, compact
  prompt/tools, evaluation, staged release, and rollback.
- Persisted session metadata in the existing bounded Convex `voiceSessions`
  record and latency object.

## Non-goals

- This release MUST NOT automatically mutate production environment variables.
- It MUST NOT store raw audio or raw wall-clock timing in latency samples.
- It MUST NOT equate transcript/output-event onset with audible audio.
- It MUST NOT enable full peer pre-negotiation without evidence that negotiation
  remains a material bottleneck.
- It MUST NOT enable a local hedged backchannel until collision/cancellation
  behaviour can be measured against true remote-audio onset.

## Requirements

### Latency and interaction

- The initiating action MUST schedule a local arm cue and expose the scheduling
  duration separately from speaker output.
- Direct-talk activation MUST measure the initiating tap through the Realtime
  data channel becoming live. Only the duration is persisted; the monotonic tap
  marker MUST remain browser-local. Returning-visitor tap-to-live is an
  experimental SLO of less than 500 ms p50, not a claim about current results.
- The primary product metric MUST be useful voice start within two seconds:
  initiating tap through independently detected remote audio. The evaluator
  MUST report the post-mint denominator explicitly and MUST NOT imply that it
  includes client-secret mint failures.
- New snapshots MUST persist an explicit activation-attempt marker before the
  SDP exchange so a missing latency payload counts as a failed attempt without
  misclassifying unused prewarms or legacy rows.
- `connectionStatus` MUST remain transport state; conversational activity MUST
  use orthogonal `turnPhase` state.
- Waiting copy MUST be delayed approximately 300 ms and MUST not claim semantic
  understanding before a model response.
- Reduced-motion mode MUST suppress visual animation without disabling audio
  activity measurement.
- Per-turn telemetry MUST retain at most 80 samples and MUST include available
  speech, endpoint, response-created, first-output, remote-audio, playout,
  browser-tool, response, interruption, and rapid-resume durations/signals.
- Per-tool telemetry MUST retain at most 120 PII-free samples with a bounded
  tool name, outcome, browser execution/result-dispatch duration, and available
  response-created-to-call/result durations. It MUST NOT persist arguments,
  contact values, call IDs, or raw browser timestamps.
- An OpenAI Realtime SDP capacity `429` MUST receive at most one retry after
  300–700 ms jitter. The retry MUST reuse the existing mint, offer, microphone,
  and typed context; other status codes, mic denial, and malformed sessions
  MUST NOT use this retry path. A 429 body with `insufficient_quota` MUST be
  classified before retry selection and close immediately as
  `realtime_quota_exhausted`.
- A typed turn MUST cancel and clear queued output before sending text even if
  `response.created` has not arrived, preventing opener/typed-turn races.

### Endpointing and controlled cells

- `VOICE_RUNTIME_PROFILE=baseline` MUST restore semantic VAD `auto`.
- `instant-v1` MUST use `high` eagerness normally and deterministic `low`
  eagerness only after Reka asks for an email, returning to fast on the next
  response.
- Runtime profile/input policy, model/reasoning cells, and voice variant MUST be
  persisted and comparable independently.
- Conversation stitching MUST retain every activation attempt and every close
  reason. A later successful reconnect MUST NOT erase an earlier failed useful
  start or mid-utterance drop.
- New snapshots MUST persist server-resolved deployment environment and device
  class so staging smokes cannot be mistaken for production evidence.
- Control MUST remain `gpt-realtime-2`/`low` unless an explicit cell is selected.
- The first model-only candidate MUST be `gpt-realtime-2.1`, holding runtime,
  reasoning, voice, device, network class, and corpus constant. Its documented
  alphanumeric, silence/noise, and interruption improvements match Oriental's
  capture and barge-in risks.
- `gpt-realtime-2.1-mini` MAY be evaluated later as a separate speed/cost cell;
  it MUST NOT be combined with the first `gpt-realtime-2.1` quality comparison.
- At most one of runtime profile, model cell, and reasoning cell MAY differ
  from control in one deployment. The QA voice-variant picker MUST remain off
  while any experimental dimension is active.
- Evaluator cohort keys MUST include runtime, model, and reasoning, and a row
  varying more than one non-control dimension MUST fail evidence validation.
- Configured judge thresholds MUST fail closed when no conversations have
  valid scores.

### Prompt, tools, and capture

- The permanent prompt MUST remain below 7 KB and detailed facts MUST remain
  behind bounded read-only `lookup_oriental`.
- Reversible fields MUST be captured with one `capture_fields` batch per turn.
  Independently valid fields MUST be retained and invalid or ungrounded items
  returned in `rejectedFields` for focused retry; duplicate keys MUST reject
  the batch before any field is committed.
- Routing and end-call actions MUST remain explicit and separate.
- Tentative email extraction MAY fill an empty draft only for a literal address
  alone or with explicit visitor ownership; it MUST NOT infer spoken punctuation
  and MUST NOT overwrite an existing/corrected value.
- `VOICE_EMAIL_CAPTURE_MODE=adaptive` MAY immediately confirm a speech email
  only when it passes syntax validation, the model's evidence canonicalizes to
  the exact proposed address, and the latest visitor turn either matches it or
  has an explicit email cue within the bounded ASR distance. Pending native
  transcription may yield medium confidence only when no completed turn
  contradicts the proposed value. Corrections MUST invalidate prior
  verification before routing and re-evaluate from the latest turn; duplicate
  email tool calls MUST pass the same grounding boundary. The address remains
  visible and editable without a blanket confirmation turn.
- `VOICE_EMAIL_CAPTURE_MODE=strict` MUST restore exact readback and grounded
  explicit confirmation. Unknown or missing values MUST resolve to `strict`.
  Typed edits and verified prefills MAY confirm their exact current value in
  either mode. Client and API MUST still reject invalid, pending, ungrounded, or
  stale email values. A typed edit MUST invalidate any already-active response
  for email mutation and routing; older tool output MUST NOT overwrite or
  submit the typed value.

### Quality and promotion

- The promotion gate MUST stay `insufficient_data` until `instant-v1` has at
  least 30 remote-audio samples, 100 endpoint turns, and 20 barge-in samples,
  with at least 20 contact-bearing conversations in both control and candidate.
- A sampled candidate MUST have remote-audio p50 below 650 ms, p95 below
  1,000 ms, possible false-endpoint proxy below 2%, and barge-in p95 below
  250 ms.
- Candidate contact-correction rate MUST be no worse than baseline.
- A gate pass MUST be advisory; deployment still requires reviewed staging
  promotion.

## Acceptance Criteria and Verification

- [x] AC-01 — Turn state and bounded timing reducer: `tests/voice-latency.test.ts`.
- [x] AC-02 — Immediate cues, waiting copy, opener, and reduced motion:
  `tests/voice-cues.test.ts`, `tests/voice-dialog-copy.test.ts`, and
  `tests/voice-audio-activity.test.ts`.
- [x] AC-03 — Profile switching and session updates:
  `tests/voice-runtime-profile.test.ts` and
  `tests/realtime-client-events.test.ts`.
- [x] AC-04 — Compact prompt, read-only lookup, and partial-safe batched capture:
  `tests/voice-profile.test.ts`, `tests/voice-knowledge.test.ts`, and
  `tests/realtime-events.test.ts`.
- [x] AC-05 — Controlled model/reasoning cells:
  `tests/voice-experiments.test.ts` and `tests/openai-realtime.test.ts`.
- [x] AC-06 — Typed duration policy and server timing:
  `tests/voice-session-policy.test.ts` and `tests/voice-session-route.test.ts`.
- [x] AC-07 — Independent remote-audio and per-tool queue/execution/result measurement:
  `tests/voice-audio-activity.test.ts`, `tests/voice-latency.test.ts`, and
  `tests/voice-eval.test.ts`.
- [x] AC-08 — Conservative tentative extraction:
  `tests/voice-tentative-extraction.test.ts` and
  `tests/realtime-events.test.ts`.
- [x] AC-09 — Sparse/pass/fail promotion states:
  `tests/voice-eval.test.ts`.
- [x] AC-10 — Exact tap-to-live telemetry and independent profile/cell rollups:
  `tests/voice-cues.test.ts`, `tests/voice-eval.test.ts`, and the voice QA admin
  table.
- [x] AC-11 — Bounded Realtime-busy recovery, exact retry/remote-track
  diagnostics, tap-to-audible telemetry, and useful-start rollups:
  `tests/realtime-retry.test.ts`, `tests/voice-latency.test.ts`,
  `tests/voice-eval.test.ts`, and `tests/voice-dialog-copy.test.ts`.
- [ ] AC-12 — Staging release proof and human observation.
  - [x] A real staged WebRTC call produced live remote audio.
  - [x] A typed interruption exercised cancellation/barge-in and recovered to a
    new spoken response.
  - [x] Voice mint and review persistence returned HTTP 200 without browser
    errors.
  - [x] `/api/health` proved release
    `bb8e2673e5f129f342fba78f3eb653a54de8763b` on both canonical hosts before
    the next controlled shared-staging experiment; current staging truth must
    always be read live rather than inferred from this historical proof.
  - [ ] A human listener approves Malaysian voice quality; automation cannot
    make this subjective release judgment.

## Edge Cases

- Tool-only `response.done` MUST NOT finalize the spoken turn before the
  follow-up response.
- A route tool failure MUST restore retryable routing state and keep the form
  available.
- Mic denial, mint timeout, SDP failure, transient ICE disconnect, idle close,
  max close, and close while speaking MUST preserve the editable handoff and
  emit the existing close diagnostics.
- A browser clock jump MUST not persist an unbounded tool duration.
- Lead persistence and independent notification fan-out MUST start concurrently
  so `route_to_team` is bounded by the slower dependency rather than their sum;
  failure semantics and notification durability MUST remain unchanged.
- A temporarily older Convex deployment MUST receive a compatibility retry
  without evolvable latency/transport/profile fields.

## Controlled Evaluation Protocol

Every comparison MUST hold voice variant, device, network class, and scripted
utterance order constant. Change only one dimension at a time:

| Comparison | Control | Candidate |
|---|---|---|
| Endpointing | `baseline` | `instant-v1` |
| Model | `control` | `candidate` |
| Reasoning | `low` | `minimal` |
| Prompt/tools | exact `b4a11f1` source boundary | compact prompt + lookup + batched reversible capture |

The same corpus is required for each comparison: a normal uninterrupted brief;
a thought with a 700–1,200 ms pause; a slowly dictated email with a mid-address
pause; an explicit name/email correction; natural Malaysian English/Manglish;
a Bahasa Melayu turn followed by English; a barge-in while Reka speaks; and a
noisy or unclear utterance that should trigger clarification. Record the exact
commit and selected cells with every result.

Report tap-to-live, tap-to-audible, useful-start-within-two-seconds,
local endpoint-to-server-stop, stop-to-remote-audio,
first-output-to-remote-audio, tool duration, barge-in silence, rapid-resume
proxy, contact-correction rate, submission rate, and the conversation-quality
judge. A cell with faster latency but worse correction, overlap, false-endpoint,
or human listening results MUST NOT be promoted. Until this corpus and the
minimum sample gate are complete, the candidate cells remain evidence-gated;
an unperformed listening result is never a pass.

## Observability

- `/api/voice/session` emits `Server-Timing` for parse, rate-limit, OpenAI mint,
  and total route duration.
- `/admin/session-review` shows endpoint, response-created, first-output,
  remote-audio, playout, browser-tool, barge-in, and exact tap-to-live summaries
  plus runtime/model cells.
- `pnpm eval:voice -- --dry` writes a gitignored report containing the guarded
  promotion status and aggregate-only console output, including tap-to-live
  p50/p95 by runtime profile and full runtime/model/reasoning cell. Query-only
  aggregate output also reports PII-free overall/per-tool execution,
  response-to-call, and response-to-result p50/p95 so browser execution can be
  separated from model/transport delay.
- Raw transcripts and captured PII MUST NOT appear in structured route logs.
- `/api/health` exposes the active runtime/model/reasoning/capture cells and selected
  model without credentials or visitor data so release status can be rebuilt
  without chat history or container-shell access.
- `pnpm --silent ops:status --json` reports only aggregate voice evidence. Missing
  local reports MUST resolve to `insufficient_data`, never a pass.
- Reserved `@example.test` intake probes and named synthetic transport prompts
  MUST be excluded from customer-quality aggregates and reported as an excluded
  count.

## Rollout and Rollback

1. Deploy Convex schema/functions before the web commit.
2. Deploy the exact tested web commit only to
   `https://staging.oriental.mereka.io` and verify `/api/health` version.
3. Run the dry evaluation and manual AC-12 checks without submitting a staging
   lead while staging shares the production data plane.
4. Keep `VOICE_RUNTIME_PROFILE=baseline`, `VOICE_MODEL_CELL=control`,
   `VOICE_REASONING_CELL=low`, and `VOICE_EMAIL_CAPTURE_MODE=adaptive`; the
   runtime/model/reasoning candidates remain gated while adaptive capture is a
   separately approved product policy.
5. Roll back email friction independently with `VOICE_EMAIL_CAPTURE_MODE=strict`.
   Roll back endpointing with `VOICE_RUNTIME_PROFILE=baseline`; roll back model
   or reasoning independently with their control env values. Roll back the
prompt/tool slice independently by redeploying exact pre-slice commit
   `b4a11f160f0be50fb1c878b019fdfe4d7fe64e03`; roll back the full web release by
   redeploying the previous exact image/commit.

## Release Evidence

- APR round 1: `.apr/rounds/oriental-voice-instant/round_1.md`.
- Final ship adjudication and focused correction review:
  `.apr/rounds/oriental-voice-final-verdict/round_1.md` and
  `.apr/rounds/oriental-voice-final-verdict/round_2.md`.
- Command, CI, Convex, staging, live-call, and production non-change evidence:
  `.apr/evidence/round-1-verification.md`.
- PR 13 merged as `7fb9fdc58b49f97f5dcd70ccd7da89ca26e5d1c7`.
  PRs 11 and 12 are superseded; their independently attributable commits remain
  in the merge history.
- PR4 prompt/tool code is part of the reviewed merge and has its own exact
  rollback boundary at `b4a11f160f0be50fb1c878b019fdfe4d7fe64e03`.
  Its presence does not satisfy or bypass the PR3 runtime-profile sample gate;
  production runtime selection remains baseline/control/low with adaptive
  grounded email capture.

## Evidence-gated Decisions

- Hedged local backchannel: evaluated and not enabled. Before true remote-audio
  measurements exist at useful volume, a 250–350 ms local sound can collide
  with Reka, mask regressions, and create a new cancellation race.
- Full peer pre-negotiation: evaluated and not enabled. The client already
  preconnects and permission-aware pre-mints; no measured evidence currently
  identifies SDP negotiation as the remaining material bottleneck.
- Latency autopilot: the deterministic advisory gate is implemented. Automatic
  environment mutation remains a non-goal until trustworthy evidence exists.

## Open Questions

- Human Malaysian voice-quality sign-off remains unknown and MUST NOT be
  represented as passed.
- The latest 2026-07-16 evaluation stitched the newest 100 call rows into 72
  baseline conversations: 61 legacy, 7 local, and 4 staging, with no production
  candidate sample. Twelve tap-to-live samples measured p50 1,546 ms and p95
  2,393 ms; eleven tap-to-audible samples measured p50 2,456 ms and p95 6,659
  ms, with zero useful starts inside two seconds. It also found 6
  `realtime_busy` and 11 `webrtc_failed` conversations. That is useful failure
  evidence, not proof that voice feels instant or excellent.
- The measured gate blocks `instant-v1`, candidate model, and minimal reasoning
  promotion. It does not block the owner's explicitly authorized deployment of
  the reviewed web code while production stays baseline/control/low/adaptive.
