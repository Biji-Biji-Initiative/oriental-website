# Mereka at Oriental staging voice perfection — release contract

Review implementation commit `1b2fd629bdfc625da3227686f80aebba945405cf` for merge and
staging-only deployment. This contract does not authorize a production web
deployment.

## Required behavior

1. The raw-WebGL Mereka M nebula and Trace M loader are staging previews only.
   Production must keep its current orb and loader. Reduced-motion, missing
   WebGL, and initialization failure must fall back to the approved SVG mark.
2. The nebula must remain bounded to about 2,100 point sprites, release every
   animation/listener/GPU resource, tilt from pointer input, and react visibly
   to both visitor microphone energy and remote assistant audio without staying
   active on steady room noise.
3. The staging voice picker must be enabled only when the server detects the
   canonical staging host and `VOICE_VARIANT_PICKER=true`. A production host
   must override a stale staging environment hint and ignore submitted
   variants. Picker-enabled runs are audition evidence, not clean model A/B
   evidence.
4. Staging must remain `baseline/candidate/gpt-realtime-2.1/low/adaptive`.
   Production must remain on its deployed control model and picker-off state.
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
   Realtime item identity; duplicate, reused, unknown, and untagged post-clear
   settlements must fail closed.
9. Evaluation must count email rejections, stale submissions, and banned style
   tics; aggregate comparisons must be stratified by runtime, model, reasoning,
   variant, voice, and speed. Model/voice confounds must be rejected. Exact
   attribution must be recovered read-only through the existing per-session
   query when the deployed bulk query omits it; the staging preview must not
   require a shared Convex deployment. Canonical clear-all telemetry may use a
   documented legacy durable alias only after the PII-free application log has
   retained the exact tool name and only if every measured field is preserved.
10. Unit, lint, type, build, browser, managed cell, exact-SHA release, live
    WebRTC/audio, and no-submit intake gates must pass. The exact merged SHA may
    then move to canonical staging under optimistic concurrency. Production
    must be inspected afterward and remain unchanged.

## Review boundary

This review decides whether the code may merge for exact-SHA staging proof.
The merged SHA does not exist yet, so absence of post-merge staging evidence is
not a pre-merge blocker. Any production mutation, production-candidate
promotion, hidden picker bypass, PII restoration, premature email routing,
unbounded rendering work, or false evidence attribution is a blocker.
