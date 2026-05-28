# 07 — Data Model

Runtime truth: the launch site stores intake data in **Convex**, not
Postgres/Drizzle. The public Next.js app writes through `lib/server/convex.ts`;
the only Convex mutation exposed to the app is `api.leads.createLead`, protected
by `CONVEX_INGEST_SECRET`.

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
| `source` | `"voice" | "form" | "hero-email"` | Entry surface. |
| `segment` | string | One of the segment IDs in `lib/segments.ts`; Convex keeps it string-typed. |
| `routedTo` | string | Denormalised owner name at write time. |
| `routedToEmail` | string \| null | Resolved from `OWNER_*`; nullable so non-production can still capture. |
| `name` | string | For hero email capture this is currently `"Newsletter subscriber"`. |
| `email` | string | Validated by `lib/schemas.ts`. |
| `org` | string | For hero email capture this is `"Unknown"`. |
| `message` | string | For hero email capture this is `"Keep me posted about Oriental Building."`. |
| `transcript` | `{ role: string; text: string }[]` | Voice transcript rows; empty for form/newsletter. |
| `utm` | `Record<string,string>` | Optional attribution data. |
| `status` | string | Launch writes `"new"` only. |
| `notificationDelivered` | boolean? | True when at least one owner notification channel delivered. |
| `notificationEmailOk` | boolean? | Last owner email delivery result. |
| `notificationSlackOk` | boolean? | Last Slack delivery result. |
| `notificationSummary` | string? | Compact last notification status. |
| `lastNotificationAt` | number? | Last notification status write timestamp. |
| `createdAt` | number | Milliseconds since epoch, set by mutation. |

Indexes:

- `by_lead_id`
- `by_email`
- `by_segment`
- `by_status`

### `leadEvents`

Append-only lead audit events. Launch writes `created` and notification status
events.

| Field | Type | Notes |
|---|---|---|
| `leadId` | string | App lead ID, not Convex `_id`. |
| `kind` | string | Launch value: `"created"`. |
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
| `model` / `voice` / `speed` | optional | Realtime render settings used for the session. |
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
2. Turnstile is verified server-side.
3. `routeLead()` resolves segment owner metadata from `lib/segments.ts` and
   `OWNER_*` environment variables.
4. `persistLead()` calls Convex with `{ lead, ingestSecret }`.
5. Convex validates `CONVEX_INGEST_SECRET`, inserts `leads`, then inserts a
   `leadEvents` row.
6. Owner email and Slack notifications are attempted after persistence.
7. Notification status is patched back to the lead and appended to
   `leadEvents`.

If Convex is not configured locally, `persistLead()` returns
`{ persisted: false, reason: "convex_unconfigured" }` and the route still
returns `ok: true`. Production secret checks require Convex configuration.

## Segments And Routing

Segment IDs are owned by `lib/segments.ts`:

```ts
tenancy | education | programme | technology | ai | cultural | community | other
```

Owner email variables:

```dotenv
OWNER_TENANCY=
OWNER_EDUCATION=
OWNER_PROGRAMME=
OWNER_TECHNOLOGY=
OWNER_AI=
OWNER_CULTURAL=
OWNER_COMMUNITY=
OWNER_OTHER=
```

Owner names live in code so historical lead displays remain stable. Owner
emails live in environment variables so operations can rotate routing without a
copy or code deploy.

## Lifecycle

The microsite only creates `new` leads. Any later lifecycle state belongs to the
future internal CRM workstream.

Planned lifecycle vocabulary:

| Status | Meaning |
|---|---|
| `new` | Just landed. Owner has not yet acknowledged. |
| `contacted` | Owner has sent the first follow-up. |
| `qualified` | Conversation is real and ongoing. |
| `partnered` | We have a signed or near-signed partnership / tenancy. |
| `declined` | Either side decided no; capture reason in a note event. |
| `closed` | Terminal, cold, or abandoned. |

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

No automated retention job exists yet. Until PDPA/legal policy is finalized,
Convex lead documents and transcripts are retained indefinitely.

Launch follow-ups:

- Define retention/deletion policy for leads and transcripts.
- Decide whether IP-derived abuse data should ever be persisted. It is not
  stored today.
- Add CRM mutations for notes, status changes, and exports in a separate
  authenticated app.
