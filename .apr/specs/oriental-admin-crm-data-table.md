# Oriental admin CRM data table — merge review

Review the implementation linked to GitHub issue #54 as a data-integrity and
operator-workflow change. The admin must provide a real CRM table without
losing or weakening any enquiry evidence.

## Required contract

- The canonical lead record remains the source of truth. The CRM table must
  load a bounded canonical lead dataset independently of the smaller voice
  diagnostics snapshot, and must not derive full-table counts from filtered
  rows.
- Search, dedicated status/owner/priority/SLA/source filters, stable header
  sorting, column visibility, pagination, row selection, and responsive mobile
  cards must be usable and accessible.
- Existing controlled workflow editing and atomic bulk assignment must remain
  revision checked, permission checked, attributed, and auditable.
- Archive is soft delete only. It must patch records reversibly, retain the
  prior pipeline status and archive/restore provenance, increment the workflow
  revision, and append an event. There must be no hard-delete path.
- Archive and restore batches must be all-or-nothing. Duplicate targets,
  missing leads, stale revisions, invalid state transitions, and invalid
  reasons must fail before any record is patched.
- Archive permissions must be explicit. Viewers must remain read-only; the
  route must reject unauthenticated, unauthorized, malformed, missing, and
  conflicting requests with safe status codes.
- Existing leads, transcripts, notification delivery, ClickUp references,
  evaluation evidence, and audit events must remain intact. Schema changes
  must be additive and optional.
- The admin must not crash when shadcn/Base UI menus open. Column and row menus
  must work with both mouse and touch input, including a Pixel-class viewport.
- The implementation must not expose new operator metadata publicly, must pass
  formatting, lint, strict TypeScript, the complete automated suite, the admin
  browser matrix, the production build, and a visually inspected Webwright
  journey with no page overflow.
- This is a pre-merge code gate. Convex deployment and exact-SHA web promotion
  are mandatory post-merge gates and must not be claimed as complete here.

## Review request

Inspect the implementation evidence adversarially. Treat data loss, a hidden
hard-delete path, partial batch mutation, permission bypass, stale-write
overwrite, incorrect canonical counts, unusable filters/actions, a mobile menu
failure, public leakage, or unsafe release sequencing as blockers. Do not
demand final merged-SHA deployment evidence from an unmerged branch. End with
exactly `VERDICT: MERGE CRM TABLE` or `VERDICT: DO NOT MERGE`.
