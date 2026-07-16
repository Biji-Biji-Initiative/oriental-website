# Oriental voice evidence and experiment-governance ship contract

## Goal

Make the next baseline/candidate campaign capable of answering whether a user
obtained useful audible voice within two seconds, while keeping legacy review
rows readable and preventing multi-dimensional experiments.

## Required evidence

1. Activation telemetry distinguishes tap-to-arm-cue, tap-to-live, and
   tap-to-independently-detected-remote-audio. Only the last is audible onset.
2. Aggregates expose tap-to-audible samples, p50/p95, count within two seconds,
   and an explicit denominator. Missing samples are not silently treated as
   successes. Conversation stitching retains every activation attempt rather
   than selecting only the first call segment. An explicit, optional
   `activationAttempted` marker distinguishes a post-mint attempt whose latency
   payload was lost from an unused prewarm or legacy unknown row.
3. Availability attribution distinguishes any `realtime_busy`, any
   `webrtc_failed`, sessions that used the bounded capacity retry, and remote
   track received without independently detected audio. A later clean close
   must not erase an earlier mid-utterance drop or failure reason.
4. New snapshots attribute `production|staging|local` and `mobile|desktop`.
   Legacy rows remain valid and aggregate as `unknown`.
5. Snapshot and Convex schema additions are optional/backward compatible.
6. Experiment validation permits at most one non-control dimension among
   runtime, model, and reasoning. The QA voice picker must be off during such a
   trial and defaults off in the public client config. Evidence groups include
   runtime, model, and reasoning so runtime cohorts cannot contaminate a model
   comparison. The runtime promotion gate compares only control-model,
   low-reasoning rows in both baseline and instant cohorts.
7. Shared Redis uses the historical production key prefix unchanged and adds a
   sanitized environment namespace outside production.
8. Reports and docs explicitly state that the latest 100 call rows stitch to
   80 baseline-only conversations with 24 legacy arm-cue telemetry samples,
   zero explicitly marked attempts, zero tap-to-live or audible-onset samples,
   and an `insufficient_data` promotion gate.
9. Any configured score threshold fails closed when there are zero scored
   conversations; missing judge evidence is never interpreted as a pass.

## Product boundary

This work creates trustworthy evidence collection. It does not prove instant
voice, multilingual quality, Malaysian authenticity, or candidate promotion.
Human listening and qualifying conversations remain mandatory gates.

## Verification

Unit tests cover latency reduction, evaluator aggregation, schema compatibility,
experiment rejection, client-config defaults, route attribution, and Redis key
namespacing. Typecheck, lint, production build, secret-contract checks, and
Playwright must pass.
