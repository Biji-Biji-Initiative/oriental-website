# Oriental dropped-session observability exact-range evidence

## Immutable implementation identity

PR #82 is stacked on PR #79 commit
`75f42e3205ac65f50e0a76bd7a58a2b651726ad2`; PR #79 must merge first.
The exact source implementation under review is:

- implementation commit:
  `7efaad2e01683c1a44e5ee6c65c417a06178a3c0`
- implementation tree:
  `e87b21d0bbfb91afaf2965496e031a349eab0391`
- complete source-only range patch:
  `.apr/evidence/oriental-dropped-session-observability.patch`
- patch SHA-256:
  `a27807bed7766bd15a7bd95aea0503e3314dfb2067a6fcff4068a853975be855`

The patch contains all twenty source, schema, release automation,
documentation, and test files in the exact range after the stacked base. Any child of the
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

Legacy rows are never represented as a clean zero. The query performs bounded
`take(1)` checks for both populations outside the orphan candidate index:

- any row with `payloadSafe === undefined`;
- any payload-safe row with `sessionState === undefined`.

Either makes `migrationPending` true, including a database containing only one
unsafe legacy row. The dedicated release lifecycle mutation deliberately drains
only the second population. Its one exact database patch contains only
`sessionState`; customer fields, normalized email, transcript, payload marker,
retention expiry, and every other non-lifecycle field remain byte/value
unchanged. Unsafe payload normalization and retention scheduling remain the
separately governed `applyDataRetention` operation and are never invoked
implicitly by release. If unsafe legacy rows remain, the verifier blocks web
deployment rather than rewriting or expiring them.

The lifecycle script drains to `hasMore=false`, detects non-progress, and has a
finite row/round cap. Each RPC has a thirty-second deadline and a parent process
supervisor kills the entire process group after ten minutes.

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

The release runbook requires exact-SHA Convex deployment, metadata-only
lifecycle backfill, and the read-only orphan verifier before staging. The
verifier has a five-second query deadline and a process-level fifteen-second
supervisor; the production deployer adds an outer twenty-second `SIGKILL`
deadline. `scripts/deploy-coolify-host.sh` independently verifies its local exact
SHA and runs the bounded verifier before constructing or invoking SSH.
`scripts/deploy-coolify-production.ts` runs it before reading Coolify credentials
or mutating the production control plane. A deliberately non-resolving child
test proves exit 124 within the bound, kills its process group, and prevents a
delayed external mutation. Staging repeats the verifier after both browser
smokes. Missing functions, either incomplete migration population, timeout, or
query failure therefore block both web deployment entrypoints.

## Verification completed

Against implementation commit
`7efaad2e01683c1a44e5ee6c65c417a06178a3c0`:

- `pnpm lint`: passed, 284 files;
- `pnpm typecheck`: passed;
- focused lifecycle, SLA, deadline, and release-governance suites: 4 files and
  49 tests passed;
- hermetic full Vitest through `scripts/run-release-tests.ts`: 84 files and
  2,205 tests passed;
- Next.js 16.2.10 production build: passed;
- `git diff --check`: passed.

APR round 2 correctly rejected the omitted unsafe-legacy completion population,
the data-changing email/transcript/retention rewrite, and the absence of a hard
release-process deadline. The exact source commit above closes all three; round
3 must review the regenerated patch.

## Remaining admission gates

APR merge verdict, final exact-head GitHub CI, combined-tree integration, and
post-merge managed runtime proof remain mandatory. Runtime proof must deploy
Convex first, drain the lifecycle migration, observe the read-only verifier,
then deploy and smoke the identical web SHA on canonical staging before
guarded production promotion.
