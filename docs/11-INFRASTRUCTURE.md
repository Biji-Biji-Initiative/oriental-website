# 11 — Infrastructure

How the Oriental microsite is hosted, secured, and deployed on Mereka
infrastructure.

## Topology

```
user
  │
  ▼
Cloudflare
  authoritative DNS · Turnstile
  │
  ▼
Coolify Traefik
  TLS · routing
  │
  ▼
Coolify application
  Next.js 16 standalone server
  │
  ├── Convex Cloud              lead + lead-event persistence
  ├── OpenAI Realtime API       client secrets + WebRTC calls
  ├── AWS SES / SMTP            owner notifications
  ├── Slack Web API             lead mirror to #tech-team-test
  ├── Redis / Valkey            shared rate limiting
  └── Infisical via Coolify     runtime env materialized at deploy
```

Current production uses a Redis-backed limiter through `REDIS_URL`. The
in-memory limiter remains as local/degraded fallback only; do not treat memory
mode as horizontally scalable.

## Domain And DNS

| Record | Value | Proxied |
|---|---|---|
| `oriental.mereka.io` | Coolify app host (`194.233.71.200`) | No |
| `staging.oriental.mereka.io` | Coolify app host (`194.233.71.200`) | No |

Cloudflare is the authoritative DNS provider. These direct-origin records are
DNS-only, so TLS terminates at the Coolify Traefik proxy with Let's Encrypt
certificates. The only application source-of-truth hostnames are the branded
production and `staging.<service>.mereka.io` records above.

## Cloudflare

### Turnstile

Turnstile protects form-style intake only when `TURNSTILE_ENFORCEMENT=required`:

- `POST /api/leads` for unsigned form submissions
- `POST /api/newsletter`

Voice start is intentionally not behind Turnstile. `/api/voice/session` uses Redis-backed rate limiting, and voice lead handoff proves session origin with signed review credentials returned by the session route.

Runtime details:

- client shim: `components/security/TurnstileProvider.tsx` currently returns an empty token because Turnstile UI is disabled for this microsite
- server verifier: `verifyTurnstile()` in `lib/server/security.ts`
- local loopback fallback: `local-dev` token when no site key is configured
- production: set `TURNSTILE_ENFORCEMENT=required` only if Cloudflare verification is deliberately re-enabled for form/newsletter paths

### WAF / Cache

The current DNS-only records do not traverse Cloudflare's proxy, so Cloudflare
WAF and edge caching are not active for Oriental. If proxying is enabled later,
validate these controls before cutover:

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
| Coolify app UUID | `mtrl2z6a7zvoyevxvufpntij` (`COOLIFY_ORIENTAL_APPLICATION_UUID`) |

Never run interactive `infisical login` in automation. Use Universal Auth:

```bash
source ~/.config/infisical/universal-auth.env
export INFISICAL_API_URL
export INFISICAL_TOKEN=$(infisical login --domain="$INFISICAL_API_URL" \
  --method=universal-auth \
  --client-id="$INFISICAL_UA_CLIENT_ID" \
  --client-secret="$INFISICAL_UA_CLIENT_SECRET" \
  --silent --plain 2>/dev/null)
infisical export --domain="$INFISICAL_API_URL" --env=prod \
  --path=/deploy/oriental-website \
  --projectId=6bfac905-9bb1-449e-8be8-f25f9634802b --output=dotenv
```

Infisical is the canonical comparison source. Coolify does not consume that
folder through the app at runtime: an operator must reconcile the values into
Coolify's environment-variable store, and into staging's host-local `.env`,
before recreating containers. The app reads `process.env.*` and has no
Infisical SDK runtime dependency. Source checks alone are insufficient; inspect
the running container after every configuration release. The governed staging
deployer streams the complete native staging export through encrypted stdin and
atomically merges managed keys into the host `.env`. The production deployer
creates or updates every approved runtime entry, enables `NEXT_PUBLIC_*` values
at build time as well, and reads back exact value/scope parity before it may
change the release SHA. An absent injected value is never implicit retirement:
the deployer stops before writes unless that key is already empty/absent or is
listed in the code-reviewed `RETIRED_MANAGED_APPLICATION_ENVIRONMENT_KEYS` set.
Add the tombstone in the same PR that removes the native Infisical value and
retain it as durable ownership history; a later source value safely overrides
the tombstone.
Infisical exports are materialized as Coolify literal values, so `$...` inside a
concrete secret cannot be expanded a second time. Its Coolify token needs scoped
`read:sensitive`, `write`, and `deploy` permissions; values are never written to
process arguments or logs.

`pnpm release:verify:voice-cell` is the fast, non-secret parity check. Run it
under `infisical run` with `--model-cell candidate` for native staging and
`--model-cell control` for native production before the full release preflight.
Both require baseline runtime, low reasoning, adaptive capture, and the exact
model for the selected cell. Clean candidate evidence requires the picker
explicitly off. A separate staging audition check adds `--picker-mode audition`
and requires it on; production control always requires it off.

Secret contract is enforced by `scripts/check-secrets.ts`.

## Coolify

| Field | Value |
|---|---|
| Service | `oriental-website` / app currently serving `oriental.mereka.io` |
| Application UUID | `mtrl2z6a7zvoyevxvufpntij` |
| Type | Docker application |
| Branch | `main` for production |
| Runtime port | `3000` by default |
| Health check | `GET http://127.0.0.1:3000/api/health` |
| Build | Next.js `output: "standalone"` |

The runtime image sets `HOSTNAME=0.0.0.0` so the standalone Next.js server is
reachable both through Traefik and through Coolify's loopback health probe.
The Coolify health-check host is `127.0.0.1`; do not use `localhost`, because
BusyBox `wget` may resolve it to IPv6 while the standalone server is IPv4-bound.

Staging is available at `https://staging.oriental.mereka.io`, following the
`staging.<service>.mereka.io` convention. It is a lightweight Compose deployment
on the same Coolify app host under
`/data/coolify/applications/oriental-staging`. Staging images use the distinct
`mtrl2z6a7zvoyevxvufpntij:staging-<sha>` tag while production uses
`mtrl2z6a7zvoyevxvufpntij:<sha>`; the distinct tags isolate release ownership,
while the approved Mereka M nebula and public entrance treatment are built
identically for staging and production. The entrance treatment is
non-interactive, never locks scrolling, runs once per tab for no more than 700
ms, and is omitted on admin/API and reduced-motion loads. Staging is routed through the Coolify
Traefik network with `coolify.managed=false`, so it is host-managed rather than
a full Coolify UI application until a dedicated Coolify staging app/API token
is provisioned.
The Infisical `staging` environment contains the complete application contract
plus the explicit baseline/candidate/low/adaptive cell and staging Sentry. The
picker state is selected independently as clean or audition. The host-managed
staging container still materializes those values through its host-local env
file; Infisical is the canonical comparison source, not a runtime SDK
dependency. Staging and production still share upstream
Convex, SES/SMTP, Slack, Redis, and OpenAI accounts. Redis keys are separated by
environment, and new voice snapshots carry deployment attribution, but do not
treat staging submissions as a fully isolated data/notification sandbox until
dedicated staging services are provisioned.

The governed host deployer first converges the complete staging application
scope from Infisical, then renders and atomically replaces staging's `.env`,
rewriting the five non-secret voice-cell values to the explicitly selected
control or candidate model cell and the explicit clean or audition picker mode,
alongside the exact SHA. Clean is the default and is required for evidence;
audition is staging-only. Candidate and audition are rejected for every
production host path. The deployer recognizes both native `tailscale` and WSL's
`tailscale.exe` without splitting paths.

Picker-enabled sessions are voice auditions, not clean model-only evidence.
Voice evals persist `clear_fields` as the canonical clear-all tool name and
aggregate PII-free tool latency both overall and by canonical tool name; it is
never rewritten to the distinct single-field `clear_field` operation. Cohorts
also retain `variant`, `voice`, and `speed`, and the experiment validator
rejects any row that changes both model and voice variant. Aggregate-only eval
uses read-only Convex queries and may enrich missing historical profile fields
through the existing per-session query; it never deploys functions or writes
sessions, judgments, or reports. Collect the clean picker-off candidate cohort
before considering automatic model promotion.

Staging rollback/removal is host-local:

```bash
cd /data/coolify/applications/oriental-staging
docker compose -p oriental-staging down
```

Deploy flow:

1. PR opens → GitHub `verify` workflow runs.
2. Merge once to `main`, run release preflight, and freeze the full SHA.
3. Inject staging's application scope for the host deployer; inject both the
   application scope and operator-only Coolify scope for production. Each
   deployer performs and verifies its own reconciliation.
4. Build/prove the distinct staging image.
5. Run `pnpm release:deploy:production` with the frozen SHA, live production
   SHA, the managed application values from `/deploy/oriental-website`, and the
   operator credential from Infisical `/platform/coolify`.
6. The deployer reconciles and reads back the complete approved runtime scope
   before it pins and reads back Coolify's commit, inspects the deployment
   record, proves `running:healthy` with a loopback health-check host, and proves
   public health; Coolify swaps traffic only after the candidate is healthy.
7. Run `pnpm release:verify -- --sha <sha> --target both --staging-model-cell
   candidate --staging-picker-mode clean` under the managed
   application scope. The verifier uses Playwright to prove the Search Console
   meta tag and the GA public-consent/admin-exclusion boundary.

Convex function deployment is separate. A release that adds a canonical tool
name to the bounded session validator, including `clear_fields`, MUST deploy
the reviewed Convex schema/functions before either web environment. Never hide
an older function deployment by rewriting `clear_fields` to `clear_field`:

```bash
CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
```

Convex deploy credentials are read at deployment time from the Oriental
Infisical scope and MUST never be copied into repo files or shell history.

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
REDIS_URL=
```

`CONVEX_INGEST_SECRET` protects app-to-Convex mutations.

Rate limiting uses Redis/Valkey keys under `oriental:rate:*` in production and
`oriental:<environment>:rate:*` outside production, based on
`SENTRY_ENVIRONMENT`, when `REDIS_URL`, `UPSTASH_REDIS_URL`, or `VALKEY_URL` is set. Route logs include
`rateLimitStore`; production should normally show `"redis"`.

Slack delivery uses `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` first. Current smoke
channel is `#tech-team-test` (`C01AVSGACFN`). `SLACK_WEBHOOK_URL` is fallback
only.

## Observability

Current production floor:

- Structured JSON logs from route handlers, visible in Coolify logs.
- Sentry Next.js SDK (`sentry.server.config.ts`, `sentry.edge.config.ts`,
  `instrumentation.ts`, `instrumentation-client.ts`) with project
  `oriental-website`.
- Slack ops alerts through `SLACK_BOT_TOKEN` and
  `OPS_ALERT_SLACK_CHANNEL_ID=C01AVSGACFN` (`#tech-team-test`).
- Token-gated `/admin/session-review` for the latest enquiry pipeline,
  organization accounts, returning contacts, owner workload, direct ClickUp
  task records, voice session snapshots, Reka evaluations, transcripts, and
  notification failures.

Alert sources in source today:

- OpenAI Realtime client-secret mint failures.
- Production lead persistence failures.
- Production owner notification failures.
- Production routing misconfiguration.
- Redis/shared rate-limit fallback.

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

- `/api/health` returns `version`, `uptime_s`, and `convex` config presence.
- Coolify container logs retain stdout/stderr.
- Route handlers emit structured JSON logs through `lib/server/logger.ts`.
- Important events include `voice_session.*`, `lead.*`, `newsletter.*`, and
  `rate_limit.redis_fallback`.
- Route responses expose persistence/notification status for accepted leads.

Not currently implemented unless a later PR adds it:

- Prometheus metrics
- scraped Turnstile/OpenAI failure-rate counters
- PagerDuty alerting

Safe log proof examples:

```bash
curl -sS https://oriental.mereka.io/api/health
curl -sS -X POST https://oriental.mereka.io/api/leads \
  -H 'content-type: application/json' \
  --data '{"source":"form","form":{}}'
```

The second command should return `400 invalid_payload` and create a structured
`lead.invalid_payload` log without storing a lead.

## Rotation

| Secret class | Cadence |
|---|---|
| OpenAI API key | 90 days or immediately after temporary key use |
| AWS / SMTP credentials | 90 days |
| Slack bot token / webhook | staff/channel change or suspected leak |
| Sentry auth token / DSN | staff/project change or suspected leak |
| Admin review token | staff change or suspected leak |
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

- Confirm final Coolify resource limits in the live UI.
- Retain Cloudflare zone ownership evidence; do not require WAF rules while the
  canonical records intentionally remain DNS-only.
- Define Convex backup/export process and retention.
- Tune Sentry alerts, Slack alert thresholds, and dashboard review cadence after
  the first real traffic.
- Complete human listening QA for Reka's Malaysian-English voice quality.
