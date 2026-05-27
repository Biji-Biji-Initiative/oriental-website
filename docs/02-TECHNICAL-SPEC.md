# 02 — Technical Specification

The production build. **Next.js 16 · React 19 · Tailwind v4 · shadcn/ui.**

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | RSC by default; client components for the voice modal, orb, tweak controls. |
| React | **19.x** | `use()`, `useActionState`, Server Actions. |
| Styling | **Tailwind v4** | `@theme` block in `app/globals.css` holds the Mereka token names. Native CSS layers; no `tailwind.config.js`. |
| UI primitives | **shadcn/ui (Radix-backed)** | Dialog, Tabs, Card, Input, Textarea, Label, Button, Toast. |
| Fonts | `next/font/local` (Poppins, self-hosted) + `next/font/google` (Fraunces) | Inter only if needed for tertiary copy. |
| 3D | `three` + `@react-three/fiber` + `@react-three/drei` | The Mereka orb scene. |
| Voice | **OpenAI Realtime API** via ephemeral tokens, WebRTC client. | See [`05-VOICE-AGENT-SPEC.md`](./05-VOICE-AGENT-SPEC.md). |
| Database | **Postgres** (Supabase or Neon, TBD by infra) | One `leads` + one `lead_events` table. |
| ORM | **Drizzle** | Type-safe, plays nicely with edge runtimes. |
| Email | **AWS SES** (`@aws-sdk/client-sesv2`) | Transactional. |
| Slack | Incoming webhook | `#partner-intake`. |
| Bot / abuse protection | **Cloudflare Turnstile** | Invisible token required on every intake POST. See [`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md). |
| Rate limiting | **Redis** (self-hosted in Coolify) + a small sliding-window helper | Per-IP, on top of Turnstile. |
| Edge / DNS / CDN | **Cloudflare** | DNS for `oriental.mereka.io`, proxied (orange-cloud), TLS, caching, WAF. |
| Secrets | **Infisical** at `secrets.mereka.io` (self-hosted) | All env vars resolved at deploy time via Infisical → Coolify. Nothing checked in. |
| Hosting | **Coolify** (Mereka infra) | Single Docker service, Next.js standalone output. |
| Observability | **Sentry** (errors) + Coolify container logs + Cloudflare Analytics | No Vercel-specific tooling. |

## 2. Repository layout

```
oriental-microsite/
├── app/
│   ├── (site)/
│   │   ├── page.tsx                 // RSC — composes <Hero>, <Vision>, …
│   │   ├── layout.tsx               // <html>, fonts, <ThemeScript>, <Toaster>
│   │   └── opengraph-image.tsx      // Generated OG card
│   ├── api/
│   │   ├── leads/route.ts           // POST → write lead + email + slack
│   │   ├── voice/session/route.ts   // POST → mint OpenAI Realtime ephemeral token
│   │   └── newsletter/route.ts      // POST → hero email capture
│   ├── globals.css                  // @theme tokens, base layer, no utilities config
│   └── robots.ts / sitemap.ts
├── components/
│   ├── sections/                    // Hero, Vision, Ecosystem, Facilities, Partners, Timeline, Closing, Footer
│   ├── voice-agent/                 // Modal, VoiceMode, FormMode, CapturedRail, Submitted
│   ├── orb/                         // OrbCanvas (R3F), MiniOrb (SVG)
│   ├── nav/
│   └── ui/                          // shadcn-generated primitives
├── lib/
│   ├── db.ts                        // drizzle client
│   ├── schema.ts                    // leads, lead_events
│   ├── segments.ts                  // SEGMENTS map — see voice-agent spec
│   ├── email.ts                     // SES helpers
│   ├── slack.ts                     // webhook helper
│   ├── ratelimit.ts                 // upstash bindings
│   └── analytics.ts
├── public/
│   ├── assets/                      // photos, fonts, OG image (copied from prototype)
│   └── favicon.svg
├── drizzle/                         // migrations
├── .env.local.example
├── biome.json or eslint.config.js   // pick one
└── package.json
```

## 3. Rendering model

Everything runs in the **Node runtime** — we are on Coolify, not Vercel, so there is
no edge runtime split. The benefit of Cloudflare's edge is gained via the
orange-cloud proxy in front of the origin (caching, TLS termination, WAF), not
via per-route runtime targeting.

| Route | Behaviour |
|---|---|
| `/` (the microsite) | **RSC**, statically rendered at build time. Cloudflare caches the HTML response aggressively. |
| `/api/leads` | Validates Turnstile token → rate-limits → writes lead → sends SES email → posts Slack. |
| `/api/voice/session` | Validates Turnstile token → rate-limits → mints OpenAI Realtime ephemeral token. |
| `/api/newsletter` | Validates Turnstile token → rate-limits → writes `source='hero-email'` lead. |

Client components: `VoiceAgentDialog`, `OrbCanvas`, `MiniOrb`, `HeroEmailCapture`,
`NavScrollState`, `TimelineHoverState`, `TurnstileWidget`. Everything else stays server.

## 4. Tailwind v4 setup

In `app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* Mereka tokens — names match assets/mereka.css in prototype */
  --color-mk-anchor-blue: #1f3f7c;
  --color-mk-strategy-teal: #2d6a7a;
  --color-mk-horizon: #c9d5ec;
  --color-mk-off-black: #100d18;
  --color-mk-cream: #f6f4ef;
  --color-mk-line: rgba(16, 13, 24, 0.08);

  --font-sans: "Poppins", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Fraunces", ui-serif, Georgia, serif;

  --radius-pill: 999px;
  --radius-card: 18px;

  --shadow-card: 0 1px 0 rgba(16,13,24,0.06), 0 12px 32px -16px rgba(16,13,24,0.18);
}

/* prototype's data-attribute palette swap survives as-is */
[data-accent="horizon"] { --color-mk-anchor-blue: #4a6db0; }
[data-accent="mono"]    { --color-mk-anchor-blue: #100d18; }
```

Component code uses `bg-mk-anchor-blue`, `text-mk-off-black`, `font-serif`,
`rounded-card`, etc.

## 5. Environment variables

**No `.env.local` is committed or shipped.** All values are resolved from
Infisical (`secrets.mereka.io`) at deploy time — see
[`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md) for the full flow. Below is the
**variable contract** the app expects at runtime — engineering creates these
keys inside the Infisical project, not in a file.

```
# Database
DATABASE_URL

# OpenAI Realtime
OPENAI_API_KEY
OPENAI_REALTIME_MODEL                # default: gpt-4o-realtime-preview

# AWS SES
AWS_REGION                           # ap-southeast-1
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
SES_FROM_ADDRESS                     # oriental@mereka.io
SES_REPLY_TO                         # team@mereka.io

# Slack
SLACK_WEBHOOK_URL

# Redis (self-hosted, same Coolify project)
REDIS_URL

# Cloudflare Turnstile
TURNSTILE_SITE_KEY                   # public, exposed to client as NEXT_PUBLIC_*
TURNSTILE_SECRET_KEY                 # server-only

# Infisical bootstrap (used by the Coolify deploy hook, NOT by the app itself)
INFISICAL_PROJECT_ID
INFISICAL_ENVIRONMENT                # prod | staging | dev
INFISICAL_CLIENT_ID
INFISICAL_CLIENT_SECRET

# Routing overrides — owner email per segment
OWNER_TENANCY                        # chewi@mereka.io
OWNER_EDUCATION                      # lala@mereka.io
OWNER_PROGRAMME                      # jey@mereka.io
OWNER_TECHNOLOGY                     # gurpreet@mereka.io
OWNER_AI                             # gurpreet@mereka.io
OWNER_CULTURAL                       # avi@mereka.io
OWNER_COMMUNITY                      # ambika@mereka.io
OWNER_OTHER                          # nadia@mereka.io
```

The only public key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Everything else is
server-side and must not leak into the client bundle. CI fails the build if a
`NEXT_PUBLIC_*` variable is added without explicit review.

## 6. Performance budget

| Metric | Budget |
|---|---|
| LCP (mid-tier mobile, 4G) | ≤ 2.5s |
| CLS | < 0.05 |
| INP | < 200ms |
| Total JS on first paint | < 90 KB gzipped (R3F lazy-loaded on voice-open) |
| Hero photo | `priority` + `fetchPriority="high"`, AVIF first |

The three.js orb scene is **dynamic-imported** inside the voice modal — it must
never enter the initial bundle.

```ts
const OrbCanvas = dynamic(() => import('@/components/orb/OrbCanvas'), { ssr: false });
```

## 7. SEO

- Title: `Oriental · A future we build together`
- Description: existing copy in `index.html`
- `app/opengraph-image.tsx` renders the OG card from the same SVG used in prototype.
- `robots.ts` allows all. `sitemap.ts` lists `/` only.
- Canonical: `https://oriental.mereka.io/`
- JSON-LD `Organization` block for Mereka + `Place` block for the building
  (coordinates: 3.1473°N, 101.6979°E — verify before launch).

## 8. Build & CI

- **GitHub Actions** runs lint + tests on every PR.
- **Coolify** has a webhook deploy: merge to `main` → Coolify pulls, builds the
  Docker image, hydrates env from Infisical, runs migrations, switches traffic.
  See [`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md) §Deploy pipeline.
- **Preview environments** — one per long-lived branch via a second Coolify
  service pointing at `oriental-preview.mereka.io`. PR previews are not
  automatic; spin one up on request.
- **Drizzle migrations** run via `pnpm db:migrate` from the Coolify pre-deploy
  hook (NOT in `postinstall`).
- **Tests:**
  - Unit (lib/) — **Vitest**.
  - Integration (Route Handlers) — Vitest with mocked Turnstile / SES / Slack.
  - E2E (single happy path) — **Playwright** against the preview URL.
- **Lint** — **Biome** (formatter + linter) OR ESLint flat config — pick one early.
- **Docker image** — multi-stage build off `node:22-alpine`, final stage runs
  `node server.js` from Next.js `output: 'standalone'`. Image size target < 220 MB.

## 9. Migration tasks from prototype

In rough order. Tasks fanning out into pull requests:

1. **Scaffold** Next.js 16 + Tailwind v4 + shadcn init + Biome.
2. **Copy `public/assets/`** verbatim from prototype.
3. **Port styles.css → component styles + globals.css `@theme`** —
   see [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md).
4. **Port sections** to RSC components. One PR per section keeps reviews small:
   Nav, Hero, Vision, Ecosystem, Facilities, Partners, Timeline, Closing, Footer.
5. **Port VoiceAgent** as a client component using shadcn `Dialog` + `Tabs`.
6. **Port Orb** to R3F (`<Canvas>` + `<OrbMesh>` + `<Particles>`).
7. **Wire `/api/leads`** — Drizzle + SES + Slack. Stub voice transcript with empty string.
8. **Wire `/api/newsletter`** — same table, `source='hero-email'`.
9. **Wire `/api/voice/session`** — OpenAI ephemeral token mint.
10. **Wire WebRTC client** + tool-call handlers — see voice spec.
11. **Rate limit** all three routes.
12. **E2E test** the happy path.
13. **PDPA / privacy notice** copy and link.
14. **Cloudflare DNS** — `oriental.mereka.io` A/AAAA → Coolify origin, orange-cloud on.
    Configure Turnstile widget + WAF rules. See [`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md).
15. **Infisical project** — create `oriental-microsite` project with `prod`, `staging`, `dev`
    environments and populate the variable contract above.
16. **Coolify service** — create the service, wire to GitHub repo, attach the Infisical
    machine identity, set up the deploy webhook.
17. **Soft launch** with internal Mereka team submitting test leads.

See [`09-LAUNCH-CHECKLIST.md`](./09-LAUNCH-CHECKLIST.md) for QA gates.
