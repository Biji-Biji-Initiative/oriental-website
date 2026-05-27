# 06 — API Contracts

Every public Route Handler exposed by the production app. Source code and
`lib/schemas.ts` are authoritative; update this doc in the same PR whenever a
request or response shape changes.

All routes run in the **Node.js runtime** on Coolify and return `Cache-Control:
no-store`.

```ts
type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string; details?: unknown };
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
  | "ai"
  | "cultural"
  | "community"
  | "other";

type LeadForm = {
  name: string;    // trim, 2..120
  email: string;   // trim, email, max 180
  org: string;     // trim, 2..180
  message: string; // trim, 8..2500
};
```

Turnstile is verified server-side for every intake POST. In local development,
when `TURNSTILE_SECRET_KEY` is absent, loopback hosts can use the
`local-dev` token emitted by `useTurnstile()`.

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
    email: { ok: boolean; transport?: "smtp" | "sesv2"; skipped?: boolean; reason?: string; error?: string };
    slack: { ok: boolean; skipped?: boolean; reason?: string; error?: string };
  };
};
```

`persisted: false` is possible in local development when Convex is not
configured. Production `pnpm check-secrets` requires Convex secrets.

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 429 | `rate_limited` | More than 12 lead attempts per IP per hour. |
| 500 | `routing_unconfigured` | Production owner email missing for the resolved segment. |

### Side Effects

1. `routeLead()` resolves owner metadata from `lib/segments.ts` and `OWNER_*`.
2. `persistLead()` inserts into Convex `leads` and `leadEvents` when configured.
3. Owner notification is attempted through SMTP when SMTP env exists, otherwise
   SESv2 when `AWS_REGION` is set.
4. Slack notification is attempted when `SLACK_WEBHOOK_URL` exists.

Notification failures are represented in the `notifications` object and do not
turn a successfully accepted lead into an error response.

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
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 429 | `rate_limited` | More than 20 newsletter attempts per IP per hour. |

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
    message: "Keep me posted about Oriental Building."
  },
  transcript: []
}
```

No owner email or Slack notification is sent for newsletter-only leads.

## `POST /api/voice/session`

Purpose: mint a short-lived OpenAI Realtime client secret so the browser can
open a WebRTC session without receiving `OPENAI_API_KEY`.

### Request

```ts
type VoiceSessionRequest = {
  turnstileToken?: string;
  intent?: Segment;
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
  voice: string; // default "marin"
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 429 | `voice_limit_reached` | More than 3 minted sessions per IP per day. |
| 503 | `openai_unconfigured` | `OPENAI_API_KEY` missing. |
| 502 | `openai_<status>` | OpenAI client-secret request failed. |
| 502 | `openai_invalid_secret` | OpenAI response did not contain a usable secret. |

Invalid payloads and failed Turnstile checks do **not** spend the strict
3-per-day voice session quota. The quota is checked after Turnstile and before
the OpenAI client-secret request.

### OpenAI Realtime Contract

Server request:

- `POST https://api.openai.com/v1/realtime/client_secrets`
- `session.type = "realtime"`
- `session.model = OPENAI_REALTIME_MODEL ?? "gpt-realtime-2"`
- `session.output_modalities = ["audio"]`
- `session.audio.input.turn_detection` from `VOICE_SESSION_DEFAULTS`
- `session.audio.input.transcription.model = "whisper-1"`
- `session.audio.output.voice = OPENAI_REALTIME_VOICE ?? "marin"`
- tools from `VOICE_TOOLS`, including `wait_for_user`

Browser WebRTC exchange:

- `POST https://api.openai.com/v1/realtime/calls`
- `Authorization: Bearer <client_secret.value>`
- body is SDP offer, response body is SDP answer

Client-enforced caps live in `VOICE_SESSION_DEFAULTS`:

- idle timeout: 45 seconds
- max voice duration: 180 seconds

## `GET /api/health`

Purpose: Coolify/container health check.

### Response `200`

```json
{ "ok": true, "service": "oriental-website", "ts": "2026-05-27T00:00:00.000Z" }
```

The route does not ping Convex or OpenAI. It proves the Next server can respond.

## Cross-Cutting Concerns

### Rate Limiting

Current runtime uses an in-memory per-process helper in `lib/server/security.ts`.
This is sufficient for a single Coolify instance. Before horizontal scaling,
replace it with Redis/KV or another shared limiter.

| Route | Current limit |
|---|---|
| `/api/leads` | 12 / hour / IP |
| `/api/newsletter` | 20 / hour / IP |
| `/api/voice/session` | 3 minted sessions / day / IP |

429 responses currently do not include `Retry-After`.

### CORS

All routes are same-origin only. No CORS headers are emitted.

### Observability

Current observability is application return values plus Coolify/container logs.
Sentry, Prometheus counters, structured request logs, and PagerDuty alerts are
future work unless a later PR adds them.
