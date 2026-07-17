# Oriental admin CRM data table — implementation evidence

## Patch identity

- GitHub issue: `#54 Admin CRM: proper data tables, editing, and reversible archive`.
- Reviewed implementation tip: `8cf7add52d6f13737e112cc9fcce62e63d96580e`.
- Original feature commit: `39d48ec93f0057a20ff12133b85fddb7b54da6d9`.
- Base at review: `ba7b508c15c3862ddfeeb807a248bd16a482dccf`.
- Branch: `feat/admin-crm-data-table`.

## Canonical data and operator workflow

- `convex/leads.ts` keeps the bounded `adminLeadTable` row query with a
  1,000-row hard cap while adding an independent, unfiltered
  `adminLeadCounts` query over the complete canonical lead collection. It
  accepts the server-only ingest secret and calls `requireIngestSecret` before
  reading any lead document. The admin requests 500 renderable rows plus exact
  total, active, archived, qualified, unassigned-active, high-priority-active,
  ClickUp-gap, and Kuala-Lumpur-today counts. Filtering only changes the
  visible count; the canonical total and KPI strip remain unchanged. Fixture
  fallback calculates the same counts from the full fixture before slicing
  rows.
- `AdminEnquiryDataTable` uses the official shadcn table, checkbox, select, and
  dropdown primitives with TanStack Table 8.21.3. It provides global search,
  dedicated Status/Owner/Priority/SLA/Source filters, sortable headers, column
  visibility, 10/15/25/50 pagination, row selection, row actions, and the
  existing controlled workflow editor.
- Desktop uses a sticky, semantic table; mobile uses fully visible enquiry
  cards with the same selection and row actions. The default active scope hides
  archived records without removing them, and the Archived filter exposes
  them explicitly.
- Atomic bulk assignment remains on the existing revision-checked endpoint.
  Required owner, due date, next action, and reason fields keep submission
  disabled until valid.
- Base UI menu labels are placed inside required menu groups. Because the
  installed Base UI 1.6 trigger's mousedown path does not open under touch-only
  input, Columns and row-action menus are controlled and add a touch pointer-up
  open fallback while retaining normal desktop toggling.

## Reversible archive and data preservation

- `convex/schema.ts` adds only optional `archivedAt`, `archivedBy`,
  `archiveReason`, `preArchiveStatus`, `restoredAt`, and `restoredBy` fields.
- `archiveLeads` validates the ingest secret, batch size, unique lead IDs,
  reason, existence, exact workflow revision, and allowed current state for all
  targets before applying any patch.
- Archive records the prior non-archived status, actor, time, and reason;
  restore returns to that prior status or `new` for a legacy archived record.
  Both actions increment `workflowRevision` and append attributed
  `workflow_archive` or `workflow_restore` events with diffs.
- The mutation contains no `ctx.db.delete` call. No transcript, notification,
  ClickUp, evaluation, or audit fields are removed or rewritten.
- `/api/admin/leads/archive` requires the new `leads.archive` permission,
  validates the signed request schema, forwards the authenticated actor and
  request ID, returns no-store responses, and maps validation, auth,
  permission, not-found, conflict, and service errors safely.
- Admin and operator roles receive `leads.archive`; the viewer remains
  read-only. Archive/restore dialogs require an auditable reason and explicitly
  state that customer, transcript, delivery, and audit data is not deleted.
- Ordinary workflow editing can no longer cross the archive boundary.
  `adminLeadWorkflowSchema` excludes `archived`, the editor omits Archive as a
  stage, archived records show a locked workflow explanation, and archived row
  actions expose Restore instead of Edit. Independently, `updateLeadWorkflow`
  rejects both requested `archived` status and any currently archived lead
  before its first `ctx.db.patch`, returning `archive_boundary`. Archive and
  restore therefore run exclusively through the permission-checked provenance
  mutation.

## Executable verification

- `pnpm lint`: passed across 220 files.
- `pnpm typecheck`: passed after clean Next type generation.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm test --run`: 57 files and
  377 tests passed.
- Focused integrity matrix: 5 files and 48 tests passed for schemas, adapter,
  workflow and archive routes, reversible patch source contracts, archive
  boundary ordering, independent canonical counts, caps, permissions, and
  conflicts.
- `pnpm build`: passed on Next.js 16.2.10 and emitted the new
  `/api/admin/leads/archive` route.
- Admin Playwright matrix: 37 passed across desktop Chromium and Pixel 7, with
  the pre-existing mobile mutation scenario intentionally skipped. It covers
  semantic tables, responsive cards, filtering with stable canonical totals,
  stable URL sorting, complete records, workflow editing, atomic assignment,
  reversible archive, no overflow, and mouse/touch shadcn menus.
- Webwright reusable run:
  `/Users/gsplace/.cache/webwright/oriental-admin-crm-table/final_runs/run_1/`.
  All eight critical points are checked using a real 412px mobile page rather
  than an iframe. The final result is 3 desktop rows, 3 mobile cards, 0px
  desktop overflow, and 0px mobile overflow. Screenshots prove the table,
  column menu, Unassigned filter, Contact sort, edit dialog, assignment dialog,
  archive guardrail, and mobile cards.
- `git diff --check`: passed.

## APR round-one blocker closure

1. General workflow PATCH no longer accepts `archived`. The Convex mutation
   also checks both requested and canonical current status atomically before a
   patch. Direct route tests prove active-to-archived is rejected before the
   adapter and archived-to-active returns `archive_boundary`; a source-order
   regression proves the canonical guard precedes every workflow patch.
2. `adminLeadCounts` is independent of `adminLeadTable.take(limit)`. The
   adapter regression returns two visible rows with a canonical total of 720,
   and the browser regression applies the Unassigned filter while proving the
   badge changes to `1 visible` and remains `3 canonical` on desktop and
   Pixel 7.

## APR round-two blocker closure

1. The round-two cookie-path concern was a stale contract sentence, not an
   implementation defect. `adminCookieHeader` and `clearAdminCookieHeader`
   both use `Path=/`; the cookie is HttpOnly and SameSite=Lax, with Secure added
   in production. The contract now matches this. A real Playwright regression
   clears all cookies, authenticates through `POST /api/admin/login`, asserts
   the stored cookie attributes, calls the protected lead PATCH without a
   bearer header, receives authenticated payload validation rather than 401,
   and reloads the admin UI. It passes on Chromium and Pixel 7.
2. The count query protection is now explicit in evidence and executable
   source-order proof: `adminLeadCounts` requires `ingestSecret`, calls
   `requireIngestSecret(ingestSecret)` before `collect()`, and the server adapter
   is the only caller exposed to the Next admin page.

## Browser-discovered corrections

The reusable review caught three blockers before this gate:

1. An empty-string Unassigned filter was auto-removed by TanStack, so it now
   keeps an explicit `unassigned` sentinel and matches empty owners correctly.
2. Base UI group labels outside `Menu.Group` crashed both dropdowns, so every
   label and its items now use the required group context.
3. Mouse-only menu proof missed touch behavior; controlled pointer-up fallback
   plus a desktop/mobile regression now proves both menu types on Pixel 7.

## Release boundary

No Convex deployment, staging web deployment, production data mutation, or
production web promotion has been performed for this branch. After merge,
Convex schema/functions deploy first. The exact merged main SHA must then pass
managed preflight and exact-SHA staging verification before production can be
considered. The known OpenAI Realtime quota gate remains separate and cannot be
overridden by this CRM merge verdict.
