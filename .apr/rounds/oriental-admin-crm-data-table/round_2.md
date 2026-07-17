## Merge gate finding

The supplied evidence closes most of the requested data-integrity risks, but it contains a concrete authentication-path contradiction that can make the CRM actions unusable in a real browser session.

### Blocker: the admin cookie cannot authenticate the documented API routes

`docs/06-API-CONTRACTS.md:425-428` says that `/api/admin/login` sets the HTTP-only `oriental_admin` cookie scoped to:

```text
/admin
```

The protected review and mutation endpoints are instead under:

```text
/api/admin/review
/api/admin/leads/[leadId]
/api/admin/leads/bulk
/api/admin/leads/archive
```

A cookie whose `Path` is `/admin` is not sent for requests beginning `/api/admin`. Cookie path matching is prefix-based from the beginning of the request path; it does not match `/admin` appearing later inside `/api/admin`.

Consequently, if the contract reflects the implementation, an operator can successfully log in and load an `/admin` page, but browser requests to the CRM APIs will omit the session cookie and receive `401`. That blocks workflow editing, bulk assignment, archive, restore, and potentially loading the review data itself.

If the implementation actually uses `Path=/`, the API contract is materially wrong about an authentication boundary and still needs correction before merge. Either interpretation leaves the submitted evidence internally inconsistent.

The browser evidence does not close this issue. It reports successful editing and archive journeys, but does not state that the tests:

1. authenticated through the real `/api/admin/login` route;
2. accepted its actual `Set-Cookie` header;
3. invoked `/api/admin/...` without a bearer header, manually injected cookie, or route mock; and
4. proved the server received the cookie.

The intentionally skipped mobile mutation scenario is not the primary blocker, since touch-menu opening was separately exercised, but it also cannot serve as end-to-end proof of cookie-authenticated mobile actions.

### Additional unresolved public-leakage check

The evidence describes the new `adminLeadCounts` Convex query but does not state whether it is an `internalQuery` or performs the same server-secret validation as the existing administrative lead query. The archive mutation’s ingest-secret validation is described explicitly; the counts query’s protection is not.

Exact lead totals, qualification counts, priority counts, assignment gaps, and ClickUp gaps are operator metadata. Before re-review, the evidence should show that a direct unauthenticated Convex invocation cannot retrieve those counts. This may already be implemented, but it is not established by the attached evidence.

### Findings that otherwise satisfy the gate

On the supplied evidence, the core data-integrity design is sound:

* Archive is a reversible patch, not deletion. The schema additions are optional, contact and enquiry evidence remain intact, revisions increase, and archive/restore events retain attribution and provenance.
* Archive batches validate duplicate IDs, existence, state, reason, and every expected revision before the first patch. Running the operation as one Convex mutation supplies the required all-or-nothing transaction boundary.
* Ordinary workflow updates cannot cross the archive boundary, and stale revisions return conflicts before overwriting canonical data.
* Archive permission is separate, viewers remain read-only, and the API documents safe authentication, authorization, validation, missing-record, and conflict responses.
* Canonical KPI counts are independent of the bounded render-row query and client-side filtering.
* Desktop tables, mobile cards, filtering, sorting, selection, pagination, menus, touch behavior, and overflow received substantial browser coverage.
* Lint, strict type checking, the complete automated suite, focused integrity tests, production build, and diff checks are reported as passing.
* The release sequence is appropriate: no branch deployment is claimed, Convex schema/functions deploy first after merge, and exact merged-main-SHA staging verification remains a post-merge gate. Final deployment proof is neither available nor required at this pre-merge stage.

The cookie path must be aligned with both `/admin` and `/api/admin`—normally through a suitably protected root-path session cookie or an equivalent routing design—and proven with a real login-to-mutation browser regression. The Convex counts query’s server-only protection must also be made explicit.

VERDICT: DO NOT MERGE
