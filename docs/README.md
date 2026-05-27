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
| 07 | [`07-DATA-MODEL.md`](./07-DATA-MODEL.md) | Eng | Postgres schema, indexes, lead lifecycle |
| 08 | [`08-COMPONENT-MAP.md`](./08-COMPONENT-MAP.md) | Eng | Prototype DOM → shadcn primitive mapping |
| 09 | [`09-LAUNCH-CHECKLIST.md`](./09-LAUNCH-CHECKLIST.md) | QA, Eng, PM | Pre-launch gates and post-launch monitoring |
| 10 | [`10-ROADMAP.md`](./10-ROADMAP.md) | PM | What's deferred, sequencing, dependencies |
| 11 | [`11-INFRASTRUCTURE.md`](./11-INFRASTRUCTURE.md) | Eng, DevOps | Coolify + Cloudflare + Infisical — deploy, secrets, DNS, monitoring |

## Source of truth

The **prototype** (`index.html` + `microsite.jsx` + `voice-agent.jsx` + `voice-orb-3d.jsx`
+ `styles.css` + `assets/`) is the visual + interaction reference. When this
doc and the prototype disagree on appearance, prototype wins; when they
disagree on intent, this doc wins.

## Key decisions already made

- **Domain** — `oriental.mereka.io`. The bare `mereka.io` → `corporate.mereka.io` (301).
- **Stack** — Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui
- **Hosting** — Coolify on Mereka infrastructure. Single Docker service, Next.js standalone output.
- **Edge / DNS / TLS / WAF** — Cloudflare in front of the Coolify origin (orange-cloud, Full Strict).
- **Bot / abuse protection** — Cloudflare Turnstile on every intake POST (mandatory, server-verified).
- **Secrets** — Infisical at `secrets.mereka.io`. Nothing in `.env` files, nothing in code. Coolify pulls at deploy time via a machine identity.
- **Voice** — OpenAI Realtime API via ephemeral tokens, WebRTC client.
- **Database** — Postgres (Supabase or Neon, TBD). Single `leads` + `lead_events`.
- **Email** — AWS SES (transactional). Slack mirror to `#partner-intake`.
- **3D** — `three` + `@react-three/fiber` + `@react-three/drei`.
- **No auth** on the public site. Internal CRM is a separate workstream.

## Open stakeholder questions

Tracked in [`10-ROADMAP.md`](./10-ROADMAP.md) §Blockers. Highest-priority:

1. Final canonical bios for **Chewi, Lala, Jey, Gurpreet, AVI, Ambika, Nadia**
   (name spelling, official title, headshot).
2. Official **Biji-biji** and **CIMB** SVG logos for the footer partner row.
3. **Privacy notice** copy and PDPA compliance review.
4. Confirmed **opening date** in 2027 (currently approximate).
5. Lead **routing escalation policy** when the named owner is OOO.

---

*Last revised — handover compile, 2026-05-27.*
