# Oriental dropped-session observability exact-range evidence

## Immutable implementation identity

PR #82's source range begins after PR #79 source commit
`75f42e3205ac65f50e0a76bd7a58a2b651726ad2`, which is an ancestor of current
PR #79 head `2025f4a186b486457e5b79d699b6a98169603dd9`; PR #79 must merge first.
The exact source implementation under review is:

- implementation commit:
  `f6c102ade261512888ec88638900d86184e3b250`
- implementation tree:
  `062675817e236d5b5c365f946b16ff653d8ba13b`
- complete source-only range patch:
  `.apr/evidence/oriental-dropped-session-observability.patch`
- patch SHA-256:
  `7e41f2968a2b109669727ff202f584c3ba770d164b6adc5b8f29a3d947414e06`

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
supervisor kills the entire process group after ten minutes. Cancellation and
abnormal-exit handlers are armed before spawn; an already-received cancellation
is applied as soon as the stable process-group ID exists. The same idempotent
cleanup runs on `SIGINT`, `SIGTERM`, `SIGHUP`, and abnormal supervisor exit. A
direct child exit is not treated as group completion: surviving same-group
descendants are probed, killed, awaited within a bounded settle interval, and
force a nonzero result even when the leader reported zero.

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
or mutating the production control plane. Real-grandchild tests prove hard
timeout, established-group cancellation, every startup `SIGHUP`/`SIGINT`/
`SIGTERM`, and zero-exiting-leader paths terminate nonzero without delayed
mutation. Staging repeats the verifier after both browser smokes. Missing
functions, either incomplete migration population, timeout, query failure, or a
surviving process-group descendant therefore block both web deployment
entrypoints.

## Verification completed

Against implementation commit
`f6c102ade261512888ec88638900d86184e3b250`:

- `pnpm lint`: passed, 284 files;
- strict TypeScript: passed;
- all seven affected lifecycle, SLA, deadline, deploy, and release-governance
  suites: 7 files and 105 tests passed;
- the six-case deadline suite starts real grandchildren and proves hard timeout,
  established supervisor-group cancellation, pre-spawn arming for `SIGHUP`,
  `SIGINT`, and `SIGTERM`, and rejection of a zero-exiting leader whose
  same-group grandchild would otherwise mutate later;
- Next.js 16.2.10 production build: passed;
- source-only `git diff --check`: passed;
- exact-source-head GitHub `verify`: success on
  `f6c102ade261512888ec88638900d86184e3b250`;
- synthetic eight-PR integration commit
  `c7847c452eee6b1ee870470fd4ef3a338ea4d851`, tree
  `5c870160636d620e18b25958daa86d1770ab05fa`, containing every current PR
  source/evidence head, passed frozen pnpm 10.34.5 install, lint on 293 files,
  strict TypeScript, production audit with zero findings across 378 production
  dependencies, all 89 test files and 2,307 tests, and the Next.js 16.2.12
  production build.

APR rounds 2 and 3 correctly rejected the omitted unsafe-legacy completion
population, data-changing email/transcript/retention rewrite, missing hard
release-process deadline, and a detached child that could survive release
cancellation. Round 4 correctly rejected the spawn-to-handler cancellation race,
leader-only completion, and missing early-signal and zero-exiting-leader hostile
proof. The exact source commit above closes every source and pre-merge admission
blocker; round 5 must review this regenerated patch without waiving managed
runtime gates.

## Remaining admission gates

APR merge verdict, final exact-head GitHub CI, and post-merge managed runtime
proof remain mandatory. Runtime proof must deploy Convex first, drain the
lifecycle migration, observe the read-only verifier, then deploy and smoke the
identical web SHA on canonical staging before guarded production promotion.
