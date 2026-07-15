---
title: "Oriental Instant Voice Architecture v1"
type: "voice_ai_spec"
status: "staged"
owner: "Mereka Engineering"
vehicle: "web_webrtc"
last_updated: "2026-07-15"
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
  latency object.

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
- `connectionStatus` MUST remain transport state; conversational activity MUST
  use orthogonal `turnPhase` state.
- Waiting copy MUST be delayed approximately 300 ms and MUST not claim semantic
  understanding before a model response.
- Reduced-motion mode MUST suppress visual animation without disabling audio
  activity measurement.
- Per-turn telemetry MUST retain at most 80 samples and MUST include available
  speech, endpoint, response-created, first-output, remote-audio, playout,
  browser-tool, response, interruption, and rapid-resume durations/signals.

### Endpointing and controlled cells

- `VOICE_RUNTIME_PROFILE=baseline` MUST restore semantic VAD `auto`.
- `instant-v1` MUST use `high` eagerness normally and deterministic `low`
  eagerness only after Reka asks for an email, returning to fast on the next
  response.
- Runtime profile/input policy, model/reasoning cells, and voice variant MUST be
  persisted and comparable independently.
- Control MUST remain `gpt-realtime-2`/`low` unless an explicit cell is selected.

### Prompt, tools, and capture

- The permanent prompt MUST remain below 7 KB and detailed facts MUST remain
  behind bounded read-only `lookup_oriental`.
- Reversible fields MUST be captured with one atomic `capture_fields` batch;
  one invalid, duplicate, or ungrounded item MUST reject the whole batch.
- Routing and end-call actions MUST remain explicit and separate.
- Tentative email extraction MAY fill an empty draft only for a literal address
  alone or with explicit visitor ownership; it MUST NOT infer spoken punctuation
  and MUST NOT overwrite an existing/corrected value.

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
- [x] AC-04 — Compact prompt, read-only lookup, and atomic capture:
  `tests/voice-profile.test.ts`, `tests/voice-knowledge.test.ts`, and
  `tests/realtime-events.test.ts`.
- [x] AC-05 — Controlled model/reasoning cells:
  `tests/voice-experiments.test.ts` and `tests/openai-realtime.test.ts`.
- [x] AC-06 — Typed duration policy and server timing:
  `tests/voice-session-policy.test.ts` and `tests/voice-session-route.test.ts`.
- [x] AC-07 — Independent remote-audio and browser-tool measurement:
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
- [ ] AC-11 — Staging release proof and human observation.
  - [x] A real staged WebRTC call produced live remote audio.
  - [x] A typed interruption exercised cancellation/barge-in and recovered to a
    new spoken response.
  - [x] Voice mint and review persistence returned HTTP 200 without browser
    errors.
  - [x] `/api/health` proved product version `d085cac` at
    `https://staging.oriental.mereka.io` while production remained `606f46e`.
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
| Prompt/tools | exact `b4a11f1` source boundary | compact prompt + lookup + atomic capture |

The same corpus is required for each comparison: a normal uninterrupted brief;
a thought with a 700–1,200 ms pause; a slowly dictated email with a mid-address
pause; an explicit name/email correction; natural Malaysian English/Manglish;
a Bahasa Melayu turn followed by English; a barge-in while Reka speaks; and a
noisy or unclear utterance that should trigger clarification. Record the exact
commit and selected cells with every result.

Report tap-to-live, local endpoint-to-server-stop, stop-to-remote-audio,
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
  p50/p95 by runtime profile and model/reasoning cell.
- Raw transcripts and captured PII MUST NOT appear in structured route logs.

## Rollout and Rollback

1. Deploy Convex schema/functions before the web commit.
2. Deploy the exact tested web commit only to
   `https://staging.oriental.mereka.io` and verify `/api/health` version.
3. Run the dry evaluation and manual AC-10 checks without submitting a staging
   lead while staging shares the production data plane.
4. Keep `VOICE_RUNTIME_PROFILE=baseline`, `VOICE_MODEL_CELL=control`, and
   `VOICE_REASONING_CELL=low` until the promotion gate and human review pass.
5. Roll back endpointing with `VOICE_RUNTIME_PROFILE=baseline`; roll back model
   or reasoning independently with their control env values. Roll back the
   prompt/tool slice independently by redeploying exact pre-slice commit
   `b4a11f160f0be50fb1c878b019fdfe4d7fe64e03`; roll back the full web release by
   redeploying the previous exact image/commit.

## Release Evidence

- APR round 1: `.apr/rounds/oriental-voice-instant/round_1.md`.
- Command, CI, Convex, staging, live-call, and production non-change evidence:
  `.apr/evidence/round-1-verification.md`.
- PR 13 merged as `7fb9fdc58b49f97f5dcd70ccd7da89ca26e5d1c7`.
  PRs 11 and 12 are superseded; their independently attributable commits remain
  in the merge history.
- PR4 prompt/tool code is part of the reviewed merge and has its own exact
  rollback boundary at `b4a11f160f0be50fb1c878b019fdfe4d7fe64e03`.
  Its presence does not satisfy or bypass the PR3 runtime-profile sample gate;
  production runtime selection remains baseline/control/low.

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
- The measured gate blocks `instant-v1`, candidate model, and minimal reasoning
  promotion. It does not block the owner's explicitly authorized deployment of
  the reviewed web code while production stays baseline/control/low.
