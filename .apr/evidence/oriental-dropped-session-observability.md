# Oriental dropped-session observability exact-range evidence

## Immutable implementation identity

PR #82 is stacked on email-grounding commit
`75f42e345106810467b2e048e0d3dc7654066b7e`, which is owned by PR #79. PR #79
must merge first. This review covers only the three descendant commits ending
at:

- implementation head:
  `ed57627546bdfc7340e5650841f74dfee268a413`
- implementation tree:
  `8302a2eaaeb878068467f6c8a5c96b83b5e04773`
- complete range patch:
  `.apr/evidence/oriental-dropped-session-observability.patch`
- patch SHA-256:
  `e0b6ee81db689aef0471a77cf4f7cf0000d030733d73079583b77ffa91436f91`

The range changes exactly:

1. `app/api/admin/sla-check/route.ts`
2. `components/voice-agent/VoiceAgentDialog.tsx`
3. `convex/leads.ts`
4. `lib/server/convex.ts`
5. `tests/admin-data-integrity.test.ts`
6. `tests/admin-sla-route.test.ts`

Any evidence-only child commits must touch only `.apr/`. APR must compare the
remote PR head with its clean worktree, and GitHub CI must pass on the final
exact PR head.

## Client failure signal

`postVoiceReviewSnapshot` already throws for non-2xx fetch responses. The dialog
now captures a scrubbed Sentry exception only when a close snapshot rejects.
Ordinary heartbeat rejection remains quiet because the next heartbeat can
self-heal. A successful `sendBeacon` is still only a queueing signal, so the
server-side orphan sweep is the durable backstop.

The existing Sentry `beforeSend` contract strips event payloads to bounded
exception type and stacktrace; no transcript, email, name, organization, or
session payload is added to the new capture call.

## Bounded Convex orphan query

The new authenticated query:

- requires `CONVEX_INGEST_SECRET`;
- clamps staleness to 15 minutes through 24 hours;
- limits lookback to 24 hours;
- uses `by_payload_safe_updated_at` with `payloadSafe = true`;
- filters for `connectedAt` present and `closedAt` absent inside the query;
- applies the `SLA_QUERY_BUCKET_LIMIT + 1` cap only after that filter;
- returns bounded PII-free session metadata and an overflow bit;
- never uses `.collect()`.

Filtering before `take` closes a saturation bug found during review: a busy
window containing more than the cap of healthy closed sessions can no longer
hide an older true orphan.

## Hourly SLA integration

The ops-only SLA route accepts a bounded `maxVoiceStaleMinutes`, defaulting to
30 minutes. It runs the primary lead SLA snapshot first. The orphan query is a
secondary sweep:

- orphan count participates in alert eligibility, summary, fingerprint, logs,
  and JSON response;
- truncation is explicitly reported;
- orphan-only alerts are warnings;
- a rejected or unavailable orphan query logs
  `admin_sla.orphan_sweep_failed`, reports the secondary plane unavailable, and
  does not fail the successful lead SLA result.

The route remains protected by `verifyAdminPermission(..., "ops.sla_check")`;
interactive review credentials cannot invoke it.

## Verification completed

Against implementation head
`ed57627546bdfc7340e5650841f74dfee268a413`:

- `pnpm install --frozen-lockfile`: pass
- `pnpm lint`: pass, 280 files
- `pnpm typecheck`: pass
- focused Vitest: 3 files and 1,541 tests passed
- `git diff --check`: pass

Focused proof covers orphan-only alerting, the 30-minute default, bounded
response metadata, secondary-sweep failure isolation, ops-only authorization,
filter-before-cap ordering, avoidance of unbounded collection, and the stacked
email-grounding reducer regression.

## Release boundary

This source change adds a Convex function. After PR #79 and this PR merge, the
exact default-branch Convex functions must deploy first. The same exact web SHA
must then pass managed preflight, canonical staging health/smoke verification,
and guarded production promotion with rollback retained.
