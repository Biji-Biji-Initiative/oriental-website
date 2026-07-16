# Oriental admin CRM intelligence — implementation evidence

## Patch identity

- Pull request: `#41 feat(admin): add CRM account intelligence`
- Feature head: `9c18e18cae97ce2b4a891387657870574404b2be`
- Base at review: `dc23760c365f1005279b129cbc6d6cd2bf653c3b`
- GitHub CI `verify`: passed; PR reports mergeable.

## Live data baseline

Read-only aggregate inspection of production before reconciliation found:

- 31 leads, 30 with an organization, representing 20 normalized organizations;
- 3 multi-enquiry organizations and 4 repeat contacts;
- 30 unassigned leads;
- 31 ClickUp tasks scanned, mapping one-to-one to 31 Convex lead IDs;
- zero duplicate lead-to-task mappings;
- zero missing ClickUp tasks and zero stored direct task links.

The reconciliation dry run therefore reports 31 enrichment candidates and no
task creation requirement. Execution remains intentionally blocked until the
reviewed Convex functions are deployed.

## Data-preserving implementation

- `convex/schema.ts` adds only optional `notificationClickUpTaskId` and
  `notificationClickUpTaskUrl` fields.
- `confirmLeadClickUpMirror` remains idempotent. It enriches a boolean-confirmed
  record with exact references, does not recreate a task, and appends an event
  only when stored values change.
- `scripts/backfill-clickup-leads.ts` indexes existing ClickUp tasks by their
  embedded lead ID, detects missing references independently of the legacy
  boolean, defaults to dry-run, requires `--apply` for task creation, and never
  recreates a task when a match exists. `--reconcile-existing` is the explicit
  enrichment mutation flag. The audit reports total tasks scanned, mapped lead
  IDs, and duplicate lead-to-task mappings, and refuses every mutation if one
  lead maps to more than one task.
- No duplicate lead or account is automatically merged. Duplicate clusters are
  display-only evidence based on contact and a 30-minute window.

## Privacy boundary

The notification pipeline keeps the ClickUp `externalId` and `externalUrl`
internally so Convex can persist them. `publicNotificationResult` explicitly
reduces every public result to `{ ok, transport }`; the submission response and
success logs use only that public shape. A dedicated route test proves internal
references are persisted while absent from both the HTTP response and public
log entry. Admin rendering also validates the ClickUp hostname before exposing
an operator link.

## CRM behavior

`lib/admin-crm.ts` supplies pure, tested account/contact grouping, Unicode-safe
organization normalization, repeat-contact detection, possible-duplicate
clusters, organization coverage, owner workload, staleness, and the supported
sort modes. Empty contact details do not form a contact group.

The authenticated admin now includes:

- full-dataset account and ownership KPIs that remain stable under filters;
- Tailwind account portfolio and owner-workload tables;
- a sortable lead pipeline with account, repeat-contact, and duplicate signals;
- a default active lead selection;
- a direct ClickUp action when the exact stored URL is safe;
- human-readable channel delivery plus collapsed provider evidence;
- a related account/contact history table in each record.

The pre-existing evaluation and voice diagnostics remain available on their
dedicated views. No evidence is removed.

## Verification performed

- formatting clean;
- lint clean across 199 files;
- TypeScript check passed;
- 50 test files and 303 tests passed;
- admin Playwright suite: 21 passed across desktop and mobile, with one
  intentional mobile duplicate-mutation scenario skipped;
- production build passed on Next.js 16.2.10;
- `git diff --check` passed;
- local Firefox review at 1280 by 1800 showed zero document overflow and was
  visually inspected for the overview and record detail.

## Release boundary

No production data mutation or web deployment has occurred for this change.
This is a merge-authorization review, not a claim of live completion. After a
merge verdict, the exact main SHA must pass managed preflight. Convex then
deploys before any web promotion. The release stops unless reconciliation
proves all of the following before staging web deployment:

- the immutable lead payload hash and 31-lead count are unchanged;
- the same total ClickUp task count exists before and after;
- 31 lead IDs map one-to-one to 31 existing task references;
- duplicate lead-to-task mappings and newly created tasks both equal zero;
- all 31 leads store direct links; and
- a second reconciliation reports zero candidates and zero mutations.

Only then may staging and production be promoted and verified by exact SHA.
The final Webwright run follows production, and the separately owned PR #37
staging SHA is restored afterward. Any failed gate leaves the web release
undeployed and the outcome explicitly incomplete.
