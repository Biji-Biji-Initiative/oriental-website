# 07 — Data Model

Runtime truth: the launch site stores intake data in **Convex**, not
Postgres/Drizzle. The public Next.js app writes through `lib/server/convex.ts`;
Convex app mutations are protected by `CONVEX_INGEST_SECRET`.

```
Next Route Handler ──persistLead()──────────────► Convex mutation ──► leads
                                                        └──────────► leadEvents
Voice modal ────────signed review snapshot──────► /api/voice/debug ─► voiceSessions
```

## Tables

Schema source: `convex/schema.ts`.

### `leads`

One document per enquiry across the voice modal, manual form, and hero email
capture.

| Field | Type | Notes |
|---|---|---|
| `_id` / `_creationTime` | Convex-managed | Internal document identity and creation time. |
| `leadId` | string | App-generated UUID from `routeLead`; returned to the browser. |
| `source` | `"voice" | "form" | "hero-email"` | Coarse interaction channel retained for compatibility. |
| `entryPoint` | string? | Bounded CTA category (`hero_primary`, `nav_desktop`, etc.); no URL or copy. |
| `entryMethod` | string? | Independent opening method: `voice_button`, `form`, `email_capture`, or `unknown`. |
| `submissionMethod` | string? | `voice_command`, `handoff_button`, or `email_capture_button`. |
| `fieldProvenance` | object? | PII-free fixed six-field capture method and bounded edit/correction/clear counters. |
| `segment` | string | One of the segment IDs in `lib/segments.ts`; Convex keeps it string-typed. |
| `routedTo` | string | Denormalised owner name at write time. |
| `routedToEmail` | string \| null | Resolved from `OWNER_*`; nullable so non-production can still capture. |
| `name` | string | For hero email capture this is currently `"Newsletter subscriber"`. |
| `email` | string | Validated by `lib/schemas.ts`. |
| `org` | string | For hero email capture this is `"Unknown"`. |
| `message` | string | For hero email capture this is `"Requested Oriental Building updates from the hero email capture."`. |
| `transcript` | `{ role: string; text: string }[]` | Voice transcript rows; empty for form/newsletter. |
| `utm` | `Record<string,string>` | Optional attribution data. |
| `status` | string | Admin workflow state; new leads start as `"new"`. |
| `priority` | string? | Admin workflow priority: `low`, `normal`, `high`, or `urgent`. |
| `owner` | string? | Human owner currently responsible for follow-up. |
| `workflowNote` | string? | Latest admin handoff / next-action note. |
| `lastReviewedAt` | number? | Last admin workflow update timestamp. |
| `notificationDelivered` | boolean? | True when owner email, Slack, or ClickUp delivered for a full lead; newsletter-only capture uses subscriber confirmation. |
| `notificationEmailOk` | boolean? | Last owner email delivery result when owner email was attempted. |
| `notificationSlackOk` | boolean? | Last Slack delivery result when Slack was attempted. |
| `notificationClickUpOk` | boolean? | Current confirmation that a ClickUp mirror task exists for the lead. |
| `notificationClickUpTaskId` | string? | Provider task ID returned by ClickUp or recovered by reconciliation. |
| `notificationClickUpTaskUrl` | string? | Direct URL to the confirmed ClickUp task. |
| `notificationConfirmationOk` | boolean? | Last submitter or newsletter confirmation email result. |
| `notificationSummary` | string? | Compact last notification status. |
| `lastNotificationAt` | number? | Last notification status write timestamp. |
| `createdAt` | number | Milliseconds since epoch, set by mutation. |

Indexes:

- `by_lead_id`
- `by_email`
- `by_segment`
- `by_status`

### `leadEvents`

Append-only lead audit events. Launch writes `created`, notification status,
admin `workflow_update`, and `clickup_reconciled` events.

| Field | Type | Notes |
|---|---|---|
| `leadId` | string | App lead ID, not Convex `_id`. |
| `kind` | string | Values include `created`, `notification_delivered`, `notification_failed`, `clickup_reconciled`, and `workflow_update`. |
| `actor` | string? | `system` for app-generated events; `admin` for console workflow mutations. |
| `fromStatus` | string? | Previous status for workflow updates. |
| `toStatus` | string? | New status for workflow updates. |
| `note` | string? | Human-readable event note. |
| `createdAt` | number | Milliseconds since epoch. |

Index:

- `by_lead`

### `voiceSessions`

One document per signed Realtime review session. The browser posts periodic
snapshots while the modal is open and a final snapshot after successful voice
submission.

| Field | Type | Notes |
|---|---|---|
| `reviewId` | string | Signed review UUID returned by `/api/voice/session`. |
| `sessionId` | string | OpenAI Realtime session id when available. |
| `leadId` | string \| null | Set after successful `/api/leads` voice submission. |
| `segment` | string | Current routed segment. |
| `status` | string | Dialog status (`idle` or `submitted`). |
| `connectionStatus` | string | WebRTC state from the client. |
| `deviceProfile` / `deploymentEnvironment` | optional | Evidence attribution for device class and local/staging/production traffic. |
| `activationAttempted` | boolean? | Explicit post-mint user activation; distinguishes an empty failed attempt from an unused prewarm or legacy unknown row. |
| `entryPoint` / `entryMethod` / `submissionMethod` | optional | Bounded entry surface, opening method, and final submission categories. Unused prewarms carry no entry attribution; heartbeats never erase an already persisted submission method. |
| `fieldProvenance` | object? | PII-free source/correction summary for the six captured fields; no captured values. |
| `model` / `voice` / `speed` | optional | Realtime render settings used for the session. |
| `runtimeProfile` / `modelCell` / `reasoningCell` | optional | Controlled experiment dimensions; only one may differ from control in a release. |
| `latency` | object? | Bounded activation and turn timing, including tap-to-live and tap-to-audible. |
| `transport` | object? | Retry, remote-track, disconnect, ICE recovery, and bounded network diagnostics. |
| `captured` | object | Current editable handoff fields. |
| `transcript` | `{ role: string; text: string }[]` | Latest text transcript. |
| `usage` | object? | Reduced Realtime usage counters. |
| `errors` | array | Realtime/client error summaries. |
| `rateLimits` | array | Realtime rate-limit telemetry. |
| `routeRequested` | boolean | Whether Reka has attempted route submission. |
| `createdAt` / `updatedAt` | number | Millisecond timestamps. |
| `submittedAt` | number? | Final successful voice-submit timestamp. |

Indexes:

- `by_review_id`
- `by_session_id`
- `by_updated_at`

## Write Path

1. Route handler validates a request with Zod (`lib/schemas.ts`).
2. Signed review credentials are verified for voice-origin submissions.
   Unsigned form submissions verify Turnstile only when
   `TURNSTILE_ENFORCEMENT=required`; `relaxed` keeps the Redis-backed limiter as
   the active abuse boundary.
3. `routeLead()` resolves segment owner metadata from `lib/segments.ts` and
   `OWNER_*` environment variables.
4. `persistLead()` calls Convex with `{ lead, ingestSecret }`.
5. Convex validates `CONVEX_INGEST_SECRET`, inserts `leads`, then inserts a
   `leadEvents` row.
6. Owner email and Slack notifications are attempted after persistence for full lead submissions; newsletter-only captures send subscriber confirmation only.
7. Notification status, including confirmation email status and the optional
   ClickUp task ID/URL, is patched back to the lead and appended to
   `leadEvents`.
8. Existing ClickUp tasks can be reconciled idempotently with
   `pnpm backfill:clickup -- --reconcile-existing`. Reconciliation adds only
   the confirmed task reference and a `clickup_reconciled` event; it does not
   rewrite the lead payload, workflow fields, transcript, or timestamps.
9. Admin workflow changes from `/admin/session-review` patch `status`,
   `priority`, `owner`, optional `workflowNote`, and append a `workflow_update`
   event.

If Convex is not configured locally, `persistLead()` returns
`{ persisted: false, reason: "convex_unconfigured" }` and the route still
returns `ok: true`. Production secret checks require Convex configuration.

## Segments And Routing

Segment IDs are owned by `lib/segments.ts`:

```ts
tenancy | education | programme | technology | community | other
```

Owner email variables:

```dotenv
OWNER_TENANCY=
OWNER_EDUCATION=
OWNER_PROGRAMME=
OWNER_TECHNOLOGY=
OWNER_COMMUNITY=
OWNER_OTHER=
```

Historical `OWNER_AI` and `OWNER_CULTURAL` values are retired deployment
tombstones. AI enquiries route through `technology`; cultural enquiries that
do not fit another segment route through `other`.

Owner names live in code so historical lead displays remain stable. Owner
emails live in environment variables so operations can rotate routing without a
copy or code deploy.

## Lifecycle

The admin console now owns a lightweight workflow queue for intake follow-up.
The public microsite still creates all leads as `new`.

| Status | Meaning |
|---|---|
| `new` | Just landed. Owner has not yet acknowledged. |
| `reviewing` | Someone is actively checking fit/routing. |
| `contacted` | Owner has sent or scheduled the first follow-up. |
| `qualified` | Conversation is real and ongoing. |
| `archived` | Terminal, cold, duplicate, or not useful for follow-up. |

## Deploy And Operations

Commands:

```bash
pnpm convex:codegen
CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
```

Do not hand-edit `convex/_generated/`; regenerate after schema changes.

Runtime secrets:

```dotenv
CONVEX_URL=
NEXT_PUBLIC_CONVEX_URL=
CONVEX_INGEST_SECRET=
CONVEX_DEPLOY_KEY= # deploy only, not app runtime
```

## Retention

The published policy is enforced by the nightly `analytics-ops.yml` retention
job and a bounded `leads.applyDataRetention` mutation:

- unsubmitted voice-session diagnostics are deleted after 30 days;
- submitted voice-session diagnostics are deleted after 90 days;
- transcript content copied onto a lead is stripped after 90 days;
- archived leads and their workflow events are deleted after 730 days;
- PII-free aggregate analytics can be retained beyond the source-record window.

Each API call deletes a bounded batch and reports `hasMore`; the workflow calls
up to ten batches and fails visibly if a backlog remains. The protected
`DELETE /api/admin/privacy` path lets an admin execute a verified data-subject
deletion by normalized email. It removes matching leads, workflow events, and
linked or email-matching voice sessions only after addressable Slack/ClickUp
copies have been removed and manual email/legacy-copy cleanup has been
confirmed. It returns counts only and writes a contact-free audit record keyed
by the operator's request UUID.

IP-derived abuse identities are not persisted in Convex. Add richer CRM export
only once a downstream owner and its own retention contract exist.

## CRM Intelligence

The admin CRM derives customer context from the complete lead set at read time:

- exact normalized email (or phone fallback) identifies returning contacts;
- normalized organization identifies account history and multi-enquiry
  organizations;
- same contact, segment, and normalized request within 30 minutes is flagged as
  a possible duplicate for human review;
- account portfolio, owner workload, and related-enquiry tables are derived
  views and do not merge or delete lead documents.

This keeps every enquiry independently auditable while giving operators
account-level context.

## Admin Command Center

The default admin Overview derives an action-first command model from the same
complete lead set. It ranks active enquiries by delivery failure, declared
priority, missing owner, SLA age, follow-up readiness, ClickUp linkage, and
returning customer/account context. It also calculates pipeline stage, source,
segment, route, assignment, delivery, enrichment, and Reka coverage summaries.

These are read-time views only. No command-center calculation mutates, merges,
deduplicates, or discards source records. Ratios with no valid denominator stay
unavailable instead of being reported as zero.
