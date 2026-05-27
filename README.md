# Oriental Website

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

## Environment

Copy `.env.local.example` to `.env.local` for local work. The Convex URL is non-secret and already points at the provisioned production deployment. Server-only secrets must be supplied through Infisical/Coolify for production.

Required production variables:

```dotenv
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
CONVEX_URL=
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
TURNSTILE_SECRET_KEY=
IP_HASH_SECRET=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_FROM_ADDRESS=
SES_REPLY_TO=
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
