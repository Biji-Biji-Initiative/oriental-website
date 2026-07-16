# Oriental admin CRM intelligence — ship review

Review PR #41 as a production CRM and data-integrity change. The admin must
turn live website enquiries into an understandable account/contact pipeline
without deleting, rewriting, hiding, or leaking enquiry data.

## Required contract

- Existing Convex leads, transcripts, notification history, events, and
  ClickUp tasks must be preserved. Schema changes must be optional and the
  reconciliation path must be idempotent and enrichment-only.
- Every existing lead whose ClickUp task already exists must gain its exact
  internal task ID and URL without creating a duplicate task.
- ClickUp task IDs and URLs are private operator metadata. They must be stored
  for the authenticated admin but never returned by the public lead-submission
  API or written to public success logs.
- CRM metrics must describe the complete lead dataset even when the visible
  table is filtered. Organizations, repeat contacts, possible duplicates,
  ownership, and stale workload must be derived deterministically.
- Organization matching must normalize case, punctuation, whitespace, and
  Unicode safely. Contact matching must avoid treating absent contact details
  as one shared contact.
- A possible duplicate may be flagged but must never be merged automatically.
- The admin must expose proper Tailwind tables for accounts, owner workload,
  lead pipeline, related enquiries, evaluation evidence, and delivery trace.
  Dense diagnostics may be collapsed, but no underlying evidence may be
  discarded.
- An operator must be able to open a lead, understand the person, account,
  source, status, owner, age, enquiry, relationship history, notification
  delivery, and exact ClickUp record without reconstructing it from raw logs.
- Sorting and filtering must be explicit, stable, and server-compatible. The
  default selected record must be an active lead rather than an archived one.
- The implementation must retain admin authentication, avoid new public data
  exposure, pass the full automated suite and production build, and remain
  deployable through the exact-SHA staging/production release contract.

## Review request

Inspect the implementation evidence adversarially. Report only concrete
ship-blockers or materially unsafe gaps in data preservation, privacy,
idempotency, CRM correctness, usability, or release safety. Do not ask for a
full external CRM, speculative abstractions, or unrelated redesign. End with
exactly `VERDICT: SHIP CRM` or `VERDICT: DO NOT SHIP`.
