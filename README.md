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

Staging is live at `https://staging.oriental.mereka.io` on the Coolify app host. Its container currently reuses the production image and a host-local env copy with staging metadata overrides; the Infisical `staging` environment for `/deploy/oriental-website` is intentionally not documented as authoritative until separate staging secrets are populated.

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
OPENAI_REALTIME_VOICE=coral
OPENAI_REALTIME_SPEED=1.28
VOICE_RUNTIME_PROFILE=baseline # rollback-safe default; instant-v1 enables adaptive semantic VAD
VOICE_MAX_DURATION_MS=600000
VOICE_IDLE_TIMEOUT_MS=20000
VOICE_IDLE_GOODBYE_GRACE_MS=6000
REDIS_URL=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
IP_HASH_SECRET=
ADMIN_REVIEW_TOKEN=
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
OWNER_AI=
OWNER_CULTURAL=
OWNER_COMMUNITY=
OWNER_OTHER=
```

## Voice Tuning

The primary voice profile lives in `lib/voice/profile.ts`. Edit `VOICE_PROFILE` when you want to change the agent identity, tone, conversation flow, required capture fields, guardrails, VAD defaults, truncation, or Realtime tool descriptions. The generated prompt follows the OpenAI Realtime 2 sections for role, tone, reasoning, channels, preambles, tools, unclear audio, entity capture, routing, long-context behavior, escalation, and guardrails.

Voice rendering is controlled by environment as well as prompt. `OPENAI_REALTIME_VOICE` must be one of the supported Realtime built-in voices, and `OPENAI_REALTIME_SPEED` is clamped to OpenAI's supported `0.25` to `1.5` range. Source fallback is `marin` at `1.18`; production is currently configured to `coral` at `1.28` so Reka speaks faster and more brightly. Human listening QA still decides whether this is Malaysian enough. Input transcription defaults to `gpt-4o-transcribe` and can be switched (for example to `gpt-realtime-whisper`) with the optional `OPENAI_REALTIME_TRANSCRIPTION_MODEL` variable without a code change.

Server route handlers emit structured JSON logs with `service`, `version`, `event`, `requestId`, hashed IP metadata, durations, rate-limit store, and notification results. Use Coolify logs plus `pnpm voice:debug` locally when reviewing failed voice conversations.

Segment-specific routing and opener copy live in `lib/segments.ts`. Realtime event handling is isolated in `lib/voice/realtime-events.ts`, outbound client event serialization is in `lib/voice/client-events.ts`, and browser microphone/WebRTC lifetime is in `components/voice-agent/useRealtimeVoiceSession.ts`. Behavior changes should get focused tests in `tests/realtime-events.test.ts`, `tests/realtime-client-events.test.ts`, or `tests/openai-realtime.test.ts` before deployment.

During local testing, run `pnpm voice:debug` after a call to inspect the latest captured fields, full transcript, token usage, and Realtime errors from `/api/voice/debug`.

## Admin Review & Observability

The internal review surface lives at `/admin/session-review`. It is protected by `ADMIN_REVIEW_TOKEN`, sets a signed HTTP-only admin cookie, and reads recent Convex `leads` plus `voiceSessions` snapshots. Use it to review failed voice conversations, captured-field drift, notification status, Realtime usage, and error/rate-limit signals.

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
