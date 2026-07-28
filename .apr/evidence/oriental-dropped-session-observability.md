# Oriental dropped-session observability exact-range evidence

## Immutable implementation identity

PR #82 is stacked on PR #79 commit
`75f42e3205ac65f50e0a76bd7a58a2b651726ad2`; PR #79 must merge first.
The exact source implementation under review is:

- implementation commit:
  `caa2ff15b6c5ca44f8e376f3784fee4db0356639`
- implementation tree:
  `d2d5c725e2636488807b745810d732351ba2d500`
- complete source-only range patch:
  `.apr/evidence/oriental-dropped-session-observability.patch`
- patch SHA-256:
  `dd6fddac44f0c075251b407b100692dad71dc34ada265b202b639a04999616e0`

The patch contains all source, schema, release automation, documentation, and
test changes in the exact range after the stacked base. Any child of the
implementation commit may touch only `.apr/`. APR must compare the remote PR
head with this commit plus APR-only descendants, and GitHub CI must pass on the
final exact PR head.

## Client failure signal

`postVoiceReviewSnapshot` already throws for non-2xx fetch responses. The
dialog captures a scrubbed Sentry exception only when a close snapshot
rejects. Ordinary heartbeat rejection remains quiet because the next heartbeat
can self-heal. A successful `sendBeacon` remains only a queueing signal; the
server-side orphan sweep is the durable backstop.

The existing Sentry `beforeSend` contract strips event payloads to bounded
exception type and stacktrace. No transcript, email, name, organization, or
session payload is added to the capture call.

## Indexed lifecycle and false-negative closure

Every newly recorded voice session materializes one lifecycle state:
`preconnected`, `connected_open`, or `closed`. `connectedAt` and `closedAt`
remain monotonic across snapshots, so a stale or partial heartbeat cannot
reopen a closed session.

The orphan query uses
`by_safe_session_state_updated_at(payloadSafe, sessionState, updatedAt)` with:

- `payloadSafe = true`;
- `sessionState = connected_open`;
- `updatedAt < staleCutoff`;
- oldest-first ordering;
- `SLA_QUERY_BUCKET_LIMIT + 1`;
- no post-index `.filter()`, no `.collect()`, and no lower lookback bound.

The minimum stale threshold is derived from the maximum valid call duration,
maximum goodbye grace, and two heartbeat intervals: 1,854,000 ms, rounded up
to 31 minutes. The default is 35 minutes. Live or never-connected sessions
cannot enter the indexed candidate set, while old real orphans remain visible
until closure or retention.

Legacy rows are never represented as a clean zero. The query returns
`migrationPending` while any payload-safe row lacks lifecycle state. A
dedicated bounded release mutation handles both older unsafe rows and
payload-safe rows missing lifecycle state. It only normalizes and patches
rows; it contains no delete or transcript-redaction path. The release script
drains it to `hasMore=false`, detects non-progress, and has a finite round cap.

## SLA isolation and honest availability

The ops-only SLA route applies a five-second deadline to the secondary query.
Success returns a bounded count and lower-bound bit. Query rejection,
unconfigured Convex, timeout, and pending migration all return:

- `orphanedVoiceSessions: null`;
- `truncated.orphanedVoiceSessions: null`;
- `orphanSweepAvailable: false`;
- a bounded reason code.

This preserves the primary lead SLA result without converting unknown
secondary telemetry into a false zero. The route remains protected by
`verifyAdminPermission(..., "ops.sla_check")`; interactive review credentials
cannot invoke its Slack-capable operation.

## Enforced Convex-before-web ordering

The release runbook requires exact-SHA Convex deployment, non-destructive
lifecycle backfill, and the read-only orphan verifier before staging.
`scripts/deploy-coolify-host.sh` independently verifies its local exact SHA and
runs the orphan verifier before any SSH or environment mutation.
`scripts/deploy-coolify-production.ts` runs the same verifier before reading
Coolify credentials or mutating the production control plane. Staging repeats
the verifier after both browser smokes. Missing functions, incomplete
migration, or query failure therefore block both web deployment entrypoints.

## Verification completed

Against implementation commit
`caa2ff15b6c5ca44f8e376f3784fee4db0356639`:

- `pnpm lint`: passed, 282 files;
- `pnpm typecheck`: passed;
- focused lifecycle, SLA, Convex adapter, release-governance, host rollback,
  and retention suites: 7 files and 101 tests passed;
- hermetic full Vitest through `scripts/run-release-tests.ts`: 83 files and
  2,204 tests passed;
- Next.js 16.2.10 production build: passed;
- `git diff --check`: passed.

APR round 1 correctly rejected the earlier lexical filter, narrow lookback,
unsafe threshold floor, false-zero fallback, unbounded secondary latency, and
prose-only deployment ordering. The exact source commit above implements every
required remediation. Round 2 must review this regenerated exact patch.

## Remaining admission gates

APR merge verdict, final exact-head GitHub CI, combined-tree integration, and
post-merge managed runtime proof remain mandatory. Runtime proof must deploy
Convex first, drain the lifecycle migration, observe the read-only verifier,
then deploy and smoke the identical web SHA on canonical staging before
guarded production promotion.
