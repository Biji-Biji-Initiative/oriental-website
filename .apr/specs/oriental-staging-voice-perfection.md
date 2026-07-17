# Mereka at Oriental voice and visual release contract

Review the current integration tree based on
`b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e` for merge and exact-SHA release.
This contract permits the same reviewed web image to move through canonical
staging and production. It does not permit a production candidate voice cell,
QA picker, or unreviewed configuration mutation.

## Required behavior

1. The raw-WebGL Mereka M nebula and Trace M loader are the approved visual on
   both `staging.oriental.mereka.io` and `oriental.mereka.io`. They MUST NOT
   depend on a preview environment variable or hostname gate. Reduced-motion,
   missing WebGL, and initialization failure must fall back to the approved SVG
   mark.
2. The nebula must remain bounded to about 2,100 point sprites, release every
   animation/listener/GPU resource, tilt from pointer input, and react visibly
   to both visitor microphone energy and remote assistant audio. Its adaptive
   floor and gate hysteresis must converge inactive during sustained room noise
   from 0.12 through 0.20 rather than treating steady noise as speech.
3. A clean staging candidate is
   `baseline/candidate/gpt-realtime-2.1/low/adaptive` with the picker off. A
   separately declared staging audition may enable the picker, but those rows
   are voice/variant evidence and MUST NOT count as clean model-comparison or
   promotion evidence.
4. Production must remain
   `baseline/control/gpt-realtime-2/low/adaptive` with the picker off. Every
   production deploy, preflight, and verification path must reject a candidate
   model or audition picker mode even when a stale environment value requests
   one.
5. Dialog content and the global picker must fit and remain reachable at the
   repository's complete responsive matrix, including 844x390 and 1024x390.
   Returning microphone permission may prewarm but must not mint a session
   before the browser permission state permits it.
6. Reka must identify herself as from Mereka. Mereka is the organisation and
   team; Oriental Building is the physical building and Mereka's future
   location. Copy must use "Mereka at Oriental" and must not call the team
   "Oriental". The phrase "quick one" is forbidden.
7. Typed/prefilled and exact high-confidence speech emails are immediately
   usable. A complete approximate/medium-confidence spoken address remains
   visible but pending for one exact readback. A different literal address is
   never treated as ASR approximation. A stale, corrected, contradicted, or
   contaminated readback must never route.
8. Typed interruption, stale model responses, out-of-order transcriptions,
   duplicate calls, and pending transcription races must preserve the latest
   authoritative address. Clear-all must erase captured data, route state,
   transcript, remembered handoff, and quarantine pre-clear ASR completions by
   Realtime item identity. A typed-only edited handoff must survive closing and
   reopening the same intake even when the voice transcript is empty.
9. `clear_fields` is the canonical clear-all tool name across browser events,
   bounded schemas, Convex validation, persistence, and aggregate reporting. It
   must remain distinct from the single-field `clear_field` operation and must
   never be rewritten through a lossy compatibility alias.
10. Evaluation must remain read-only in aggregate-only mode, enrich missing
    historical voice profile fields only through existing queries, count email
    rejections, stale submissions, and banned style tics, and report PII-free
    per-tool latency overall and by canonical tool name. Aggregate comparisons
    must be stratified by runtime, model, reasoning, variant, voice, and speed;
    model/voice confounds must be rejected.
11. Unit, lint, type, build, responsive browser, managed cell, exact-SHA
    release, live WebRTC/audio, and no-submit intake gates must pass. When a
    reviewed diff changes Convex validators or functions, the canonical Convex
    deployment must precede the web image. The exact reviewed SHA may then move
    to canonical staging and production under optimistic concurrency, with
    production voice still fixed to the control cell.

## Review boundary

This review decides whether the code may merge for an exact-SHA staging and
production release. The final merged SHA and post-merge live evidence cannot
exist during a pre-merge review, so their absence is not a code blocker. A
production candidate or picker, hidden experiment confound, false
`clear_fields` alias, PII restoration, premature email routing, unbounded
rendering work, inaccessible responsive controls, or false evidence
attribution is a blocker.
