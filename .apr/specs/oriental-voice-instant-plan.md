# Oriental Instant Voice Architecture v1 — completion audit specification

Source conversation:
`https://chatgpt.com/share/6a57385c-6db8-83ec-943f-c5287bd749b5`

Audit date: 2026-07-15

## Audit objective

Determine whether the implementation attached to this APR workflow completes
the shared conversation end to end. Do not collapse the roadmap into a binary
answer. Report each planned PR and prerequisite as complete, partial, not
started, intentionally deferred, or blocked, and cite concrete implementation
evidence for every conclusion.

The conversation deliberately defines a sequential four-PR strategy. A later
PR is not implicitly complete because the telemetry foundation exists, and a
staging deployment is not equivalent to merged or production-complete work.

## Architectural constraints

- Preserve `connectionStatus` as transport state.
- Model conversational activity through an orthogonal `turnPhase`.
- Store latency in review/session metadata, not `VoiceRuntimeState`.
- Extend the bounded existing `voiceSessions.latency` object; do not create a
  separate turn-metrics table.
- Keep latency experiments separate from Malaysian voice/persona variants.
- Use monotonic browser durations and persist no raw wall-clock timing.
- Keep reversible state updates separate from irreversible routing/submission.
- Do not call transcript or output-event onset audible latency. True audible
  onset requires independent remote audio activity measurement.
- Ship model, VAD, prompt, tools, and perceived-latency changes as independently
  attributable releases.

## PR 1 — add turn latency telemetry

This PR must introduce no model, prompt, VAD, tool, opener, or other voice
behaviour change.

Required implementation:

- Add one small pure latency module, conventionally `lib/voice/latency.ts`.
- Derive an orthogonal turn phase from semantic Realtime events.
- Capture bounded per-turn latency samples for:
  - speech duration;
  - speech stop to `response.created`;
  - speech stop to first output event;
  - response duration;
  - interruption;
  - rapid resume/possible false endpoint.
- Bound retained samples to 80 turns.
- Integrate the reducer into `useRealtimeVoiceSession` without mocking WebRTC.
- Emit metadata only on meaningful completion/close transitions rather than
  every transcript delta.
- Carry latency through `VoiceReviewMetadata`, `VoiceAgentDialog`,
  `buildVoiceReviewSnapshot`, `/api/voice/debug`, and server persistence.
- Extend Zod validation with non-negative upper bounds.
- Extend existing Convex `voiceSessions` schema, validator, mutation, and patch.
- Preserve forward-compatible fallback by stripping evolvable transport and
  latency telemetry if Convex is temporarily behind the web deployment.
- Add latency data to the existing evaluation query.
- Add focused tests covering normal turns, interruption, rapid resume, response
  without output, close during a partial turn, bounded retention, snapshot
  propagation, API validation, Convex forwarding, and evaluation output.
- Run lint, typecheck, unit tests, build, and appropriate browser smoke tests.
- Preferred release order: Convex schema/functions, then web application.
- Deploy the exact tested commit to staging and prove the health endpoint.

Metric naming requirement:

- The initial metric is `speech stop -> first output event`, not audible audio.
- `stopToAudibleMs` remains a future refinement until remote audio activity is
  measured independently of reduced-motion visual animation.

## PR 2 — make activation feel immediate

Required implementation:

- Split the existing connection chime into an immediate local arm cue and an
  optional/subtle live cue.
- Trigger arm feedback on the initiating user action.
- Drive the orb and status copy from the orthogonal turn phase.
- Give immediate honest acknowledgement at speech stop without implying the
  model understood.
- Delay waiting/thinking copy by approximately 300 ms to prevent flicker.
- Shorten the opener to one sentence, recommended:
  `Hi, I'm Reka. What would you like to build at Oriental?`
- Keep audio/activity measurement active under reduced-motion preferences while
  disabling visual animation as required.

Target: tap to local response under 100 ms.

## PR 3 — adaptive endpointing experiment

Required implementation:

- Add a server-resolved `VoiceRuntimeProfile`, initially `baseline` or
  `instant-v1`, separate from `VoiceVariant`.
- Return and persist the runtime profile with model, voice, speed, and variant.
- Add tested `session.update` serialization for turn-detection changes.
- Use semantic VAD high eagerness by default for ordinary conversation.
- Use patient/low eagerness after Reka asks for an email, then return to fast.
- Infer the email patient case deterministically; do not add a general expected
  input engine before data supports it.
- Record input policy with latency samples.
- Compare baseline and `instant-v1` in the admin/evaluation surface.
- Roll back with `VOICE_RUNTIME_PROFILE=baseline`.

Experimental quality gates:

- Normal speech end to first audible Reka audio under 650 ms p50 and 1,000 ms
  p95 once true audible measurement exists.
- False endpoint rate below 2%.
- Barge-in silence below 250 ms p95.
- Contact-detail correction rate no worse than control.

## PR 4 — reduce prompt and tool critical path

This begins only after PR 3 produces interpretable evidence.

Required evaluation and possible implementation:

- Compact the permanent prompt into a small reflex prompt.
- Move detailed Oriental facts/FAQ knowledge behind a read-only lookup tool.
- Batch reversible grounded field captures into one atomic state update.
- Keep routing/submission and end-call actions separate and explicit.
- Add deterministic expected-input policy only where evidence supports it.
- Evaluate newer Realtime model and reasoning combinations as controlled cells,
  not an unmeasured global switch.
- Do not change prompt, tools, model, and VAD in one release.

## Additional experiments from the conversation

These are recommendations, not automatically part of PR 1:

- Instrument click-to-sound and eventual end-to-audible timing.
- Break latency into endpoint/VAD, model, tool, and playout waits.
- Add `/api/voice/session` `Server-Timing` for parsing, rate-limit lookup,
  OpenAI minting, and total duration.
- Consider a cancellable local hedged backchannel after 250–350 ms.
- Consider deterministic tentative extraction for obvious contact details.
- Consider full WebRTC peer pre-negotiation only if evidence shows negotiation
  remains a material bottleneck after simpler interventions.
- Resolve documented voice-duration policy drift in one typed runtime policy.
- Build an eventual latency autopilot only after trustworthy measurements and
  false-cutoff/correction quality gates exist.

## Historical seed evidence from the source conversation

- Initial telemetry-only candidate commit:
  `7f7d045e6d7c2d7235449c0540205de2bd13ff48`.
- Initial telemetry-only PR, now superseded by the integration vehicle:
  `https://github.com/Biji-Biji-Initiative/oriental-website/pull/11`.
- Claimed checks: lint, typecheck, 170 unit tests, production build, focused
  Playwright/browser proof, and dry evaluation.
- Claimed Convex schema/functions deployment: complete on the currently shared
  Oriental Convex data plane.
- Claimed staging web deployment: exact candidate commit, healthy at
  `https://staging.oriental.mereka.io/api/health`.
- Claimed production web version remains `606f46e` and was not promoted.
- PR 11 may be closed once a reviewed integration PR contains the same commit.

## Current integration evidence

- Product implementation baseline:
  `d085cac0f649e8f718c5b9b4f43447869be59664`.
- Review-tool configuration baseline:
  `2b58932bbe3df42c156ba2d2f022c578c1a99ba4`.
- Canonical merge vehicle:
  `https://github.com/Biji-Biji-Initiative/oriental-website/pull/13`.
- PRs 11 and 12 are superseded by PR 13; their commits remain independently
  attributable in the integration branch history.
- Staging web health proved product version `d085cac` at
  `https://staging.oriental.mereka.io/api/health`; production remained
  `606f46e`.
- The tracked verification evidence is
  `.apr/evidence/round-1-verification.md`.

## Required APR output

1. A direct answer to: "Is everything in the shared conversation completely
   done end to end?"
2. A completion matrix for PRs 1–4 and every additional experiment.
3. A PR 1 acceptance-criterion audit with file/test evidence.
4. A list of any mismatch between claims and attached implementation.
5. A distinction among implemented, deployed to staging, merged, and deployed
   to production.
6. The smallest defensible next step, respecting the sequential plan.
7. No speculative redesign unless it is needed to explain a concrete gap.
