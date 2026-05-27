# 11 — Infrastructure

How the Oriental microsite is **hosted, secured, and deployed** on Mereka
infrastructure. This is first-class — read this before writing any code that
touches secrets, DNS, or the deploy pipeline.

---

## 1. Topology at a glance

```
                ┌──────────────────────────────────────────────────┐
                │                  Cloudflare                       │
   user ──TLS──▶│  DNS · proxy · CDN · WAF · Turnstile (challenge)  │
                └──────────────────────┬────────────────────────────┘
                                       │  (HTTPS, origin pull)
                                       ▼
                ┌──────────────────────────────────────────────────┐
                │                Coolify (Mereka infra)             │
                │  ┌────────────────────┐   ┌────────────────────┐ │
                │  │  oriental-web      │   │  redis (private)   │ │
                │  │  Next.js 16 stand. │   │  rate-limit + cache│ │
                │  └────────┬───────────┘   └────────────────────┘ │
                │           │                                       │
                │           ▼                                       │
                │   reads secrets at boot from ─────────────────────┼──▶ secrets.mereka.io
                │                                                   │      (Infisical)
                └───────────────────────────────────────────────────┘
                       │              │             │
                       ▼              ▼             ▼
                  Postgres        AWS SES       Slack webhook
                 (Supabase/      (transactional)  (#partner-intake)
                   Neon)
                       ▲
                       │
                  OpenAI Realtime API
                  (ephemeral tokens minted server-side)
```

## 2. Domain & DNS

| Record | Value | Proxied (orange-cloud) |
|---|---|---|
| `oriental.mereka.io` (A / AAAA) | Coolify host public IP | ✅ Yes |
| `oriental.mereka.io` CAA | `letsencrypt.org` | n/a |
| `mereka.io` apex | `corporate.mereka.io` 301 (existing) | n/a |

TLS is terminated at Cloudflare. Coolify's reverse proxy presents a Let's
Encrypt cert on the origin so connection is end-to-end HTTPS (no "Flexible"
mode — must be **Full (Strict)**).

## 3. Cloudflare configuration

### 3.1 Turnstile (mandatory on every intake POST)

We use **Cloudflare Turnstile** as the bot/abuse gate on:

- `POST /api/leads` (form submission)
- `POST /api/voice/session` (mints OpenAI ephemeral token — abuse is expensive)
- `POST /api/newsletter` (hero email capture)

Flow:

1. On page load, the client renders an **invisible Turnstile widget** bound to
   the body. It transparently issues a token without UI.
2. When the user submits any intake surface, the current Turnstile token is
   attached as `cf-turnstile-token` in the request body (or header).
3. The Route Handler **verifies the token** against
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` using
   `TURNSTILE_SECRET_KEY` before doing anything else. On failure → 403.
4. If a token is older than ~5 min Turnstile refreshes it automatically; the
   client always sends the latest.

Site key: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (safe to ship to client).
Secret key: `TURNSTILE_SECRET_KEY` (Infisical only, never exposed).

Helper sketch (`lib/turnstile.ts`):

```ts
export async function verifyTurnstile(token: string, ip: string) {
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY!,
      response: token,
      remoteip: ip,
    }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('turnstile_failed');
}
```

### 3.2 WAF / Rules

- Block requests with no `User-Agent` to `/api/*`.
- Challenge requests from known-bad ASNs to `/api/*` (Cloudflare managed list).
- Cache `GET /` aggressively (Edge TTL 5 min, Browser TTL 0 — content rarely
  changes, but we want the next deploy visible quickly when stakeholders look).
- Bypass cache on every `Cookie:`-bearing request (none expected on the
  microsite, but a safety net).

### 3.3 Analytics

Cloudflare Web Analytics is enabled on the zone. Privacy-friendly, no cookies —
good for this project given PDPA constraints.

## 4. Secrets — Infisical (`secrets.mereka.io`)

**All** runtime secrets live in our self-hosted Infisical at
`secrets.mereka.io`. There is no `.env` file checked in, shipped, or copied
to a developer machine outside the bootstrap login flow.

### 4.1 Project structure

| Field | Value |
|---|---|
| Project name | `oriental-microsite` |
| Environments | `dev` · `staging` · `prod` |
| Folder layout | flat (all keys at root of each env) |
| Tags | `db`, `email`, `ai`, `routing`, `cloudflare`, `slack` for filtering |

### 4.2 Variable contract

The full list lives in [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) §5.
Treat that section as the **single source of truth** for which keys must
exist; the Infisical project must hold every one of them in every environment.

CI runs a check (`scripts/check-secrets.ts`) that connects to Infisical with a
read-only machine identity and asserts every required key is present and
non-empty before allowing a deploy. Fails the deploy if a key is missing.

### 4.3 How secrets reach the app

There are three integration modes and we pick **one** — currently **(B) Coolify
native integration**. We document all three so the team has fallbacks.

**(A) Infisical CLI at boot** *(fallback)*
- Container `CMD` is `infisical run --env=prod -- node server.js`.
- Requires `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` baked into the
  container env (via Coolify) so the CLI can authenticate.
- The CLI fetches secrets and injects them into the process env at startup.

**(B) Coolify ↔ Infisical native integration** *(chosen)*
- Coolify pulls secrets from Infisical at **deploy time** using a machine
  identity, materialises them as standard environment variables on the
  container, and rotates them on every deploy.
- App code reads `process.env.*` normally — it is unaware of Infisical.
- This is the cleanest option and what we ship.

**(C) Infisical SDK at runtime** *(rejected for this project)*
- Adds runtime dependency on `secrets.mereka.io` being up to serve traffic.
- Not worth the latency or the failure mode for a simple long-lived service.

### 4.4 Machine identities

Two identities exist for this project:

| Identity | Scope | Used by |
|---|---|---|
| `oriental-coolify-deploy` | Read-only, `prod` + `staging` | Coolify deploy job |
| `oriental-ci-check` | Read-only, all envs | GitHub Actions secret-presence check |

Auth method: **Universal Auth** (client ID + client secret). Secrets for the
identities themselves live in Coolify's own secret store + GitHub Actions
encrypted secrets — they are the only two values not in Infisical (by
necessity, since they bootstrap Infisical access).

### 4.5 Rotation policy

| Secret class | Rotation cadence | Trigger |
|---|---|---|
| `OPENAI_API_KEY` | Every 90 days | Calendar reminder + on any suspected leak |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Every 90 days | Same |
| `SLACK_WEBHOOK_URL` | On staff change | Channel admin updates |
| `TURNSTILE_SECRET_KEY` | Annually or on leak | Cloudflare dashboard |
| Machine identity secrets | Every 180 days | Infisical UI |
| `DATABASE_URL` password | Every 180 days | Coordinated with DB host |

Rotation is **one Infisical edit + one Coolify redeploy**. App code never
changes.

### 4.6 Local development

Developers do **not** copy secrets into a local `.env`. Instead:

```bash
# one-time
infisical login --domain https://secrets.mereka.io

# every dev session
infisical run --env=dev --projectId=$INFISICAL_PROJECT_ID -- pnpm dev
```

Only the `dev` environment is reachable from a developer laptop. `staging`
and `prod` require the deploy machine identity.

## 5. Coolify configuration

### 5.1 Service definition

| Field | Value |
|---|---|
| Project | `mereka` |
| Service name | `oriental-web` |
| Type | Application (Docker) |
| Source | GitHub repo (`mereka/oriental-microsite`) |
| Branch | `main` (prod), `staging` (staging) |
| Build pack | Dockerfile (we ship our own) |
| Port | `3000` (Next.js standalone) |
| Health check | `GET /api/health` → `200 {"ok":true}` |
| Restart policy | `unless-stopped` |
| Resource limits | 1 vCPU · 1 GiB RAM (sufficient at expected traffic) |

### 5.2 Companion services

- **`oriental-redis`** — `redis:7-alpine`, private network only, persisted volume.
  Used by the rate limiter.
- *(Optional)* **`oriental-pg`** — if we host Postgres ourselves; otherwise we
  point `DATABASE_URL` at Supabase / Neon.

### 5.3 Deploy pipeline

1. Developer opens PR → GitHub Actions runs lint + tests + the secret-presence
   check against Infisical `dev`.
2. Merge to `main` → GitHub webhook hits Coolify's deploy endpoint.
3. Coolify:
   1. Pulls the new commit.
   2. Authenticates to Infisical with `oriental-coolify-deploy`.
   3. Fetches `prod` secrets, writes them as container env vars.
   4. Builds the Docker image (multi-stage, `node:22-alpine`).
   5. Runs `pnpm db:migrate` in a pre-deploy hook against `DATABASE_URL`.
   6. Starts the new container, waits for `/api/health` to return `200`.
   7. Swaps traffic. Old container drains for 30s then stops.
4. Coolify posts deploy status to `#deploys` Slack channel.

Rollback: in Coolify UI, "Rollback to previous deployment" — atomic.

### 5.4 Logs

- Container `stdout` / `stderr` → Coolify log viewer, retained 30 days.
- Sentry receives error events with release tagged to the git SHA.
- Cloudflare provides edge logs (request-level) via the dashboard.

## 6. Health, monitoring, alerts

| Signal | Where | Alert routing |
|---|---|---|
| `/api/health` 5xx for 3 consecutive checks | Coolify health-check | PagerDuty → on-call |
| Sentry error rate spike | Sentry | Slack `#partner-intake-ops` |
| Turnstile verify failure rate > 10% | Custom log line, scraped | Slack `#partner-intake-ops` |
| OpenAI Realtime 4xx/5xx | Custom log line, scraped | Slack `#partner-intake-ops` |
| SES send failure | Sentry | Slack `#partner-intake-ops` |

## 7. Disaster recovery

- **DB backups** — daily snapshot retained 30 days (DB host responsibility).
- **Infisical backups** — Infisical's own self-hosted backups; restore path
  documented at the platform level.
- **Coolify config** — service definitions exported as YAML and committed to
  the infra repo monthly.
- **DNS** — Cloudflare zone export saved to the infra repo monthly.

## 8. Open infra questions

- Postgres: managed (Supabase / Neon) vs. self-hosted on Coolify? Decision
  needed before M1 deploy.
- Staging domain: `oriental-staging.mereka.io` — confirmed not public-indexed.
- Cloudflare account: under the existing Mereka Cloudflare tenant — confirm
  zone-level role assignment for the engineering team.
- Backup ownership: who watches the DB snapshot health?
