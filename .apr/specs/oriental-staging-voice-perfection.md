# Mereka at Oriental staging-only voice and visual release contract

Review the exact current integration tree based on
`401a04f12119bd41751af172f9255bdb25bacf38` for merge and an exact-SHA deploy to
canonical staging only. This contract does not authorize production, shared
Convex, DNS, backfill, retention, or production Infisical/Coolify mutation.
Production must remain on its current deployed SHA and current live visual
surface, with `baseline/control/gpt-realtime-2/low/adaptive` and picker off. The
reviewed candidate code must fail closed to the legacy orb and no Trace entrance
for a future production build, but this release does not deploy that fallback.

## Required behavior

1. The raw-WebGL Mereka M nebula and Trace M loader are staging/local previews.
   They require both `NEXT_PUBLIC_BRAND_MOTION_PREVIEW=true` at build time and
   the exact staging/local hostname. Either gate failing must render the legacy
   production orb and no Trace entrance. Reduced motion, missing WebGL, and
   initialization failure use the canonical static mark.
2. The nebula remains bounded to about 2,100 point sprites, releases every
   animation/listener/GPU resource, tilts from pointer input, and reacts visibly
   to both visitor microphone energy and remote assistant audio. Its adaptive
   gate must converge inactive during sustained room noise.
3. Canonical staging runs an explicitly labelled human-audition cell:
   `baseline/candidate/gpt-realtime-2.1/low/adaptive` with the voice-register
   picker visible. Audition rows are invalid as clean model-comparison evidence.
   Production is not deployed.
4. Dialog content, picker, compact email editor, and actions fit and remain
   reachable across the repository's responsive matrix, including 844x390 and
   1024x390. Browser microphone state is queried on each visit: granted access
   may prewarm; prompt/expired one-time access asks before quota is spent.
5. Reka identifies herself as from Mereka. Mereka is the organisation and team;
   Oriental Building is the physical building and Mereka's future location.
   The phrase “quick one” is forbidden and is deterministically counted.
6. Exact typed/prefilled and grounded high-confidence speech email is usable
   immediately. A complete medium-confidence spoken address stays visible and
   pending without a spelling loop. Corrections, contradictions, competing
   literals, third-party/historical/example addresses, stale model responses,
   out-of-order transcriptions, and duplicate calls must never route the wrong
   address. Clear-all must revoke one-shot prefill PII and quarantine pre-clear
   ASR completions.
7. Signed voice submission persists a server-created, HMAC-bound, PII-free
   evidence envelope on the immutable lead. The authority sequence is rebased
   when bounded transcript storage removes older user turns. Missing,
   duplicate, mismatched, ambiguous, or orphan attribution fails the evaluator
   closed without exposing identifiers or transcripts. An evaluator `--limit`
   window must not falsely classify a durable older session as an orphan.
8. Aggregate-only evaluation is read-only, judge-free, report-free, and
   aggregate-only on stdout. It keeps main's PII-safe error/tool telemetry,
   joins raw review/session pairs before reconnect folding, excludes synthetic
   probes, and rejects experiment confounds.
9. One-shot open requests are versioned and compare-and-swap revoked so a late
   close/clear from call A cannot erase call B or resurrect an old email. Main's
   responsive focus, analytics attribution, and typed-draft continuity remain.
10. Unit, lint, type, build, responsive browser, managed staging-cell,
    exact-SHA, real WebRTC/audio, and synthetic no-submit gates must pass.
    Oracle/APR must run only in the canonical hermetic plane via `ssh g` or
    `ssh mereka`. The exact merged SHA may move only to staging under optimistic
    concurrency. Production non-change proof is mandatory.

## Review boundary

This review decides whether the code may merge for a staging-only release. A
production mutation, shared-Convex deploy, backfill, preview-gate bypass,
candidate/picker leakage, false evidence attribution, PII restoration,
premature email routing, unbounded rendering, inaccessible dialog, or local/
Windows/browser-bridge Oracle execution is a blocker. Post-merge live staging
evidence and production non-change evidence are later release gates, not
pre-merge code evidence.
