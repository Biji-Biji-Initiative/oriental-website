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
6. Legacy lifecycle migration must be bounded, non-destructive, drainable, and
   explicitly block a clean availability result until complete.
7. The hourly automation route must report and alert on orphan counts.
8. Rejection, timeout, unconfigured Convex, or pending migration must be
   represented as unknown (`null`) rather than a false zero, while the primary
   lead SLA result still succeeds.
9. The secondary sweep must have a finite deadline.
10. Only the ops automation principal may invoke the mutation-capable SLA route.
11. Convex deploy, lifecycle migration, and a read-only availability verifier
    must execute before either staging or production web mutation.

## Acceptance evidence

- Exact implementation range and complete patch are recorded.
- Lint, strict TypeScript, focused route/data-integrity/reducer tests, and
  exact-head GitHub CI pass.
- Tests prove alerting, tri-state secondary failure isolation, bounded latency,
  lifecycle index membership, no lower lookback, non-destructive migration,
  and deploy-entrypoint enforcement.
- Hermetic APR returns an explicit merge verdict.
- The final integrated tree receives managed staging and production proof.
