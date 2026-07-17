## Merge-gate findings

### Blocker 1 — The general workflow endpoint still exposes an archive/restore bypass

The authoritative API contract still allows the ordinary workflow mutation to submit:

```ts
status: "new" | "reviewing" | "contacted" | "qualified" | "archived";
```

That is `PATCH /api/admin/leads/[leadId]` in `docs/06-API-CONTRACTS.md:436-470`. According to the same contract, this endpoint:

* Requires ordinary lead-update permission, not `leads.archive`.
* Appends a generic `workflow_update` event.
* Does not promise to record `archivedAt`, `archivedBy`, `archiveReason`, `preArchiveStatus`, `restoredAt`, or `restoredBy`.

The new archive endpoint separately requires `leads.archive` and guarantees reversible archive provenance. Nothing in the evidence says that the old PATCH handler or underlying workflow mutation was changed to reject transitions:

* From an active status to `archived`.
* From `archived` back to an active status.

The evidence also says the existing controlled workflow editor remains in place, without saying that `archived` was removed or transition-guarded.

Consequently, a caller using the general PATCH endpoint can potentially:

* Archive without passing the explicit archive-permission check.
* Create a newly archived record without its prior pipeline status and archive provenance.
* Restore by changing the status without a `workflow_restore` event or restore attribution.
* Circumvent the archive route’s state-transition rules.

Current built-in roles having overlapping permissions does not eliminate the defect. `leads.update` and `leads.archive` are declared as separate capabilities, so every server-side path crossing the archive boundary must enforce the archive capability and archive semantics.

The required correction is to reject archive-boundary transitions in the general workflow mutation based on both current and requested status. Archive and restore transitions must go exclusively through the archive mutation, or the general mutation must invoke exactly the same permission, provenance, revision, and event logic. Direct API tests should prove that active-to-archived and archived-to-active PATCH requests fail without changing the record.

### Blocker 2 — Canonical full-table counts are not established

The evidence says:

* `adminLeadTable` has a 1,000-row hard cap.
* The page requests 500 canonical leads.
* Tests cover the canonical query and its cap.

It does not identify a canonical total-count result, a separate unfiltered count query, or a test proving that displayed full-table counts remain unchanged when filters are applied. The browser evidence uses only three rows.

A 500-row client dataset cannot by itself produce a correct corpus count once more than 500 leads exist. Likewise, counts calculated from TanStack’s filtered row model would violate the explicit requirement not to derive full-table counts from filtered rows.

Because wrong canonical counts are designated as blockers, the evidence needs to establish that any displayed total, active, archived, or other full-table count comes from an unfiltered canonical count computed independently of the bounded row page. A regression should use more records than the requested row limit and should apply search and dedicated filters while asserting that canonical totals remain correct.

## Evidence that otherwise supports the change

The submitted evidence is strong for the new archive mutation itself:

* Schema additions are optional and additive.
* Targets are validated before patches begin.
* Revisions, duplicate IDs, existence, state, reason, and batch size are checked.
* No `ctx.db.delete` is present in the archive mutation.
* Archive and restore append attributed events and increment revisions.
* Viewer access remains read-only on the new route.
* Desktop tables, mobile cards, mouse menus, touch menus, filters, sorting, editing, assignment, archive dialogs, and overflow received browser coverage.
* Lint, TypeScript, tests, build, and diff checks passed.

The release boundary is also correctly stated. Convex schema/functions are to deploy before the web application, followed by exact-merged-SHA staging verification. Final deployment proof is not required for this pre-merge gate.

Those positives do not close the alternate archive path or the canonical-count requirement.

VERDICT: DO NOT MERGE
