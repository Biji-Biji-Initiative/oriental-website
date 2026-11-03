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
  entryPoint?: VoiceEntryPoint; // fixed CTA enum; never page text or URL
  entryMethod?: "voice_button" | "form" | "email_capture" | "unknown"; // how intake opened
  submissionMethod?: "voice_command" | "handoff_button";
  fieldProvenance?: Record<LeadField, {
    method: "voice" | "form" | "chat" | "prefill" | "mixed" | "unknown";
    lastInput?: "voice" | "form" | "chat" | "prefill";
    editCount: number;       // 0..100
    correctionCount: number; // 0..100
    clearCount: number;      // 0..100
  }>;
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
  voiceRuntimeProfile?: "baseline" | "instant-v1";
  voiceInputPolicy?: "baseline" | "fast" | "patient";
  voiceEmailVerified?: boolean; // MUST be true for source="voice"
  voiceEmailVerificationSource?: "prefill" | "speech" | "typed";
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
they are attempted even when Convex is down. Persistence and notification
fan-out start concurrently so the voice routing acknowledgement is not their
sum. The route only returns
`502 persistence_failed` when persistence **and** every notification channel
fail. Production persistence failures always page ops, including in the
degraded-success case.

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 403 | `turnstile_failed` | Cloudflare verify rejected the token. |
| 403 | `voice_review_invalid` | A `voice_command` submission did not carry valid signed review credentials. Turnstile cannot substitute for this voice trust boundary. |
| 409 | `voice_email_unconfirmed` | Voice source did not provide a currently verified email marker (grounded adaptive capture, strict confirmation, typed edit, or prefill). |
| 429 | `rate_limited` | More than 12 lead attempts per IP per hour. |
| 500 | `routing_unconfigured` | Production owner email missing for the resolved segment. |
| 502 | `persistence_failed` | Production Convex persistence failed and no notification channel delivered the lead. |
| 502 | `notification_failed` | Production lead persisted, but no owner notification channel delivered. |

### Side Effects

1. `routeLead()` resolves owner metadata from `lib/segments.ts` and `OWNER_*`.
2. `persistLead()` inserts into Convex `leads` and `leadEvents` when configured.
3. Owner notification is attempted through SMTP when SMTP env exists, otherwise
   SESv2 when `AWS_REGION` is set. SMTP sends one message to all recipients in
   a single transaction. Owner email includes the lead id, source, segment,
   routed owner, contact fields, brief, and recent transcript context. A shared
   team copy is sent only when `TEAM_NOTIFICATION_EMAIL`, `TEAM_NOTIFICATION_EMAILS`,
   `TEAM_NOTIFICATION_CC_EMAILS`, or `TEAM_INBOX_EMAIL` is explicitly configured.
4. Slack notification is attempted through `SLACK_BOT_TOKEN` +
   `SLACK_CHANNEL_ID` first, with `SLACK_WEBHOOK_URL` as a fallback. Slack
   blocks include the same routing/contact fields plus a brief and transcript
   excerpt.
5. ClickUp notification is attempted through `CLICKUP_API_TOKEN` plus
   `CLICKUP_LIST_ID` / `CLICKUP_LIST_URL` when configured. It creates one task
   with routing, contact, brief, and transcript context. A successful response
   persists the provider task ID and direct URL on the lead so the admin CRM can
   open the exact record.
6. Submitter confirmation email is attempted separately and is included in the
   response and persisted notification summary. Production lead success still
   depends on owner email, Slack, or ClickUp delivery, not on submitter
   confirmation alone.

The email verification marker and signed review token are request-boundary
evidence; both are stripped before lead persistence. PII-free capture mode,
source, confidence, status, and current-value match remain in the signed
voice-session review snapshot for QA.

`entryPoint`, `entryMethod`, `submissionMethod`, and `fieldProvenance` are persisted for
aggregate product analysis. They contain fixed categories and counters only—no
contact values, transcript text, URLs, visitor IDs, or raw timestamps. Legacy
clients may omit them.

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
  model: string; // default "gpt-realtime-2.1"
  model_cell: "control" | "candidate";
  reasoning_cell: "low" | "minimal";
  email_capture_mode: "strict" | "adaptive";
  voice: string; // source fallback "marin"; production currently "coral"; a selected variant overrides this
  speed: number; // source fallback and production 1.18; clamped to OpenAI's 0.25..1.5 range
  variant: string | null; // resolved voice variant id, or null when none selected
  runtime_profile: "baseline" | "instant-v1";
  input_policy: "baseline" | "fast" | "patient";

  transcription_model: string; // default "gpt-4o-transcribe" via OPENAI_REALTIME_TRANSCRIPTION_MODEL
  noise_reduction: "near_field" | "far_field"; // near_field for mobile user agents, far_field otherwise
  limits: {
    max_duration_ms: number;
    idle_timeout_ms: number;
    idle_goodbye_grace_ms: number;
  }; // typed, bounded policy; defaults 600000 / 20000 / 6000
  review: { id: string; token: string }; // signed credentials for /api/voice/debug snapshots
};
```

### Errors

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed. |
| 429 | `voice_limit_reached` | More than `VOICE_SESSION_DAILY_LIMIT` (default 80) minted sessions per IP per day. Page load imports the voice bundle and preconnects; Realtime pre-minting happens only while microphone permission is currently granted, or after the visitor grants a first-use/expired-one-time prompt. |
| 503 | `openai_unconfigured` | `OPENAI_API_KEY` missing. |
| 502 | `openai_<status>` | OpenAI client-secret request failed. |
| 502 | `openai_invalid_secret` | OpenAI response did not contain a usable secret. |

Invalid payloads do **not** spend the voice session quota. The quota is checked
before the OpenAI client-secret request.

### OpenAI Realtime Contract

Server request:

- `POST https://api.openai.com/v1/realtime/client_secrets`
- `session.type = "realtime"`
- `session.model = OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1"`
- model-cell and reasoning combinations are independent controlled cells;
  defaults remain `VOICE_MODEL_CELL=control` and `VOICE_REASONING_CELL=low`
- governed staging and production use `VOICE_EMAIL_CAPTURE_MODE=adaptive`;
  `strict` is the exact-readback/explicit-confirmation rollback
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
- production Infisical/Coolify sets `OPENAI_REALTIME_VOICE=coral` and
  `OPENAI_REALTIME_SPEED=1.18`
- compact prompt under 7 KB and tools from `VOICE_TOOLS`, including partial-safe
  batched `capture_fields`, read-only `lookup_oriental`, and `wait_for_user`

Successful and error responses include `Server-Timing` entries for the stages
that ran: `parse`, `rate_limit`, `openai_mint`, and `total`. These are server
route timings, not WebRTC or audible response latency.

Browser WebRTC exchange:

- `POST https://api.openai.com/v1/realtime/calls`
- `Authorization: Bearer <client_secret.value>`
- body is SDP offer, response body is SDP answer

Client-enforced caps come from the session response `limits` (env-tunable via
`VOICE_MAX_DURATION_MS` / `VOICE_IDLE_TIMEOUT_MS`), falling back to
`VOICE_SESSION_DEFAULTS`:

- max duration: 10 minutes by default
- idle timeout: 20 seconds by default, with a 6-second goodbye grace window
  (`idle_goodbye_grace_ms`) in which Reka wraps up before teardown

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
    connectionStatus: "idle" | "requesting_mic" | "connecting" | "reconnecting" | "listening";
    deviceProfile?: "mobile" | "desktop";
    deploymentEnvironment?: "local" | "staging" | "production";
    activationAttempted?: boolean;
    entryPoint?: VoiceEntryPoint;
    entryMethod?: "voice_button" | "form" | "email_capture" | "unknown";
    submissionMethod?: "voice_command" | "handoff_button";
    fieldProvenance?: FieldProvenanceSummary;
    model?: string;
    voice?: string;
    speed?: number;
    emailCaptureMode?: "strict" | "adaptive";
    emailVerification?: {
      source: "prefill" | "speech" | "typed";
      status: "confirmed" | "pending";
      confidence?: "high" | "medium";
      matchesCaptured: boolean;
    };
    captured: { name: string; email: string; org: string; phone: string; website: string; message: string };
    transcript: Array<{ role: "user" | "assistant" | "system"; text: string }>;
    usage?: RealtimeUsageSummary;
    errors: Array<{ eventId?: string; message: string; code?: string }>;
    rateLimits: Array<Record<string, unknown>>;
    latency?: {
      version: 1;
      activation?: { tapToArmCueScheduledMs?: number; tapToLiveMs?: number; tapToAudibleMs?: number };
      turns: VoiceTurnLatencySample[];
      toolCalls?: Array<{
        sequence?: number;
        name: string; // bounded tool-name enum; never arguments or captured values
        outcome: "success" | "rejected" | "failed" | "dispatch_failed";
        executionMs: number;
        responseCreatedToCallMs?: number;
        responseCreatedToResultMs?: number;
      }>;
    };
    transport?: {
      realtimeBusyRetryCount?: number;
      disconnectCount: number;
      recoveryCount: number;
      iceRestartCount: number;
      remoteTrackReceivedAt?: number;
    };
    routeRequested: boolean;
    submittedAt?: number;
  };
};
```

Production errors:

- `400 invalid_payload`
- `401 unauthorized`

### `POST /api/admin/login`

Accepts only a same-origin JSON request and rate-limits attempts by trusted
proxy identity. It validates either `ADMIN_REVIEW_TOKEN` or the human password
represented by the domain-separated `ADMIN_REVIEW_PASSWORD_HMAC`, then sets a
principal-bound signed `oriental_admin` HTTP-only, SameSite=Lax cookie with
`Path=/`. A password login signs `method=password`, forces role `admin`, and
expires after thirty minutes. It can access and operate the complete CRM,
including workflow, voice follow-up, evaluation, maintenance, and privacy
actions. A strong review-token login signs
`method=review`, retains the configured interactive role, and expires after
twelve hours. The human password is never accepted as bearer auth and never
signs sessions; historical repository exposure means it is treated as
potentially known. Production cookies also set `Secure`. Successful login
telemetry records only bounded actor, method, role, and expiry metadata, never
the supplied credential.

### `GET /api/admin/review`

Review-token bearer, review-session cookie, or password-session cookie protected
JSON endpoint returning recent `leads`, `voiceSessions`, `leadEvents`,
aggregate metrics, analytics buckets, and queue slices for the internal
operations console. Password-issued admin sessions can also call the
state-changing routes when cookie requests satisfy same-origin JSON checks.

### `PATCH /api/admin/leads/[leadId]`

Interactive bearer-token or admin-cookie protected mutation for operator
triage. Cookie-authenticated state changes require `Content-Type:
application/json` and an `Origin` exactly matching the request origin. Updates the
Convex lead workflow fields and appends a `workflow_update` event to
`leadEvents`.

```ts
type AdminLeadWorkflowRequest = {
  status: "new" | "reviewing" | "contacted" | "qualified";
  priority: "low" | "normal" | "high" | "urgent";
  owner?: string; // trim, max 80
  note?: string; // trim, max 600
  nextActionAt: number | null;
  nextActionNote?: string; // trim, max 500
  outcomeReason?: string; // required for qualified
  expectedRevision: number;
  reason: string; // trim, 3-300; audit reason
};

type AdminLeadWorkflowResponse = {
  ok: true;
  changed: boolean;
  revision: number;
};
```

Errors:

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` | Zod validation failed, including any request for `archived` status. |
| 400 | `archive_boundary` | The canonical lead is archived; restore it through the archive endpoint before editing. |
| 401 | `missing` / `invalid` | Missing or invalid admin bearer/cookie auth. |
| 403 | `forbidden` / `csrf` | The principal lacks update permission, or a cookie mutation failed the same-origin JSON boundary. |
| 404 | `not_found` | No Convex lead matched the route `leadId`. |
| 409 | `conflict` | The submitted workflow revision is stale; no fields were overwritten. |
| 503 | `unconfigured` | `ADMIN_REVIEW_TOKEN` is missing. |
| 503 | `convex_unconfigured` / `convex_failed` | Convex env is missing or the mutation failed. |

### `POST /api/admin/leads/bulk`

Applies one owner and dated next action to 1-50 active leads. The request carries
the expected revision for every lead. Convex validates every target before
writing; a missing, terminal, invalid, or stale target rejects the entire batch.

### `POST /api/admin/leads/archive`

Archives or restores 1-50 leads as one revision-checked Convex mutation.

```ts
type AdminLeadArchiveRequest = {
  action: "archive" | "restore";
  leads: Array<{ leadId: string; expectedRevision: number }>;
  reason: string; // trim, 3-300
};

type AdminLeadArchiveResponse = {
  ok: true;
  action: "archive" | "restore";
  count: number;
};
```

Archive is a reversible workflow state, never a physical delete. Archive and
restore transitions are exclusive to this endpoint: the ordinary workflow PATCH
rejects both active-to-archived and archived-to-active changes. The canonical
lead retains contact data, request, transcript, notification outcomes, ClickUp
references, evaluations, and every prior event. Convex stores archive actor,
timestamp, reason, and prior status. Restore returns to the recorded prior
status (or the new inbox state for legacy archived rows), increments the
workflow revision, retains archive provenance, and appends a restore event.

Errors:

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_payload` / `invalid_state` | Invalid payload, duplicate IDs, or action does not match current state. |
| 401 | `missing` / `invalid` | Missing or invalid admin bearer/cookie auth. |
| 403 | `forbidden` | The authenticated admin role lacks archive permission. |
| 404 | `not_found` | At least one target lead does not exist; none were changed. |
| 409 | `conflict` | At least one revision is stale; none were changed. |
| 503 | `convex_unconfigured` / `convex_failed` | Convex env is missing or the mutation failed. |

### `GET|PATCH /api/admin/voice-sessions/[reviewId]`

`GET` requires `voice.read` and is available to password admin sessions for
transcript and voice-session detail. `PATCH` requires `voice.follow_up`; a
same-origin password-session or review-session cookie, or interactive
review-token bearer, can mark a recoverable voice session
as followed up (or moves it back to the queue), setting or clearing
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

### `POST /api/admin/evals`

Interactive bearer/admin-cookie or `OPS_AUTOMATION_TOKEN` protected action
(permission `evals.run`) that scores persisted customer voice sessions with the LLM judge
rubric from `lib/eval/voice-eval.ts` and persists the results via the
`recordVoiceEvals` Convex mutation — the on-demand equivalent of
`pnpm eval:voice -- --persist`. Synthetic smoke rows are excluded and
dropped-and-resumed calls are stitched into one conversation before judging.
The synchronous batch is hard-capped at 12 conversations per request. Every run
scans the latest bounded 200-row Convex window before selecting unscored work,
so recently evaluated rows cannot starve older sessions. Judge models are
allowlisted, provider calls use a 30-second timeout with at most one retry, and
all calls share a 60-second judge budget inside a 90-second whole-run deadline.
The Redis-backed production limiter leases the run slot for five minutes, which
is longer than the hard deadline and therefore prevents overlapping spend.
Untargeted batches skip sessions already scored by the selected model; explicit
`reviewIds` remain the deliberate rescore path.

```ts
type AdminEvalsRequest = {
  model?: string; // judge model id; defaults to EVAL_JUDGE_MODEL (fallback gpt-4o-mini)
  limit?: number; // 1–12, default 6
  reviewIds?: string[]; // target specific sessions (max 20); targeted runs re-judge
  force?: boolean; // re-judge already-evaluated conversations in untargeted runs
};

type AdminEvalsResponse = {
  ok: true;
  model: string;
  fetched: number; // customer sessions in the window
  conversations: number; // after stitching call segments
  alreadyEvaluated: number; // judgeable conversations skipped because they have scores
  judged: number;
  persisted: number;
  failures: number; // judged but unscorable (judge error/parse failure)
  failureCategories: Record<string, number>; // aggregate provider/parse categories; no per-session identifiers
  failureSamples: string[]; // bounded failure-category names only; never provider messages or session identifiers
};

Sessions are also scored automatically when a call closes with transcript
turns (`EVAL_AUTO_ON_CLOSE`, default on): the voice debug route schedules a
targeted run after responding, so resumed/cut-off conversations re-score as a
whole thread. Non-ok outcomes log `admin_evals.not_run` /
`voice_review.auto_eval_skipped`.
```

Errors:

| HTTP | `error` | Cause |
|---|---|---|
| 400 | `invalid_request` / `invalid_model` | Zod validation failed or the requested model is not allowlisted. |
| 429 | `rate_limited` | An evaluation run already started in the five-minute safety window. |
| 401/403 | `missing` / `invalid` / `forbidden` | Auth failed or the role lacks `evals.run`. |
| 404 | `no_sessions` | No judgeable customer sessions in the window (or targets not found). |
| 502 | `convex_failed` | Convex query/mutation failed mid-run. |
| 504 | `deadline_exceeded` | The bounded whole-run deadline elapsed. |
| 503 | `unconfigured` / `invalid_model` | Required env is missing or `EVAL_JUDGE_MODEL` is not allowlisted. |

### `POST /api/admin/sla-check`

Bearer-only sweep using the distinct `OPS_AUTOMATION_TOKEN` permission
`ops.sla_check`, meant for an hourly cron (`.github/workflows/analytics-ops.yml`).
The route can post to the ops Slack channel. The password admin session can run
it through a same-origin JSON request; scheduled execution still uses the
dedicated bearer. A Convex query reads oldest-first through active-status,
unowned-owner, and failed-notification indexes rather than reusing the recent
dashboard window. It returns aggregate counts only—no lead IDs, contact fields,
or transcript content—and posts one throttled ops Slack alert when breached.

```ts
type AdminSlaCheckRequest = { maxUnownedHours?: number }; // 1-72, default 4

type AdminSlaCheckResponse = {
  ok: true;
  unownedBreaches: number;
  failedNotifications: number;
  activeLeads: number;
  truncated: {
    unownedBreaches: boolean;
    failedNotifications: boolean;
    activeLeads: boolean;
  };
  alerted: boolean; // false when clear, throttled, or Slack unconfigured
};
```

Each indexed status/owner bucket is bounded to 250 rows plus one overflow
sentinel. When a `truncated` flag is true, the corresponding numeric count is an
explicit lower bound; Slack copy includes a `+` suffix and lower-bound metadata.
Because breach reads are oldest-first, the oldest known breach is retained for
age/severity reporting even when a bucket exceeds the safety cap.

Errors mirror the other admin routes (`400 invalid_request`, `401/403`, `503 convex_failed`).

### `POST /api/admin/retention`

Bearer-only maintenance action using the distinct `OPS_AUTOMATION_TOKEN`
permission `ops.retention`. It applies fixed code-owned windows—30 days for
unsubmitted voice diagnostics and retained application-log records, 90 days for
submitted voice diagnostics and transcript content copied onto submitted leads,
then 730 days after archival for the remaining lead record plus workflow events.
Callers cannot weaken or override these windows. Each call is write-bounded and
returns PII-free aggregate counts.

```ts
type AdminRetentionResponse = {
  ok: true;
  deleted: { applicationLogs: number; archivedLeads: number; leadEvents: number; voiceSessions: number };
  redacted: { leadTranscripts: number };
  hasMore: boolean;
};
```

The nightly GitHub Actions job repeats up to ten batches. A remaining backlog
fails the job rather than silently presenting an incomplete sweep as success.

### `GET /api/admin/logs?limit=100`

Full-password-session-only operational-log review using permission
`ops.logs.read`. It returns the newest 1–200 PII-free structured records from
the durable Convex ledger, ordered newest first. Automation bearer credentials,
review bearer credentials, and lower-privilege interactive sessions receive
`403`. This is a no-store diagnostic read; it cannot retrieve voice transcripts
or customer content.

### `DELETE /api/admin/privacy`

Bearer-only data-subject deletion using the distinct `PRIVACY_ADMIN_TOKEN`
(`privacy.delete`). Interactive admin cookies and review tokens cannot cross
this destructive boundary. The request must
carry the exact destructive confirmation and a UUID supplied by the operator:

```ts
type AdminPrivacyDeletionRequest = {
  email: string;
  confirmation: "DELETE";
  reason: "data_subject_request" | "consent_withdrawn" | "operator_correction";
  requestId: string; // UUID retained only in the PII-free audit event
  manualCopiesConfirmedDeleted?: boolean;
};

type AdminPrivacyDeletionResponse = {
  ok: true;
  deleted: { leads: number; leadEvents: number; voiceSessions: number };
  complete: boolean;
};
```

The route first completes bounded legacy-email normalization, then identifies
addressable Slack and ClickUp mirrors and deletes them before Convex erasure.
Previously delivered email and any unaddressable legacy mirror require the
operator to remove the copy and explicitly set `manualCopiesConfirmedDeleted`.
The API returns `409 normalization_in_progress` or `409 manual_cleanup_required`
before destructive local work, and `502 downstream_cleanup_failed` if an
addressable external deletion fails.

The response and logs never echo the email. The audit table stores only the
actor, reason code, request UUID, aggregate counts, and completion state. If
`complete` is false, investigate remaining legacy or related records; batching
prevents one subject with unusually large history from exhausting a Convex
mutation.

## `GET /api/health`

Purpose: Coolify/container health check.

### Response `200`

```ts
type HealthResponse = {
  ok: true;
  version: string; // GIT_SHA, SOURCE_COMMIT, or "local"
  uptime_s: number;
  convex: boolean; // configuration presence, not a live upstream ping
  voice: {
    runtime_profile: "baseline" | "instant-v1";
    model_cell: "control" | "candidate";
    model: string;
    reasoning_cell: "low" | "minimal";
    email_capture_mode: "strict" | "adaptive";
    variant_picker: boolean;
  };
};
```

The route does not ping Convex or OpenAI. It proves the Next server can respond
and exposes enough non-secret version/config signal for deterministic release
and takeover checks. Never add credentials, visitor data, transcripts, or
internal request metadata to this public response.

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

Every `429` response includes `Retry-After` as positive whole seconds and
`X-RateLimit-Reset` as a Unix timestamp in seconds. Client identity comes from
the proxy-owned rightmost valid `X-Forwarded-For` address, with validated
proxy metadata required on every request. The DNS-direct origin deliberately
ignores both client-supplied `CF-Connecting-IP` and `X-Real-IP` values; missing
or malformed forwarded metadata shares one fail-closed rate-limit identity.

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

Coolify provides the live container tail, but it is not the retained source of
truth. Every structured application event is also serialized to the Convex
`applicationLogs` ledger and retained for 30 days, independently of container
replacement. This retained record preserves event identity, timing, numeric and
boolean diagnostics, request correlation ids, and redacted structured metadata;
it never stores visitor text, contact details, credentials, or free-form
provider messages. The full password-backed administrative session can inspect
the latest retained records at `GET /api/admin/logs` or
`/admin/session-review?view=audit#application-logs`; automation and lower
privilege sessions cannot read them. The configured Sentry project remains an
independent PII-free summary/alert plane. Conversation text remains solely in
the access-controlled voice-session review record under its own retention
window. Prometheus counters and PagerDuty alerts are still deferred.
