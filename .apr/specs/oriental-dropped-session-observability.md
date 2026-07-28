# Oriental dropped-session observability contract

## Objective

Make a voice call whose final close snapshot is lost visible to operators
without persisting unsafe payloads, creating false positives for live calls, or
letting the secondary orphan sweep break the primary lead SLA job.

## Required behavior

1. A failed close-snapshot request must produce a PII-scrubbed Sentry signal.
2. Heartbeat failures must not create redundant exception noise.
3. Connected sessions without `closedAt` must be eligible only after a bounded
   stale threshold derived from the maximum real call, goodbye grace, and
   heartbeat policy.
4. Eligibility must be materialized in a lifecycle field and selected through
   a compound index before the result cap; no lexical post-filter may decide
   orphan membership.
5. Closed or never-connected sessions must never enter the orphan index range,
   and there must be no lower lookback window that can age a real orphan out.
6. The lifecycle release migration must be bounded, drainable, and change only
   `sessionState` on already payload-safe rows. It must preserve every other
   field exactly and must never normalize email/transcript, alter payload safety,
   schedule retention, redact, or delete data. Unsafe-payload normalization and
   retention remain a separately governed operation.
7. The read-only sweep must use bounded completion checks for both rows with
   `payloadSafe === undefined` and payload-safe rows missing `sessionState`.
   Either population must block a clean availability result until separately
   resolved.
8. The hourly automation route must report and alert on orphan counts.
9. Rejection, timeout, unconfigured Convex, or either pending migration
   population must be represented as unknown (`null`) rather than a false zero,
   while the primary lead SLA result still succeeds.
10. The secondary query, migration RPCs, and total release child processes must
    have finite deadlines. A stuck child must be killed as a process group and
    terminate nonzero before external mutation.
11. Only the ops automation principal may invoke the mutation-capable SLA route.
12. Convex deploy, lifecycle migration, and a read-only availability verifier
    must execute before either staging or production web mutation.

## Acceptance evidence

- Exact implementation range and complete patch are recorded.
- Lint, strict TypeScript, focused route/data-integrity/reducer tests, and
  exact-head GitHub CI pass.
- Tests prove alerting, tri-state secondary failure isolation, bounded query and
  process latency, process-group termination before delayed mutation, lifecycle
  index membership, both legacy-population completion checks, no lower lookback,
  exact non-lifecycle field preservation, and deploy-entrypoint enforcement.
- Hermetic APR returns an explicit merge verdict.
- The final integrated tree receives managed staging and production proof.
