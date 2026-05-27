# 06 — API Contracts

Every Route Handler the production app exposes. Use this to:

- Build the server side without guessing payload shapes.
- Mock these in front-end tests.
- Document for future internal consumers (the Mereka-admin app).

All routes are **Node runtime**, on Coolify. All POST routes require a
**Cloudflare Turnstile token** in the body, validated server-side before any
side effect.

Shared response envelope:

```ts
type Ok<T>  = { ok: true } & T;
type Err    = { ok: false; error: string; details?: unknown };
type Reply  = Ok<unknown> | Err;
```

`error` values are stable, human-readable, and **safe to surface** in toasts.

---

## `POST /api/leads`

**Purpose.** Persist a partner enquiry and notify the routed owner.

### Request

```http
POST /api/leads
Content-Type: application/json
```

```ts
type LeadRequest = {
  source: 'voice' | 'form';
  segment: 'tenancy'|'education'|'programme'|'technology'|'ai'|'cultural'|'community'|'other';
  form: {
    name:    string;   // 1..120
    email:   string;   // RFC 5322-ish, /^\S+@\S+\.\S+$/
    org:     string;   // 0..200
    message: string;   // 0..2000
  };
  transcript?: Array<{ role: 'user' | 'assistant'; text: string }>;
  utm?: Record<string, string>;
  turnstileToken: string;
};
```

### Response (200)

```ts
type LeadResponse = { ok: true; id: string };
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | zod validation failed |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token |
| 429 | `rate_limited` | > 10 submissions / IP / hour |
| 502 | `ses_failed` | Email send failed (lead still saved; retry queued) |
| 500 | `internal` | Unhandled — Sentry will capture |

### Side effects (in order)

1. Insert into `leads`.
2. Insert into `lead_events` with `kind='created'`.
3. SES email to `OWNER_<SEGMENT>` (BCC `team@mereka.io`).
4. Slack webhook to `#partner-intake`.
5. (Future) write transcript JSON to S3, patch `transcript_url` on the row.

If any of (3)–(5) fail, the row is **still committed**. The failure is logged
and a retry is queued.

---

## `POST /api/voice/session`

**Purpose.** Mint an OpenAI Realtime ephemeral token so the browser can open a
WebRTC session without ever holding `OPENAI_API_KEY`.

### Request

```ts
type VoiceSessionRequest = {
  turnstileToken: string;
  intent?: 'tenancy' | 'education' | ... | 'other';  // optional pre-pick
};
```

### Response (200)

Mirrors the shape returned by OpenAI's `realtime/sessions` endpoint, scoped to
what the client needs:

```ts
type VoiceSessionResponse = {
  ok: true;
  client_secret: { value: string; expires_at: number };
  session_id: string;
  model: string;
  voice: string;
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 403 | `turnstile_failed` | — |
| 429 | `rate_limited` | > 3 sessions / IP / day |
| 502 | `openai_unavailable` | Upstream timeout / 5xx |
| 500 | `internal` | — |

### Constraints

- Server-side session length cap: **180 seconds** (configured in the request
  to OpenAI).
- The route does **not** log the user's intent against IP — it's used only to
  seed the system prompt for that session.

---

## `POST /api/newsletter`

**Purpose.** The hero email-capture surface. Lightweight — just save an
email + UTM under `source='hero-email'` in the same `leads` table.

### Request

```ts
type NewsletterRequest = {
  email: string;
  utm?: Record<string, string>;
  turnstileToken: string;
};
```

### Response (200)

```ts
type NewsletterResponse = { ok: true };
```

### Errors

| HTTP | `error` |
|---|---|
| 400 | `invalid_email` |
| 403 | `turnstile_failed` |
| 429 | `rate_limited` |
| 500 | `internal` |

### Side effects

1. Insert into `leads` with `segment='other'`, `routed_to='Nadia'`,
   `source='hero-email'`, `name=null`, `org=null`, `message=null`.
2. No email or Slack notification — these are *cold* leads, batched into a
   weekly digest sent to `team@mereka.io` (deferred; see roadmap).

---

## `GET /api/health`

**Purpose.** Coolify health-check.

### Response (200)

```json
{ "ok": true, "version": "<git-sha>", "uptime_s": 12345 }
```

Returns **503** if the DB ping fails. Used by Coolify to determine whether to
swap traffic on a new deploy.

---

## Cross-cutting concerns

### Idempotency

Not required for v1. The form prevents double-submit client-side; voice
submission happens on `route_to_team` which is single-shot.

### Rate limiting

Implemented via a small sliding-window helper on top of Redis (self-hosted
in the same Coolify project). Key = `ratelimit:{route}:{ip}`.

| Route | Limit |
|---|---|
| `/api/leads` | 10 / hour / IP |
| `/api/voice/session` | 3 / day / IP |
| `/api/newsletter` | 5 / hour / IP |

429 responses include a `Retry-After` header.

### CORS

All routes are same-origin only — no CORS headers emitted. If the Mereka-admin
app ever needs read access, it goes through a separate authenticated route,
not these.

### Input validation

All payloads parsed through **zod**. Schemas live in `lib/schemas.ts` so the
client and server share them. Validation errors return `400 invalid_payload`
with `details` containing the zod issue list (safe to surface to dev tools,
**not** to user-facing copy).

### Logging

Every Route Handler logs one structured line per request:

```json
{
  "route": "/api/leads",
  "status": 200,
  "duration_ms": 142,
  "ip_hash": "...",
  "turnstile": "ok",
  "ratelimit": "ok",
  "segment": "education",
  "source": "form"
}
```

IP is **hashed** (not stored raw) for analytics + abuse triage.

### Error reporting

All thrown errors propagate to Sentry with the request's `route`, `status`,
and `segment` (when known) attached as tags.
