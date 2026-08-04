# Oriental Website

> **Coding agents:** start at [`AGENTS.md`](./AGENTS.md) — canonical repo map, conventions, and guardrails. Included in-session via `CLAUDE.md`.

Next.js 16 microsite for the Oriental Building partner-intake launch. The site translates the prototype handoff into a production app with React 19, Tailwind CSS 4, shadcn/ui, Convex lead storage, SES/Slack notifications, and an OpenAI Realtime voice intake flow using `gpt-realtime-2`.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4 and shadcn/ui primitives
- Convex for lead and lead-event persistence
- OpenAI Realtime client-secret minting via `/api/voice/session`
- Optional Cloudflare Turnstile enforcement for form/newsletter posts, Redis-backed rate limiting with memory fallback, SES/SMTP, and Slack Web API notifications
- Sentry error tracking, Slack ops alerts, and a token-gated internal session review dashboard
- Docker standalone runtime for Coolify (`oriental.mereka.io`; staging at `staging.oriental.mereka.io`)

## Development

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`.

For public local testing through ngrok, keep `pnpm dev` running in one terminal and run this in another:

```bash
pnpm local:ngrok -- --port 3000
```

The helper authenticates with Infisical Universal Auth, reads ngrok credentials from `/deploy/oriental-website` with project-wide fallback, and prints the `ngrok_url` without writing the token into the local ngrok config. Use `pnpm local:ngrok -- --check` to verify secret lookup without opening a tunnel.

## Environment

Copy `.env.local.example` to `.env.local` for local work. The Convex URL is non-secret and already points at the provisioned production deployment. Server-only secrets must be supplied through Infisical/Coolify for production.

The production app-scoped Infisical folder is `/deploy/oriental-website` in project `6bfac905-9bb1-449e-8be8-f25f9634802b`. It mirrors the Coolify runtime variable names below so env syncs do not need ad hoc `ORIENTAL_*` remapping.

Staging is live at `https://staging.oriental.mereka.io` on the Coolify app host. The Infisical `staging`
environment at `/deploy/oriental-website` is populated and authoritative for its runtime contract. Staging uses a
dedicated image build so staging-only client flags can differ safely, but Convex, notifications, Redis, and OpenAI
still use shared upstream accounts; environment attribution and Redis key namespacing prevent evidence and limiter
collisions while dedicated staging services remain a separate infrastructure migration.

The Mereka particle M and animated page-entrance loader are the approved public
identity on both canonical public hosts. Compact voice affordances reuse the
same approved mark geometry; WebGL failure falls back to that mark.
`scripts/deploy-coolify-host.sh --target staging --expected-current-sha <current-sha> <candidate-sha>`
builds with `NEXT_PUBLIC_BRAND_MOTION_ENABLED=true` for both canonical public
targets. The UI still checks canonical staging, production, and local hostnames
before enabling the treatment, and `false` is reserved for emergency rollback.

Required production variables:

```dotenv
NEXT_PUBLIC_CONVEX_URL=
CONVEX_URL=
CONVEX_INGEST_SECRET=
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_MODEL_CANDIDATE=gpt-realtime-2.1
VOICE_MODEL_CELL=control # candidate is an explicit measured release cell
VOICE_REASONING_CELL=low # minimal is the independent reasoning cell
VOICE_EMAIL_CAPTURE_MODE=adaptive # strict restores exact readback + explicit confirmation
OPENAI_REALTIME_VOICE=coral
OPENAI_REALTIME_SPEED=1.28
VOICE_RUNTIME_PROFILE=baseline # rollback-safe default; instant-v1 enables adaptive semantic VAD
VOICE_SESSION_DAILY_LIMIT=80 # governed integer from 1 to 10000
VOICE_MAX_DURATION_MS=600000
VOICE_IDLE_TIMEOUT_MS=20000
VOICE_IDLE_GOODBYE_GRACE_MS=6000
REDIS_URL=
TURNSTILE_ENFORCEMENT=relaxed # required only with a deliberately enabled client challenge
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
IP_HASH_SECRET=
ADMIN_REVIEW_TOKEN=
ADMIN_REVIEW_PASSWORD_HMAC=
ADMIN_REVIEW_ROLE=operator
ADMIN_REVIEW_ACTOR=Oriental intake operator
OPS_AUTOMATION_TOKEN=
PRIVACY_ADMIN_TOKEN=
COOLIFY_ORIENTAL_APPLICATION_UUID=mtrl2z6a7zvoyevxvufpntij
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=biji-biji-non-profits
SENTRY_PROJECT=oriental-website
# Optional CI/build-only source-map upload; do not require it as Coolify runtime env.
SENTRY_AUTH_TOKEN=
SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_FROM_ADDRESS=
SES_REPLY_TO=
# Optional shared team copy for full lead owner emails.
TEAM_NOTIFICATION_EMAIL=
TEAM_NOTIFICATION_CC_EMAILS=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SLACK_BOT_TOKEN=
SLACK_CHANNEL_ID=C01AVSGACFN
OPS_ALERT_SLACK_CHANNEL_ID=C01AVSGACFN
SLACK_WEBHOOK_URL=
OPS_ALERT_SLACK_WEBHOOK_URL=
CLICKUP_API_TOKEN=
CLICKUP_LIST_ID=
OWNER_TENANCY=
OWNER_EDUCATION=
OWNER_PROGRAMME=
OWNER_TECHNOLOGY=
OWNER_COMMUNITY=
OWNER_OTHER=
```

## Voice Tuning

The permanent Realtime reflex prompt and tool contract live in
`lib/voice/profile.ts`. Detailed Oriental facts stay behind the bounded,
read-only `lookup_oriental` tool in `lib/voice/knowledge.ts`; reversible fields
use one `capture_fields` batch per turn, retaining independently valid fields
and returning rejected fields for focused retry. Routing and call termination
remain separate irreversible tools. Keep prompt, endpointing, model, reasoning, and voice
changes independently attributable.

Endpointing experiments use `VOICE_RUNTIME_PROFILE=baseline|instant-v1`.
Model and reasoning experiments use `VOICE_MODEL_CELL=control|candidate` and
`VOICE_REASONING_CELL=low|minimal`. Safe deployment defaults are
`baseline` / `control` / `low`, with grounded adaptive email capture. The
`strict` capture value is the instant rollback to exact readback and explicit
confirmation. `instant-v1` and candidate cells must remain off
until the evaluation gate has qualifying audible-latency, false-endpoint,
barge-in, and contact-correction evidence.

Only one experiment dimension may differ from control in a deployment. The
voice-variant picker is QA-only, defaults off, and must stay off during runtime,
model, or reasoning trials. The primary activation outcome is useful voice
start within two seconds, measured from the initiating tap to independently
detected remote audio. Its evaluator denominator covers reviewed post-mint
attempts, including reconnect attempts, but excludes client-secret mint
failures; it is therefore not the full-funnel product availability rate.
Tap-to-live alone is not a product-success claim.

Browser tool telemetry retains bounded, PII-free samples for tool name,
response-created-to-call, execution/result dispatch, and outcome. Lead
persistence and owner-notification fan-out start concurrently so the final
`route_to_team` acknowledgement is bounded by the slower dependency instead of
their sum; structured logs retain each backend operation duration.

Intake telemetry also keeps bounded entry CTA, actual submission method, and
per-field voice/form/chat/prefill/mixed provenance plus correction counters.
Those records contain no contact values. Consent-gated GA events cover opens,
voice starts, and submit outcomes for directional funnel analysis; Convex lead
and signed voice-session records remain the authoritative accepted-submission
evidence. The admin view labels two different cohorts: accepted leads and all
engaged logical voice conversations. The latter deduplicates reconnects and
surfaces pending/rejected email, corrections, clears, typed fallbacks, and
abandonment so unsuccessful capture is not hidden by survivorship bias.

The nightly retention job deletes unsubmitted voice diagnostics after 30 days,
submitted voice diagnostics and copied lead transcript content after 90 days,
and archived lead records plus workflow events after 730 days. Verified visitor
deletion requests use the dedicated privacy principal and bounded
`DELETE /api/admin/privacy` path. Addressable Slack/ClickUp mirrors are removed
first, unaddressable email/legacy copies require explicit operator confirmation,
and the API never echoes the subject email into responses, logs, or audit rows.

Capture-method provenance is a bounded client report protected by signed voice
session linkage; it is diagnostic evidence, not an independent server
observation and never qualifies a model/runtime promotion by itself.

Production currently resolves the control cell to `gpt-realtime-2`. The first
quality candidate is [`gpt-realtime-2.1`](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
which OpenAI documents as improving alphanumeric recognition, silence/noise
handling, and interruption behaviour—all directly relevant to names, email
dictation, endpointing, and barge-in. The separate
[`gpt-realtime-2.1-mini`](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
is a faster, lower-cost distilled candidate. Evaluate `2.1` against the current
control first; do not introduce mini until that single-dimension comparison is
resolved.

The latest reviewed corpus (2026-07-16) stitches the newest 100 call rows into
72 conversations, all on `baseline` / `control` / `low`: 61 legacy, 7 local,
and 4 staging conversations, with no production candidate sample. The 12
tap-to-live samples have p50 1,546 ms and p95 2,393 ms; the 11 tap-to-audible
samples have p50 2,456 ms and p95 6,659 ms, with zero useful starts inside two
seconds. It also contains 6 `realtime_busy` and 11 `webrtc_failed`
conversations. The promotion gate is therefore `insufficient_data`. This is
operational failure evidence, not proof that voice feels instant, multilingual,
or culturally authentic.

Voice rendering is controlled by environment as well as prompt. `OPENAI_REALTIME_VOICE` must be one of the supported Realtime built-in voices, and `OPENAI_REALTIME_SPEED` is clamped to OpenAI's supported `0.25` to `1.5` range. Source fallback is `marin` at `1.18`; production is currently configured to `coral` at `1.28` so Reka speaks faster and more brightly. Human listening QA still decides whether this is Malaysian enough. Input transcription defaults to `gpt-4o-transcribe` and can be switched (for example to `gpt-realtime-whisper`) with the optional `OPENAI_REALTIME_TRANSCRIPTION_MODEL` variable without a code change.

Server route handlers emit structured JSON logs with `service`, `version`,
`event`, `requestId`, hashed IP metadata, durations, rate-limit store, and
notification results. `/api/voice/session` also emits `Server-Timing` for parse,
rate-limit, OpenAI mint, and total duration. Coolify remains the live-tail
plane; the configured Sentry project retains a PII-free structured copy across
container replacements. Use the access-controlled voice-session review record
for transcript evidence and `pnpm voice:debug` locally when reviewing failed
voice conversations.

Segment-specific routing and opener copy live in `lib/segments.ts`. Realtime event handling is isolated in `lib/voice/realtime-events.ts`, outbound client event serialization is in `lib/voice/client-events.ts`, and browser microphone/WebRTC lifetime is in `components/voice-agent/useRealtimeVoiceSession.ts`. Behavior changes should get focused tests in `tests/realtime-events.test.ts`, `tests/realtime-client-events.test.ts`, or `tests/openai-realtime.test.ts` before deployment.

During local testing, run `pnpm voice:debug` after a call to inspect the latest captured fields, full transcript, token usage, and Realtime errors from `/api/voice/debug`.

## Admin Review & Observability

The internal review surface lives at `/admin/session-review`. Its same-origin,
rate-limited login accepts either the configured `ADMIN_REVIEW_TOKEN` or the
human password whose domain-separated HMAC is stored in
`ADMIN_REVIEW_PASSWORD_HMAC`. Plaintext remains absent from source, Infisical,
Coolify, and the running container, as proved by the governed configuration
release. Historical repository exposure means the password is treated as
potentially known. It is never accepted as bearer auth. A password login
receives a signed, provenance-bound, full-access admin session for thirty
minutes. It can read and operate the CRM, including lead workflow, voice
follow-up, evaluations, maintenance, and privacy actions. A strong review-token
login remains available for managed bearer/API access and receives the
configured interactive role for twelve hours.
`ADMIN_REVIEW_TOKEN` remains the high-entropy bearer credential and the only
session-signing key; rotate the password HMAC whenever that token rotates. The
HTTP-only cookie signs the actor, role, login method, and expiry. Its default
Overview is the executive command layer: full-dataset enquiry, assignment, SLA,
delivery, and qualification KPIs; a ranked next-action queue; stage and
data-readiness health; account, repeat-contact, source, routing, and Reka quality
intelligence. Open Enquiries for the complete Tailwind CRM table, organization
portfolio, owner workload, exact ClickUp task, and workflow updates. Reka and
Voice QA retain the evaluation register, recovery queue, transcripts, timing,
and runtime evidence.

Scheduled eval, SLA, and retention jobs use the separate bearer-only
`OPS_AUTOMATION_TOKEN`; privacy deletion uses the bearer-only
`PRIVACY_ADMIN_TOKEN`. These machine credentials cannot open the dashboard or
mutate leads. Cookie-authenticated admin mutations require same-origin JSON
requests.

The command layer is read-only and derived at request time. It does not merge,
delete, or rewrite enquiry documents, and it renders unavailable denominators as
`--` rather than inventing zero performance.

ClickUp task references can be recovered without recreating tasks or changing
lead payloads:

```bash
pnpm backfill:clickup -- --dry
pnpm backfill:clickup -- --apply
pnpm backfill:clickup -- --reconcile-existing
```

The reconciliation is idempotent: it adds the confirmed ClickUp task ID/URL and
an append-only audit event. It does not rewrite contact data, briefs,
transcripts, workflow state, or original timestamps.

Production Realtime sessions receive signed review credentials from `/api/voice/session`; the browser posts snapshots to `/api/voice/debug`, which persists verified snapshots to Convex. `GET /api/voice/debug` remains local-development only.

Sentry is configured through `@sentry/nextjs` with server, edge, and client config files. Production env uses the `oriental-website` Sentry project. Operational alerts for persistence, notification, OpenAI, and Redis limiter fallback failures go to Slack via `OPS_ALERT_SLACK_CHANNEL_ID` (currently `#tech-team-test`).

## Convex

Production deployment:

```text
https://wary-hornet-265.eu-west-1.convex.cloud
```

Deploy functions with a scoped Convex deploy key:

```bash
CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
```

Regenerated bindings live under `convex/_generated` and should remain committed.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3011 pnpm test:e2e
```

For standalone proof after `pnpm build`:

```bash
mkdir -p .next/standalone/.next/static
cp -R .next/static/. .next/standalone/.next/static/
rm -rf .next/standalone/public
cp -R public .next/standalone/public
HOSTNAME=127.0.0.1 PORT=3011 node .next/standalone/server.js
```
