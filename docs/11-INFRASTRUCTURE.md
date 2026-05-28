# 11 — Infrastructure

How the Oriental microsite is hosted, secured, and deployed on Mereka
infrastructure.

## Topology

```
user
  │
  ▼
Cloudflare
  DNS · TLS · proxy · WAF · Turnstile
  │
  ▼
Coolify application
  Next.js 16 standalone server
  │
  ├── Convex Cloud              lead + lead-event persistence
  ├── OpenAI Realtime API       client secrets + WebRTC calls
  ├── AWS SES / SMTP            owner notifications
  ├── Slack webhook             optional lead mirror
  └── Infisical via Coolify     runtime env materialized at deploy
```

Current launch shape is a **single Coolify app instance**. The in-memory rate
limiter is acceptable only for that shape.

## Domain And DNS

| Record | Value | Proxied |
|---|---|---|
| `oriental.mereka.io` | Coolify origin | Yes |
| `oriental.mereka.io` CAA | `letsencrypt.org` | n/a |

TLS terminates at Cloudflare and the origin should remain Full Strict.

## Cloudflare

### Turnstile

Turnstile protects:

- `POST /api/leads`
- `POST /api/newsletter`
- `POST /api/voice/session`

Runtime details:

- client hook: `components/security/useTurnstile.ts`
- server verifier: `verifyTurnstile()` in `lib/server/security.ts`
- local loopback fallback: `local-dev` token when no site key is configured
- production: `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are required

### WAF / Cache

Recommended:

- block obvious automated traffic with no `User-Agent` on `/api/*`
- apply Cloudflare managed bad-ASN/bot rules to `/api/*`
- keep browser cache low for HTML while `app/layout.tsx` is dynamic
- cache immutable static assets under `/_next/static/*` and `/assets/*`

Do not claim full-page HTML edge caching until the root no longer calls
`connection()`.

## Secrets — Infisical

Self-hosted Infisical:

| Field | Value |
|---|---|
| API URL | `https://secrets.mereka.io/api` |
| Project ID | `6bfac905-9bb1-449e-8be8-f25f9634802b` |
| App folder | `/deploy/oriental-website` |
| Environments | `dev`, `staging`, `prod` |

Never run interactive `infisical login` in automation. Use Universal Auth:

```bash
source ~/.config/infisical/universal-auth.env
export INFISICAL_API_URL
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_UA_CLIENT_ID" \
  --client-secret="$INFISICAL_UA_CLIENT_SECRET" \
  --silent --plain 2>/dev/null)
infisical export --env=prod --path=/deploy/oriental-website \
  --projectId=6bfac905-9bb1-449e-8be8-f25f9634802b --format=dotenv
```

Coolify should materialize the exported values as normal environment variables
at deploy time. The app itself reads `process.env.*` and has no Infisical SDK
runtime dependency.

Secret contract is enforced by `scripts/check-secrets.ts`.

## Coolify

| Field | Value |
|---|---|
| Service | `oriental-website` / app currently serving `oriental.mereka.io` |
| Type | Docker application |
| Branch | `main` for production |
| Runtime port | `3000` by default |
| Health check | `GET /api/health` |
| Build | Next.js `output: "standalone"` |

Deploy flow:

1. PR opens → GitHub `verify` workflow runs.
2. Merge to `main` → Coolify builds the app image.
3. Coolify injects Infisical/Coolify env values.
4. Container starts.
5. Coolify waits for `/api/health`.
6. Traffic swaps to the new container.

Convex function deployment is separate:

```bash
CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
```

There is no `pnpm db:migrate` step and no launch `DATABASE_URL`.

## Data Plane

Convex production URL:

```text
https://wary-hornet-265.eu-west-1.convex.cloud
```

Runtime env:

```dotenv
CONVEX_URL=
NEXT_PUBLIC_CONVEX_URL=
CONVEX_INGEST_SECRET=
```

`CONVEX_INGEST_SECRET` protects app-to-Convex mutations.

## Local Public Testing

Use the repo helper instead of writing ngrok credentials into the global config:

```bash
pnpm dev
pnpm local:ngrok -- --port 3000
pnpm local:ngrok -- --check
```

The helper authenticates to Infisical with Universal Auth, reads
`NGROK_AUTH_TOKEN`/`NGROK_AUTHTOKEN` and optional `NGROK_DOMAIN`, writes a
temporary ngrok config, and redacts token-like output.

## Health And Observability

Current runtime:

- `/api/health` proves the Next server is responsive.
- Coolify container logs retain stdout/stderr.
- Route responses expose persistence/notification status for accepted leads.

Not currently implemented unless a later PR adds it:

- Sentry
- Prometheus metrics
- scraped Turnstile/OpenAI failure-rate counters
- PagerDuty alerting
- structured request log pipeline

## Rotation

| Secret class | Cadence |
|---|---|
| OpenAI API key | 90 days or immediately after temporary key use |
| AWS / SMTP credentials | 90 days |
| Slack webhook | staff/channel change or suspected leak |
| Turnstile secret | annually or suspected leak |
| Infisical Universal Auth credentials | 180 days |
| Convex ingest/deploy secrets | staff change or suspected leak |

Rotation means updating Infisical/Coolify and redeploying the app.

## Disaster Recovery

- GitHub holds source, docs, and static assets.
- Convex is the launch data plane; backup/export ownership still needs an ops
  decision before public launch.
- Infisical backup/restore is handled by the shared secrets platform.
- Coolify rollback should be tested before launch.
- Cloudflare DNS export should live in the infra repo.

## Open Infra Questions

- Confirm final Coolify service naming and resource limits in the live UI.
- Confirm Cloudflare zone ownership and WAF rules.
- Define Convex backup/export process and retention.
- Decide whether a shared Redis/KV limiter is needed before launch or only
  before horizontal scaling.
- Confirm staging domain if one is required (`oriental-staging.mereka.io` or
  Coolify preview URL).
