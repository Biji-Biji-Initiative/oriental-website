# 06 — API Contracts

Every public Route Handler exposed by the production app. Source code and
`lib/schemas.ts` are authoritative; update this doc in the same PR whenever a
request or response shape changes.

All routes run in the **Node.js runtime** on Coolify and return `Cache-Control:
no-store`.

```ts
type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string; details?: unknown; reason?: string };
```

`error` values are stable enough for client branching. User-facing copy should
still come from the UI layer.

## Shared Validation

POST bodies are parsed with Zod schemas in `lib/schemas.ts`.

```ts
type Segment =
  | "tenancy"
  | "education"
  | "programme"
  | "technology"
  | "community"
  | "other";

type LeadForm = {
  email: string;   // trim, email, max 180 — the only required field
  name: string;    // trim, max 120 — may be empty
  org: string;     // trim, max 180 — may be empty
  phone: string;   // trim, max 60 — optional, may be empty
  website: string; // trim, max 300 — optional, may be empty
  message: string; // trim, max 2500 — may be empty
};
```

Turnstile is verified server-side for form/newsletter intake only when
`TURNSTILE_ENFORCEMENT=required`. Voice starts use the `/api/voice/session` rate
limit, and voice lead handoff proves session origin with signed review
credentials returned by the session route. In local development, when
`TURNSTILE_SECRET_KEY` is absent, loopback hosts can use the `local-dev` token.

## `POST /api/leads`

Purpose: persist a voice/form partner enquiry and notify the routed owner.

### Request

```ts
type LeadRequest = {
  source: "voice" | "form";
  segment?: Segment; // defaults to "other"
  form: LeadForm;
  transcript?: Array<{
    role?: "user" | "assistant" | "system"; // defaults to "user"
    text: string; // 1..4000
  }>;
  turnstileToken?: string;
  voiceReviewId?: string; // voice only: signed review id from /api/voice/session
  voiceReviewToken?: string; // voice only: verification token, stripped before persistence
  voiceSessionId?: string;
  voiceVariant?: string;
  voiceModel?: string;
  voiceName?: string;
  voiceSpeed?: number;
  utm?: Record<string, string>;
};
```

### Response `200`

```ts
type LeadResponse = {
  ok: true;
  id: string;
  persisted: boolean;
  notifications: {
    email: {
      ok: boolean;
      transport?: "smtp" | "sesv2";
      skipped?: boolean;
      reason?: string;
      error?: string;
      status?: number;
    };
    slack: {
      ok: boolean;
      transport?: "slack";
      skipped?: boolean;
      reason?: string;
      error?: string;
      status?: number;
    };
    confirmation: {
      ok: boolean;
      transport?: "smtp" | "sesv2";
      skipped?: boolean;
      reason?: string;
      error?: string;
      status?: number;
    };
  };
};
```

`persisted: false` is possible in local development when Convex is not
configured, and in production when Convex persistence fails but at least one
notification channel delivered the lead. Notifications are an independent
durability path: the owner email and Slack message carry the full lead, so
they are attempted even when Convex is down, and the route only returns
`502 persistence_failed` when persistence **and** every notification channel
fail. Production persistence failures always page ops, including in the
degraded-success case.

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 429 | `rate_limited` | More than 12 lead attempts per IP per hour. |
| 500 | `routing_unconfigured` | Production owner email missing for the resolved segment. |
| 502 | `persistence_failed` | Production Convex persistence failed and no notification channel delivered the lead. |
| 502 | `notification_failed` | Production lead persisted, but neither owner email nor Slack delivered. |

### Side Effects

1. `routeLead()` resolves owner metadata from `lib/segments.ts` and `OWNER_*`.
2. `persistLead()` inserts into Convex `leads` and `leadEvents` when configured.
3. Owner notification is attempted through SMTP when SMTP env exists, otherwise
   SESv2 when `AWS_REGION` is set. SMTP sends one message to all recipients in
   a single transaction. Owner email includes the lead id, source, segment,
   routed owner, contact fields, brief, and recent transcript context. A shared
   team copy is sent only when `TEAM_NOTIFICATION_EMAIL` or `TEAM_INBOX_EMAIL`
   is explicitly configured.
4. Slack notification is attempted through `SLACK_BOT_TOKEN` +
   `SLACK_CHANNEL_ID` first, with `SLACK_WEBHOOK_URL` as a fallback. Slack
   blocks include the same routing/contact fields plus a brief and transcript
   excerpt.
5. Submitter confirmation email is attempted separately and is included in the
   response and persisted notification summary. Production lead success still
   depends on owner email or Slack delivery, not on submitter confirmation alone.

In local and test environments, notification failures are represented in the
`notifications` object and do not turn a successfully accepted lead into an
error response. In production, at least one notification channel must deliver;
otherwise the route returns `502 notification_failed` with the persisted lead id
and per-channel notification results.

## `POST /api/newsletter`

Purpose: capture the hero email form as a lightweight lead.

### Request

```ts
type NewsletterRequest = {
  email: string; // trim, email, max 180
  turnstileToken?: string;
  utm?: Record<string, string>;
};
```

### Response `200`

```ts
type NewsletterResponse = {
  ok: true;
  id: string;
  persisted: boolean;
  notifications: {
    confirmation: {
      ok: boolean;
      transport?: "smtp" | "sesv2";
      skipped?: boolean;
      reason?: string;
      error?: string;
      status?: number;
    };
  };
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 429 | `rate_limited` | More than 20 newsletter attempts per IP per hour. |
| 502 | `persistence_failed` | Production Convex persistence failed; ops is alerted. |

### Side Effects

Newsletter writes use the same Convex mutation as full leads:

```ts
{
  source: "hero-email",
  segment: "other",
  form: {
    name: "Newsletter subscriber",
    email,
    org: "Unknown",
    phone: "",
    website: "",
    message: "Requested Oriental Building updates from the hero email capture."
  },
  transcript: []
}
```

No owner email or Slack notification is sent for newsletter-only leads. If email
delivery is configured, the subscriber receives newsletter-specific confirmation
copy and that status is persisted in the notification summary.

## `POST /api/voice/session`

Purpose: mint a short-lived OpenAI Realtime client secret so the browser can
open a WebRTC session without receiving `OPENAI_API_KEY`.

### Request

```ts
type VoiceSessionRequest = {
  intent?: Segment;
  variant?: string; // voice variant id; resolved server-side, unknown ids fall back to the env default
  utm?: Record<string, string>;
};
```

### Response `200`

```ts
type VoiceSessionResponse = {
  ok: true;
  client_secret: { value: string; expires_at: number };
  session_id: string;
  model: string; // default "gpt-realtime-2"
  voice: string; // source fallback "marin"; production currently "coral"; a selected variant overrides this
  speed: number; // source fallback 1.18; production currently 1.28; clamped to OpenAI's 0.25..1.5 range
  variant: string | null; // resolved voice variant id, or null when none selected

  transcription_model: string; // default "gpt-4o-transcribe" via OPENAI_REALTIME_TRANSCRIPTION_MODEL
  noise_reduction: "near_field" | "far_field"; // near_field for mobile user agents, far_field otherwise
  limits: { max_duration_ms: number; idle_timeout_ms: number }; // VOICE_MAX_DURATION_MS / VOICE_IDLE_TIMEOUT_MS, defaults 150000 / 20000
  review: { id: string; token: string }; // signed credentials for /api/voice/debug snapshots
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 429 | `voice_limit_reached` | More than `VOICE_SESSION_DAILY_LIMIT` (default 80) minted sessions per IP per day. Page load imports the voice bundle and preconnects; Realtime session pre-minting only happens for returning visitors whose browser already has microphone permission, or after first-time visitors grant microphone access. |
| 503 | `openai_unconfigured` | `OPENAI_API_KEY` missing. |
| 502 | `openai_<status>` | OpenAI client-secret request failed. |
| 502 | `openai_invalid_secret` | OpenAI response did not contain a usable secret. |

Invalid payloads do **not** spend the voice session quota. The quota is checked
before the OpenAI client-secret request.

### OpenAI Realtime Contract

Server request:

- `POST https://api.openai.com/v1/realtime/client_secrets`
- `session.type = "realtime"`
- `session.model = OPENAI_REALTIME_MODEL ?? "gpt-realtime-2"`
- `session.output_modalities = ["audio"]`
- `session.audio.input.turn_detection` from `VOICE_SESSION_DEFAULTS`
  (`semantic_vad`, `eagerness: "auto"`)
- `session.audio.input.transcription` from `VOICE_SESSION_DEFAULTS`
  (`gpt-4o-transcribe` with a multilingual domain prompt — no language lock; model overridable
  via `OPENAI_REALTIME_TRANSCRIPTION_MODEL`)
- `session.audio.input.noise_reduction.type` = `near_field` (mobile UA) or
  `far_field` (desktop)
- `session.audio.output.voice = OPENAI_REALTIME_VOICE ?? "marin"`
- `session.audio.output.speed = OPENAI_REALTIME_SPEED ?? 1.18`
- production Infisical/Coolify currently sets `OPENAI_REALTIME_VOICE=coral` and
  `OPENAI_REALTIME_SPEED=1.28`
- tools from `VOICE_TOOLS`, including `wait_for_user`

Browser WebRTC exchange:

- `POST https://api.openai.com/v1/realtime/calls`
- `Authorization: Bearer <client_secret.value>`
- body is SDP offer, response body is SDP answer

Client-enforced caps come from the session response `limits` (env-tunable via
`VOICE_MAX_DURATION_MS` / `VOICE_IDLE_TIMEOUT_MS`), falling back to
`VOICE_SESSION_DEFAULTS`:

- max duration: 150 seconds by default
- idle timeout: 20 seconds by default, with a 6-second goodbye grace window
  (`idleGoodbyeGraceMs`) in which Reka wraps up before teardown

## Voice diagnostics and review snapshots

### `GET /api/voice/debug`

Returns the latest in-memory voice debug snapshots in local development. Returns
`404 not_found` in production.

```ts
{
  ok: true;
  entries: Array<{
    id: string;
    createdAt: string;
    payload: unknown;
  }>;
}
```

### `POST /api/voice/debug`

The client dialog posts captured fields, transcript, usage, errors, status, and
connection state while the voice modal is open.

In local development, invalid signatures are accepted into the in-memory debug
buffer for fast agent review. In production, the route requires signed review
credentials returned by `POST /api/voice/session`; verified snapshots upsert the
Convex `voiceSessions` table.

```ts
type VoiceReviewSnapshotRequest = {
  review: { id: string; token: string };
  snapshot: {
    sessionId: string;
    leadId?: string | null;
    segment: SegmentId;
    status: "idle" | "submitted";
    connectionStatus: "idle" | "connecting" | "listening";
    model?: string;
    voice?: string;
    speed?: number;
    captured: { name: string; email: string; org: string; phone: string; website: string; message: string };
    transcript: Array<{ role: "user" | "assistant" | "system"; text: string }>;
    usage?: RealtimeUsageSummary;
    errors: Array<{ eventId?: string; message: string; code?: string }>;
    rateLimits: Array<Record<string, unknown>>;
    routeRequested: boolean;
    submittedAt?: number;
  };
};
```

Production errors:

- `400 invalid_payload`
- `401 unauthorized`

### `POST /api/admin/login`

Validates `ADMIN_REVIEW_TOKEN` and sets the signed `oriental_admin` HTTP-only
cookie scoped to `/admin`.

### `GET /api/admin/review`

Bearer-token or admin-cookie protected JSON endpoint returning recent `leads`,
`voiceSessions`, `leadEvents`, aggregate metrics, analytics buckets, and queue
slices for the internal operations console.

### `PATCH /api/admin/leads/[leadId]`

Bearer-token or admin-cookie protected mutation for operator triage. Updates the
Convex lead workflow fields and appends a `workflow_update` event to
`leadEvents`.

```ts
type AdminLeadWorkflowRequest = {
  status: "new" | "reviewing" | "contacted" | "qualified" | "archived";
  priority: "low" | "normal" | "high" | "urgent";
  owner?: string; // trim, max 80
  note?: string; // trim, max 600
};

type AdminLeadWorkflowResponse = { ok: true };
```

Errors:

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 401 | `missing` / `invalid` | Missing or invalid admin bearer/cookie auth. |
| 404 | `not_found` | No Convex lead matched the route `leadId`. |
| 503 | `unconfigured` | `ADMIN_REVIEW_TOKEN` is missing. |
| 503 | `convex_unconfigured` / `convex_failed` | Convex env is missing or the mutation failed. |

### `PATCH /api/admin/voice-sessions/[reviewId]`

Bearer-token or admin-cookie protected mutation that marks a recoverable voice
session as followed up (or moves it back to the queue). Sets or clears
`followedUpAt` on the Convex `voiceSessions` row.

```ts
type AdminVoiceFollowUpRequest = { followedUp: boolean };

type AdminVoiceFollowUpResponse = { ok: true };
```

Errors:

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 401 | `missing` / `invalid` | Missing or invalid admin bearer/cookie auth. |
| 404 | `not_found` | No Convex voice session matched the route `reviewId`. |
| 503 | `unconfigured` | `ADMIN_REVIEW_TOKEN` is missing. |
| 503 | `convex_unconfigured` / `convex_failed` | Convex env is missing or the mutation failed. |

## `GET /api/health`

Purpose: Coolify/container health check.

### Response `200`

```ts
type HealthResponse = {
  ok: true;
  version: string; // GIT_SHA, SOURCE_COMMIT, or "local"
  uptime_s: number;
  convex: boolean; // configuration presence, not a live upstream ping
};
```

The route does not ping Convex or OpenAI. It proves the Next server can respond
and exposes enough version/config signal for Coolify smoke checks.

## `GET /api/client-config`

Purpose: public, non-secret runtime configuration for the browser. Pages are
statically prerendered, so public feature flags can be fetched without a rebuild.

### Response `200`

```ts
type ClientConfigResponse = {
  turnstileSiteKey: string | null; // currently null; Turnstile UI is disabled on this microsite
  voiceVariantPicker: boolean;
};
```

Never add secrets to this route — everything it returns ships to every visitor.

## Cross-Cutting Concerns

### Rate Limiting

Current runtime uses `checkRateLimit()` from `lib/server/rate-limit.ts`,
re-exported by `lib/server/security.ts`. Production should be backed by
`REDIS_URL` (or `UPSTASH_REDIS_URL` / `VALKEY_URL`); the in-memory limiter is a
degraded fallback for local development or Redis outages.

| Route | Current limit |
|---|---|
| `/api/leads` | 12 / hour / IP |
| `/api/newsletter` | 20 / hour / IP |
| `/api/voice/session` | `VOICE_SESSION_DAILY_LIMIT` minted sessions / day / IP; default 80 |

429 responses currently do not include `Retry-After`.

Structured logs for rate-limited requests include `event`, `requestId`, hashed
IP metadata, `rateLimitStore`, `resetAt`, and `durationMs`. In production, a
healthy shared limiter should log `rateLimitStore: "redis"`.

### CORS

All routes are same-origin only. No CORS headers are emitted.

### Observability

Route handlers emit structured JSON logs to stdout/stderr via
`lib/server/logger.ts`. Logs include `service`, `version`, `event`, request ids,
hashed IP metadata where relevant, durations, rate-limit store, persistence
status, and notification results. Sensitive keys are redacted by suffix.

Current production review path is Coolify container logs, Sentry errors, Slack
ops alerts, API return values, and `/admin/session-review`. Prometheus counters
and PagerDuty alerts are still deferred.
