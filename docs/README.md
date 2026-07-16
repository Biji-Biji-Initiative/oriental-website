# Oriental Building Microsite — Handover Package

This folder is the **complete handover** from design / prototype phase to the
production build (**Next.js 16 · React 19 · Tailwind v4 · shadcn/ui native**).

**Coding agents** should start at [`../AGENTS.md`](../AGENTS.md) for the live repo map, commands, and implementation drift notes, then use the docs below for product intent.

Start here. Each document below is self-contained — read in order on first pass,
then use as reference.

---

## Contents

| # | Document | Audience | Purpose |
|---|---|---|---|
| 00 | [`../HANDOVER.md`](../HANDOVER.md) | Everyone | One-page summary + this index |
| 01 | [`01-PRD.md`](./01-PRD.md) | PM, Eng, Design | Product Requirements — what we are building & why |
| 02 | [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) | Eng | Stack, app layout, infra, env, rendering strategy |
| 03 | [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md) | Eng, Design | Tokens, type, motion, breakpoints, accessibility |
| 04 | [`04-CONTENT-INVENTORY.md`](./04-CONTENT-INVENTORY.md) | Content, PM | Every string, every asset, every link |
| 05 | [`05-VOICE-AGENT-SPEC.md`](./05-VOICE-AGENT-SPEC.md) | Eng, AI | OpenAI Realtime wiring, tools, prompt, fallbacks |
| 06 | [`06-API-CONTRACTS.md`](./06-API-CONTRACTS.md) | Eng | Route Handlers, request/response shapes, errors |
| 07 | [`07-DATA-MODEL.md`](./07-DATA-MODEL.md) | Eng | Convex schema, lead persistence, lead lifecycle |
| 08 | [`08-COMPONENT-MAP.md`](./08-COMPONENT-MAP.md) | Eng | Production component map after prototype parity pass |
| 09 | [`09-LAUNCH-CHECKLIST.md`](./09-LAUNCH-CHECKLIST.md) | QA, Eng, PM | Pre-launch gates and post-launch monitoring |
| 10 | [`10-ROADMAP.md`](./10-ROADMAP.md) | PM | What's deferred, sequencing, dependencies |
| 11 | [`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md) | Eng, DevOps | Coolify + Cloudflare + Infisical — deploy, secrets, DNS, monitoring |
| 12 | [`12-CHAT-RELEASE-RUNBOOK.md`](./12-CHAT-RELEASE-RUNBOOK.md) | QA, Eng | Evergreen exact-SHA release governance, verification, timing, and rollback |
| 13 | [`13-VOICE-INSTANT-RELEASE-SPEC.md`](./13-VOICE-INSTANT-RELEASE-SPEC.md) | QA, Eng, AI | Instant voice contracts, experiment gates, evidence mapping, and rollback |
| 14 | [`14-PERFORMANCE-BUDGET.md`](./14-PERFORMANCE-BUDGET.md) | QA, Eng | Mobile LCP, CLS, initial JavaScript, and accessibility budgets |
| ASSETS | [`ASSET-SOURCES.md`](./ASSET-SOURCES.md) | Eng, Brand | Runtime logo/favicon provenance and approval notes |

## Source of truth

The **prototype** (`index.html` + `microsite.jsx` + `voice-agent.jsx` + `voice-orb-3d.jsx`
+ `styles.css` + `assets/`) is the visual + interaction reference. When this
doc and the prototype disagree on appearance, prototype wins; when they
disagree on intent, this doc wins.

## Key decisions already made

- **Domain** — `oriental.mereka.io`. The bare `mereka.io` → `corporate.mereka.io` (301).
- **Stack** — Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui
- **Hosting** — Coolify on Mereka infrastructure. Single Docker service, Next.js standalone output.
- **Edge / DNS / TLS** — Cloudflare authoritative DNS points directly to Coolify Traefik, which terminates TLS; the current records are DNS-only.
- **Bot / abuse protection** — Turnstile is optional for form/newsletter intake; voice uses signed session credentials and Redis-backed rate limits.
- **Secrets** — Infisical at `secrets.mereka.io` is canonical. Coolify and the host-managed staging `.env` hold explicitly reconciled runtime copies; nothing secret is committed.
- **Voice** — OpenAI Realtime API via ephemeral tokens, WebRTC client.
- **Database** — Convex for launch lead and lead-event persistence.
- **Email** — AWS SES/SMTP fallback (transactional). Slack mirror to `#tech-team-test` through bot-token delivery for smoke testing, webhook fallback only.
- **Rate limiting** — Redis-backed shared limiter in production, memory fallback only for local/degraded mode.
- **Observability** — structured JSON route logs in Coolify, Sentry project `oriental-website`, Slack ops alerts to `#tech-team-test`, and token-gated `/admin/session-review`.
- **3D** — Not installed in the current runtime; `MerekaMiniMark` is the canonical SVG mark. Prototype R3F notes are reference-only.
- **No auth** on the public site. Internal CRM is a separate workstream.

## Open stakeholder questions

Tracked in [`10-ROADMAP.md`](./10-ROADMAP.md) §Blockers. Highest-priority:

1. Final canonical bios for **Chewi, Lala, Jey, Gurpreet, AVI, Ambika, Nadia**
   (name spelling, official title, headshot).
2. **Privacy notice** copy and PDPA compliance review.
3. Confirmed **opening date** in 2027 (currently approximate).
4. Lead **routing escalation policy** when the named owner is OOO.

---

*Last revised — release governance and Realtime model alignment, 2026-07-16.*
