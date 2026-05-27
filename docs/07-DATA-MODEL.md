# 07 — Data Model

Postgres. Two tables. That's the entire app-owned schema for v1.

```
leads ─────► lead_events
```

---

## `leads`

One row per enquiry, across all surfaces.

```sql
create table leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Routing
  segment         text not null
                  check (segment in (
                    'tenancy','education','programme','technology',
                    'ai','cultural','community','other'
                  )),
  routed_to       text not null,                   -- denormalised name; survives staff changes
  routed_to_email text not null,                   -- resolved at write time from OWNER_<SEG>
  source          text not null
                  check (source in (
                    'voice','form','hero-email','footer-email','admin'
                  )),

  -- Person
  name            text,
  email           text not null,
  org             text,
  message         text,

  -- Conversation
  transcript_url  text,                            -- s3://... or null
  ai_summary      text,                            -- short LLM-written summary

  -- Marketing
  utm             jsonb,
  ip_hash         text,                            -- sha256(ip + daily salt)
  user_agent      text,

  -- Lifecycle
  status          text not null default 'new'
                  check (status in (
                    'new','contacted','qualified','partnered','declined','closed'
                  ))
);

create index leads_created_at_desc on leads (created_at desc);
create index leads_segment_status   on leads (segment, status);
create index leads_email            on leads (lower(email));
```

### Field notes

- **`routed_to`** is the **name** ("Chewi", "Lala"). We denormalise to survive
  staff transitions — if Chewi leaves, historical leads still show "routed to
  Chewi" even after we point new ones at someone else.
- **`routed_to_email`** is the address that was emailed at the time. Same
  rationale — auditability.
- **`source`** distinguishes the four entry points + a fifth (`admin`) for
  manual entry from the Mereka-admin app.
- **`transcript_url`** is `null` for form submissions. For voice, points at
  a JSON blob: `[{ "role": "user"|"assistant", "text": "..." }, ...]`.
- **`ip_hash`** is sha256 over `IP + DAILY_SALT`. Lets us detect repeat
  submissions from the same person same day without storing raw IP (PDPA-friendly).

## `lead_events`

Append-only audit log of everything that has happened to a lead.

```sql
create table lead_events (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references leads(id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text,                       -- 'system' | 'chewi@mereka.io' | etc.
  kind      text not null
            check (kind in (
              'created','emailed','slack_posted',
              'replied','meeting_booked','status_changed','note_added',
              'transcript_attached','retry_succeeded','retry_failed'
            )),
  payload   jsonb
);

create index lead_events_lead_id_at on lead_events (lead_id, at desc);
```

Common payload shapes:

```jsonc
// kind: 'status_changed'
{ "from": "new", "to": "contacted" }

// kind: 'emailed'
{ "to": "chewi@mereka.io", "ses_message_id": "...", "template": "lead-routed-v1" }

// kind: 'slack_posted'
{ "channel": "#partner-intake", "ts": "1714578123.123456" }
```

## Lifecycle

```
            ┌──────────────────────────────────────────────────┐
            │                                                  │
created ─▶ new ──▶ contacted ──▶ qualified ──▶ partnered ──▶ closed
                        │              │
                        ▼              ▼
                     declined       declined
```

| `status` | Meaning |
|---|---|
| `new` | Just landed. Owner has not yet acknowledged. |
| `contacted` | Owner has sent the first follow-up. |
| `qualified` | Conversation is real and ongoing. |
| `partnered` | We have a signed (or near-signed) partnership / tenancy. |
| `declined` | Either side decided no. Capture reason in a `note_added` event. |
| `closed` | Terminal. Cold or abandoned. |

The microsite **only ever writes `new`**. Everything else moves through the
Mereka-admin app (separate workstream).

## Lead-routing resolver

When the API writes a lead it resolves `routed_to_email` from env, like:

```ts
const RESOLVE: Record<Segment, { name: string; email: string }> = {
  tenancy:    { name: 'Chewi',    email: process.env.OWNER_TENANCY!   },
  education:  { name: 'Lala',     email: process.env.OWNER_EDUCATION! },
  programme:  { name: 'Jey',      email: process.env.OWNER_PROGRAMME! },
  technology: { name: 'Gurpreet', email: process.env.OWNER_TECHNOLOGY! },
  ai:         { name: 'Gurpreet', email: process.env.OWNER_AI!        },
  cultural:   { name: 'AVI',      email: process.env.OWNER_CULTURAL!  },
  community:  { name: 'Ambika',   email: process.env.OWNER_COMMUNITY! },
  other:      { name: 'Nadia',    email: process.env.OWNER_OTHER!     },
};
```

The `name` is a constant in code, not env, because copy lives with code. The
**email** is env-driven so HR changes don't need a code deploy.

## Migrations

Drizzle migrations live under `drizzle/`. The first migration creates both
tables + indexes. The Coolify pre-deploy hook runs `pnpm db:migrate`.

Forward-only — no automatic down migrations. To revert, write a new forward
migration.

## Retention

| Data | Retention |
|---|---|
| Lead row | Forever (or until a future deletion request) |
| `transcript_url` blob | 90 days from `created_at`, then S3 lifecycle deletes |
| `ip_hash` | 30 days, then nulled by a nightly job |
| `user_agent` | 30 days, then nulled by a nightly job |

PDPA review of these durations is pending.

## Future: `attachments`

When a partner sends a deck / PDF in follow-up, the Mereka-admin app will need
an `attachments` table. Out of scope for v1 — sketch a column shape now so we
don't paint ourselves into a corner:

```sql
-- v2 sketch
create table lead_attachments (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  uploaded_at timestamptz not null default now(),
  uploaded_by text,                     -- mereka staff email
  filename    text not null,
  s3_url      text not null,
  size_bytes  bigint not null,
  mime        text not null
);
```
