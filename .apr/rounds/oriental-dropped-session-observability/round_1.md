## Review result

Treating the supplied patch as the complete range from `75f42e345106810467b2e048e0d3dc7654066b7e` through `ed57627546bdfc7340e5650841f74dfee268a413`, the implementation does **not** satisfy the saturation, bounded-scan, failure-isolation, or mandatory-release-order claims.

## Release blockers

### 1. The orphan query remains scan-unbounded and can lose the orphan plane under healthy-session saturation

`convex/leads.ts` patch lines 168–175 constrain the index only by:

* `payloadSafe = true`
* a 24-hour `updatedAt` range

The connected/open conditions remain a post-index `.filter(...)`:

```ts
.filter((q) =>
  q.and(
    q.neq(q.field("connectedAt"), undefined),
    q.eq(q.field("closedAt"), undefined),
  ),
)
.take(SLA_QUERY_BUCKET_LIMIT + 1);
```

Placing `.filter()` before `.take()` bounds the number of **matching results**, but not the number of documents scanned to find those results. Convex explicitly documents that `.filter()` does not reduce scanned rows and that filtered-out documents count toward transaction scan and data-read limits. The current documented limit is 32,000 scanned documents, with a separate 16 MiB data-read limit. ([Convex][1])

A concrete failure case is:

1. More than 32,000 payload-safe, stale-window sessions are healthy and closed.
2. They are newer in the `updatedAt` index than an older true orphan.
3. The query scans and discards those healthy rows while looking for matching open sessions.
4. It reaches Convex’s scan or data limit before reaching the orphan.
5. The query rejects.
6. The route converts that rejection into an unavailable secondary sweep and, when the lead plane is healthy, returns zero orphans and no alert.

That directly refutes the evidence claim that healthy-session saturation cannot hide an orphan.

The test at `tests/admin-data-integrity.test.ts` patch lines 229–243 merely verifies textual ordering of `.filter` and `.take`. It encodes the incorrect assumption that this ordering bounds database scanning; it does not exercise the saturation failure mode.

**Required correction:** materialize the lifecycle predicate in an indexable field or table—for example, an atomically maintained `connectedOpen`/`sessionState` field and an index beginning with `payloadSafe`, that state, and `updatedAt`. The orphan query must select only connected-open rows in the index range before `take(limit + 1)`, with no post-index lifecycle filter. Existing eligible rows also need a migration or otherwise proven compatibility path.

### 2. The accepted stale-window boundary can produce an empty query and can miss sessions between hourly scans

The route accepts up to 1,440 minutes at `app/api/admin/sla-check/route.ts` patch lines 15–20. The Convex function then sets both:

```ts
boundedStaleMs <= 24 hours
lookbackCutoff = generatedAt - 24 hours
```

at `convex/leads.ts` patch lines 163–166.

For the valid request `maxVoiceStaleMinutes: 1440`:

```text
staleCutoff    = generatedAt - 24h
lookbackCutoff = generatedAt - 24h
```

The resulting range at lines 170–172 is:

```text
updatedAt >= T && updatedAt < T
```

which is empty. Every orphan is reported as absent.

Values just below 1,440 are also unsafe for hourly automation. At 1,439 minutes, the query has only a one-minute eligibility window between becoming stale and falling outside the lookback. An hourly scan can miss that window completely even with no database saturation or outage.

The range therefore does not safely support the request schema it exposes. The lookback must exceed the maximum stale threshold by at least the scan cadence, scheduler jitter, and an explicit recovery margin—or, preferably, the selective connected-open index should allow unresolved stale sessions to remain visible without a lower 24-hour cutoff.

### 3. Live-call exclusion is asserted in comments but is not enforced against the canonical maximum duration

The route permits a threshold as low as 15 minutes and defaults it to 30 minutes at `app/api/admin/sla-check/route.ts` patch lines 17–20 and 27–28. The Convex comment references `VOICE_DURATION_DEFAULTS.maxDurationMs + goodbye grace`, but the implementation neither imports that authority nor derives its minimum from it (`convex/leads.ts` patch lines 151–164).

Consequently:

* The supplied range contains no executable assertion that 15 minutes exceeds the current hard maximum call duration plus all closing and heartbeat grace.
* A future duration increase can silently invalidate the 30-minute default.
* An authorized automation caller can choose 15 minutes regardless of the actual configured maximum.

The `connectedAt`/`closedAt` predicate correctly excludes never-connected and already-closed rows at a logical level, but the stronger claim that a genuinely live call cannot be flagged is not proven or maintained.

**Required correction:** derive the minimum stale threshold from a shared canonical server-safe duration/grace constant, reject lower overrides, and add boundary tests proving that the longest permitted live call remains ineligible while the first post-grace timestamp becomes eligible.

### 4. Secondary-sweep failure is collapsed into a healthy-looking zero

`getAdminOrphanedVoiceSessions` returns `{ ok: false, reason: "convex_unconfigured" }` rather than throwing when Convex is unconfigured (`lib/server/convex.ts` patch lines 208–215). The route’s `admin_sla.orphan_sweep_failed` warning exists only inside `.catch(...)` at `app/api/admin/sla-check/route.ts` patch lines 40–43.

Therefore an unconfigured Convex client:

* does **not** emit the specifically claimed `admin_sla.orphan_sweep_failed` warning;
* produces `orphanedVoiceSessions = null` internally;
* is converted to `orphanCount = 0`;
* returns `orphanedVoiceSessions: 0`;
* returns `truncated.orphanedVoiceSessions: false`;
* can return `alerted: false`.

See `app/api/admin/sla-check/route.ts` patch lines 44–49 and 99–112.

The JSON response does not include `orphanSweepAvailable`, even though that field appears to be added to the structured completion log at patch lines 91–98. Thus an automation consumer sees the same count and completeness values for:

* a successful sweep with exactly zero orphans; and
* a sweep that never ran.

The test at `tests/admin-sla-route.test.ts` patch lines 311–324 codifies this false-green representation by asserting a successful response containing zero orphans after the query rejects, without requiring an availability/unknown indicator.

The primary lead result should remain successful, but the secondary result must be tri-state rather than fabricated as zero. Return an explicit availability field and use `null` for unknown count/truncation, while logging every unavailable result—including returned `ok:false`, not only rejected promises.

### 5. Catching rejection does not establish latency isolation from the lead SLA plane

The primary snapshot is correctly obtained first, but the route then unconditionally awaits the secondary query at `app/api/admin/sla-check/route.ts` patch line 40. There is no route-level deadline or bounded wait.

A rejected secondary query is isolated. A stalled or excessively slow secondary request can still consume the route/runtime deadline and prevent the already-successful lead snapshot from being returned. The existing test covers only immediate rejection, not a never-settling or over-budget promise.

To uphold “the secondary sweep cannot fail the lead SLA plane,” the secondary call needs an explicit deadline below the route’s operational budget, followed by the same unavailable tri-state. The test suite needs a fake-timer case proving that an over-budget secondary query still yields the primary result.

### 6. Convex-before-web ordering is documented but not made mandatory or observable

The evidence manifest lines 94–99 state the correct required order, but none of the six changed implementation files adds an enforceable deployment gate or compatibility preflight.

This is particularly unsafe because deploying the web code first causes the new Convex function call to reject, after which the route can still return HTTP 200 with:

```json
{
  "ok": true,
  "orphanedVoiceSessions": 0,
  "alerted": false
}
```

A basic route health check can therefore pass under exactly the forbidden release ordering.

The managed release path must:

1. Deploy Convex functions from the exact integrated default-branch SHA.
2. Verify that `adminOrphanedVoiceSessionsSweep` is present and callable.
3. Only then deploy the web artifact from that same exact SHA.
4. Make staging smoke explicitly assert secondary availability, not merely HTTP 200.
5. Preserve guarded production promotion and rollback.

The supplied manifest also says exact-head GitHub CI must pass, but its completed-verification section lists only local install, lint, typecheck, focused Vitest, and `git diff --check`; it provides no exact-head GitHub run identity or result. That gate remains unproven.

## Controls that do hold

The client change at `components/voice-agent/VoiceAgentDialog.tsx` patch lines 125–139 captures only rejected close snapshots and leaves ordinary heartbeat rejection quiet. It adds no transcript, lead, email, organization, or session fields to the capture call. Given the manifest’s stated, unchanged client-side `beforeSend` contract, the new signal is PII-scrubbed. A synthetic-PII transport regression test would still be stronger than relying only on the existing sanitizer contract.

The connected/open predicate logically excludes never-connected and closed sessions. The query’s returned result set is capped at `SLA_QUERY_BUCKET_LIMIT + 1` and avoids `.collect()`. Those facts bound the returned payload, but they do not repair the unbounded post-index scan.

Within the supplied evidence, the unchanged `verifyAdminPermission(..., "ops.sla_check")` boundary and the interactive-review-credential negative test support the ops-automation-only route claim. No authorization weakening is introduced by this range.

These passing controls do not compensate for a query that can fail under healthy saturation, an accepted parameter that creates an empty detection window, an unavailable sweep represented as zero, and an unenforced deployment dependency.

VERDICT: DO NOT MERGE

[1]: https://docs.convex.dev/database/reading-data/indexes/ "Indexes | Convex Developer Hub"
