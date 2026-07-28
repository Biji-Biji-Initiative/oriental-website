# Oriental dropped-session observability contract

## Objective

Make a voice call whose final close snapshot is lost visible to operators
without persisting unsafe payloads, creating false positives for live calls, or
letting the secondary orphan sweep break the primary lead SLA job.

## Required behavior

1. A failed close-snapshot request must produce a PII-scrubbed Sentry signal.
2. Heartbeat failures must not create redundant exception noise.
3. Connected sessions without `closedAt` must be eligible only after a bounded
   stale threshold longer than the maximum real call.
4. The query must use the payload-safe indexed window and remain bounded.
5. Closed or never-connected sessions must be filtered before the result cap so
   high healthy-session volume cannot hide true orphans.
6. The hourly automation route must report and alert on orphan counts.
7. An orphan-query failure must fail open for the secondary sweep while the
   primary lead SLA result still succeeds.
8. Only the ops automation principal may invoke the mutation-capable SLA route.
9. Convex functions must deploy before web code that calls the new query.

## Acceptance evidence

- Exact implementation range and complete patch are recorded.
- Lint, strict TypeScript, focused route/data-integrity/reducer tests, and
  exact-head GitHub CI pass.
- Tests prove alerting, secondary-sweep failure isolation, proxy/auth behavior,
  and filter-before-cap ordering.
- Hermetic APR returns an explicit merge verdict.
- The final integrated tree receives managed staging and production proof.
