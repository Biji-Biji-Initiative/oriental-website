# Oriental Website

> **Coding agents:** start at [`AGENTS.md`](./AGENTS.md) — canonical repo map, conventions, and guardrails. Included in-session via `CLAUDE.md`.

Next.js 16 microsite for the Oriental Building partner-intake launch. The site translates the prototype handoff into a production app with React 19, Tailwind CSS 4, shadcn/ui, Convex lead storage, SES/Slack notifications, and an OpenAI Realtime voice intake flow using `gpt-realtime-2`.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS 4 and shadcn/ui primitives
- Convex for lead and lead-event persistence
- OpenAI Realtime client-secret minting via `/api/voice/session`
- Cloudflare Turnstile, in-memory rate limiting, SES, and Slack webhook notification hooks
- Docker standalone runtime for Coolify

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

Required production variables:

```dotenv
NEXT_PUBLIC_CONVEX_URL=
CONVEX_URL=
CONVEX_INGEST_SECRET=
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
IP_HASH_SECRET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_FROM_ADDRESS=
SES_REPLY_TO=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SLACK_WEBHOOK_URL=
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

Segment-specific routing and opener copy live in `lib/segments.ts`. Realtime event handling is isolated in `lib/voice/realtime-events.ts`, outbound client event serialization is in `lib/voice/client-events.ts`, and browser microphone/WebRTC lifetime is in `components/voice-agent/useRealtimeVoiceSession.ts`. Behavior changes should get focused tests in `tests/realtime-events.test.ts`, `tests/realtime-client-events.test.ts`, or `tests/openai-realtime.test.ts` before deployment.

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
