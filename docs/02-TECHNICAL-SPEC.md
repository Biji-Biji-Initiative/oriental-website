# 02 — Technical Specification

Runtime truth for the production build:
**Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · Convex · OpenAI Realtime 2**.

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 App Router | Node runtime on Coolify; no Vercel edge assumptions. |
| React | React 19 | Server components by default; small client islands for interactive surfaces. |
| Styling | Tailwind CSS 4 | Tokens and component classes in `app/globals.css`. |
| UI primitives | shadcn/ui | Dialog, Tabs, Input, Textarea, Label, Button, Sonner. |
| Fonts | `next/font/local` | Self-hosted Poppins and Fraunces files in `public/assets/fonts/`. |
| Brand assets | Local public assets | Source notes in `docs/ASSET-SOURCES.md`. |
| Voice | OpenAI Realtime 2 | `gpt-realtime-2`, WebRTC, ephemeral client secrets. |
| Data | Convex | `convex/schema.ts`, `convex/leads.ts`, `lib/server/convex.ts`. |
| Email | SMTP or AWS SESv2 | SMTP preferred when configured; otherwise SESv2 by region. SMTP sends one message to all recipients in a single transaction. |
| Slack | Bot token + channel id, webhook fallback | Lead mirror to `#tech-team-test` via `SLACK_CHANNEL_ID`; `SLACK_WEBHOOK_URL` is fallback-only. |
| Abuse protection | Cloudflare Turnstile | Verified server-side on all intake POST routes. |
| Rate limiting | Redis/Valkey via `REDIS_URL`, memory fallback | Shared limiter is active in production; memory mode is degraded fallback only. |
| DNS / TLS / WAF | Cloudflare | In front of Coolify origin. |
| Secrets | Infisical + Coolify env | Project `6bfac905-9bb1-449e-8be8-f25f9634802b`, folder `/deploy/oriental-website`. |
| Hosting | Coolify | Docker standalone Next.js app. |
| Observability | Sentry + structured logs + Slack ops alerts | Admin review at `/admin/session-review`; route logs stay in Coolify. |

There is no React Three Fiber runtime in the current app. The public orb is the
SVG `MiniOrb`.

## 2. Repository Layout

```
app/
  layout.tsx              # metadata, fonts, VoiceProvider, SiteNav, VoiceRail
  page.tsx                # home page section composition + JSON-LD
  globals.css             # Tailwind v4 tokens + component chrome
  api/
    admin/                # token-gated review APIs
    health/route.ts
    leads/route.ts
    newsletter/route.ts
    voice/session/route.ts
  admin/session-review/   # internal lead + voice session review
components/
  admin/                  # admin login/review UI
  site/                   # homepage sections, grids, nav, timeline, rail
  voice-agent/            # dialog, WebRTC hook, state, hero email capture
  security/               # Turnstile hook
  orb/                    # MiniOrb SVG
  ui/                     # shadcn primitives
convex/
  schema.ts
  leads.ts
  _generated/
lib/
  content.ts
  schemas.ts
  segments.ts
  voice/
  server/
tests/
  *.test.ts
  e2e/
public/assets/
```

Use `AGENTS.md` for the most compact "where to change what" map.

## 3. Rendering Model

Everything runs in the Node runtime. The browser fetches public runtime feature
flags from `/api/client-config`; Turnstile UI is currently disabled on the
microsite.

| Route | Behaviour |
|---|---|
| `/` | RSC home page plus client islands for nav, timeline, voice, and hero email. |
| `/api/leads` | Validate payload → signed voice review credential or optional Turnstile check → rate-limit → route/persist lead → notify owner/Slack. |
| `/api/newsletter` | Validate payload → optional Turnstile check → rate-limit → persist `source="hero-email"` lead → send newsletter-specific subscriber confirmation when email is configured. |
| `/api/voice/session` | Validate payload → rate-limit → mint OpenAI Realtime client secret and signed review credentials. |
| `/api/health` | Lightweight app liveness response; no upstream dependency ping. |

Do not document aggressive HTML caching while the root layout is dynamic.

## 4. Tailwind v4 Setup

All theme variables live in `app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-mk-anchor-blue: #1f3f7c;
  --color-mk-horizon: #c9d5ec;
  --color-mk-off-black: #100d18;
  --color-mk-paper: #f6f4ef;
  --font-sans: "Poppins", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Fraunces", ui-serif, Georgia, serif;
  --max-width-wrap: 1320px;
}
```

Prototype-parity component classes use stable prefixes such as `.eco-*`,
`.facilities-*`, `.partner-*`, `.timeline*`, `.site-nav__*`, and
`.footer-brand*`.

## 5. Environment Variables

Production secrets live in Infisical:

- host: `https://secrets.mereka.io/api`
- project ID: `6bfac905-9bb1-449e-8be8-f25f9634802b`
- folder: `/deploy/oriental-website`
- envs: `dev`, `staging`, `prod`

Use Universal Auth machine credentials only. Do not use interactive
`infisical login`.

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

Runtime contract:

```dotenv
NEXT_PUBLIC_CONVEX_URL=
CONVEX_URL=
CONVEX_INGEST_SECRET=
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=coral
OPENAI_REALTIME_SPEED=1.28
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
# Optional build/CI-only source-map upload; avoid Coolify runtime injection.
SENTRY_AUTH_TOKEN=
SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_FROM_ADDRESS=
SES_REPLY_TO=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SLACK_BOT_TOKEN=
SLACK_CHANNEL_ID=C01AVSGACFN
OPS_ALERT_SLACK_CHANNEL_ID=C01AVSGACFN
SLACK_WEBHOOK_URL=
OPS_ALERT_SLACK_WEBHOOK_URL=
OWNER_TENANCY=
OWNER_EDUCATION=
OWNER_PROGRAMME=
OWNER_TECHNOLOGY=
OWNER_AI=
OWNER_CULTURAL=
OWNER_COMMUNITY=
OWNER_OTHER=
```

Deploy-only:

```dotenv
CONVEX_DEPLOY_KEY=
```

Local `.env.local` is for developer convenience only and must never be
committed.

## 6. Voice Runtime

Session minting:

1. Client requests microphone permission; a known denial spends no quota.
2. Client calls `POST /api/voice/session` after consent (or uses a
   permission-aware pre-mint for a returning visitor).
3. Server calls `POST /v1/realtime/client_secrets`.
4. Client posts SDP offer to `POST /v1/realtime/calls`.
5. Realtime data-channel events are reduced by `lib/voice/realtime-events.ts`.

Defaults:

- model: `OPENAI_REALTIME_MODEL ?? "gpt-realtime-2"`
- source fallback voice: `OPENAI_REALTIME_VOICE ?? "marin"`
- production voice: `coral` via Infisical/Coolify
- source fallback speed: `OPENAI_REALTIME_SPEED ?? 1.18`
- production speed: `1.28` via Infisical/Coolify
- idle timeout: `20s` client timer
- max session: `600s` typed server-resolved policy by default
- tools: `set_partner_type`, atomic `capture_fields`, read-only
  `lookup_oriental`, `clear_field`, `summarise_lead`, `route_to_team`,
  `wait_for_user`, `end_call`
- review snapshots: `/api/voice/session` returns signed review credentials;
  `/api/voice/debug` verifies and upserts Convex `voiceSessions`

## 7. Build, Test, Deploy

Commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm check-secrets
pnpm convex:codegen
CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
```

CI currently runs the `verify` workflow on PRs. Coolify builds the Docker
standalone app and serves the generated Next.js server.

No Drizzle migrations or `DATABASE_URL` are part of the launch runtime.

Admin review and observability:

- `/admin/session-review` is protected by `ADMIN_REVIEW_TOKEN`.
- Sentry uses `@sentry/nextjs` config files and `withSentryConfig` in
  `next.config.ts`.
- Production ops alerts use `OPS_ALERT_SLACK_CHANNEL_ID`; the current smoke
  channel is `#tech-team-test` (`C01AVSGACFN`).

## 8. Performance And SEO

Budgets:

| Metric | Target |
|---|---|
| LCP mobile 4G | ≤ 2.5s |
| CLS | < 0.05 |
| INP | < 200ms |
| Lighthouse accessibility | ≥ 95 |

SEO:

- canonical: `https://oriental.mereka.io/`
- `app/sitemap.ts` lists `/`
- `app/robots.ts` allows indexing
- JSON-LD includes Mereka `Organization` and Oriental Building `Place`
- OG/Twitter images use `/assets/og-image.png`
- favicon metadata uses canonical Mereka favicon PNGs under
  `/assets/brand/mereka/`

## 9. Launch Implementation Notes

Already implemented in source:

- Next.js 16 + Tailwind v4 + shadcn primitives
- prototype-parity homepage structure
- official Biji-biji/Mereka assets and CIMB partner marks
- Convex lead persistence path
- Turnstile verification
- Redis-backed rate limits with memory fallback
- OpenAI Realtime 2 WebRTC path
- Slack bot-token delivery to `#tech-team-test` with webhook fallback
- structured JSON route logs for voice, lead, newsletter, and limiter events
- focused Vitest and Playwright coverage

Open before public launch:

- PDPA/privacy notice and footer/modal links
- photography rights
- legal/brand approval for partner logo usage
- live Realtime conversation proof against staging/prod
- Convex deploy proof and owner-notification proof
- human listening QA for Reka's Malaysian-English voice and conversation quality
- Sentry/metrics/alerting if operational risk requires more than Coolify logs
