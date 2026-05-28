# 10 — Roadmap

Everything that **isn't** in the M1+M2 launch scope. Use this to plan the
months after public launch.

---

## Blockers — must resolve before public launch

| # | Item | Owner | Notes |
|---|---|---|---|
| B1 | Confirm name spelling, official title, and headshot for **Chewi, Lala, Jey, Gurpreet, AVI, Ambika, Nadia** | Mereka People | Drives `SEGMENTS` map. |
| B2 | Brand approval for **Biji-biji Initiative** and **CIMB** footer logo usage | Brand / partnerships | Runtime assets are now sourced under `public/assets/brand/`; provenance is in [`ASSET-SOURCES.md`](./ASSET-SOURCES.md). |
| B3 | **PDPA privacy notice** copy + hosted page | Legal | Required link in the voice modal and footer. |
| B4 | Photography rights for every shipped image | Brand | Per [`04-CONTENT-INVENTORY.md`](./04-CONTENT-INVENTORY.md). |
| B5 | Confirm **2027 opening date** (month if known) | PM | Currently says "Opening 2027". |
| B6 | Data-plane launch proof for Convex ingest and owner notifications | Eng | Runtime uses Convex, not Postgres; see [`07-DATA-MODEL.md`](./07-DATA-MODEL.md) for schema truth. |

---

## M3 — Internal CRM (post-launch, weeks 2–6)

Separate workstream, separate repo, behind auth.

- Read view of `leads` filtered by `segment` / `status`.
- Owner can move `status` along the lifecycle.
- Notes per lead → `lead_events` (`kind='note_added'`).
- "Reply" button drafts an email to the lead's address with the routed
  owner's signature.
- Calendar booking handoff — drop the lead into Cal.com.
- Bulk export (CSV) for weekly review meetings.

---

## M4 — Polish (weeks 4–12)

### Analytics

- Cloudflare Web Analytics already on (cookieless).
- Add **event tracking** through a small server-side analytics endpoint:
  `/api/track` accepting `{ event, props }`. No third-party JS.
- Events: `voice_opened`, `voice_session_started`, `voice_submitted`,
  `form_submitted`, `email_submitted`, `segment_picked`.
- Funnel dashboard in the Mereka-admin app.

### A/B copy testing

- Two hero headlines, one ecosystem H2 variant.
- Implemented server-side via a deterministic hash of `ip_hash` (no cookies).

### BM (Malay) translation

- Top-of-page language switcher (EN / BM).
- All strings live in `content/` JSON files. The voice agent's system prompt
  is also bilingual; OpenAI Realtime can switch language per session.

### Press kit / media page

- `/press` — locked behind a soft passphrase.
- Hi-res renders, building exterior photos, partner logos, founder bios,
  one-pager PDF.

### Newsletter digest

- Cron once a week pulls `source='hero-email'` leads from the last 7 days
  and emails a summary to `team@mereka.io`.

---

## M5 — Beyond launch

Speculative; not committed:

- **Event calendar** — once programmes are happening, surface them.
- **Tenant directory** — once tenants are in, list them.
- **Virtual tour** — 3D walkthrough of Levels 2–4.
- **Application portal** — structured tenancy / programme applications
  (replacing the freeform intake for serious leads).
- **Mereka SSO** — bring the partner intake under one identity surface with
  the rest of Mereka's tools.

---

## Tech debt to address opportunistically

- The prototype's `<div onClick>` interactive elements must become real
  buttons in the port — flagged in [`08-COMPONENT-MAP.md`](./08-COMPONENT-MAP.md).
- The orb's WebGL scene should respect `prefers-reduced-motion` by switching
  to a static gradient sphere — already partially handled, verify in port.
- The hero photo's exact crop is hard-coded in CSS; consider a `<picture>`
  with art-directed sources for portrait orientation on small phones.
- Consider switching from raw SES to a small queue (SQS) so a transient SES
  outage doesn't block lead submission. v1 acceptably saves the lead and
  logs the failure — bump if rate climbs.

---

## Decisions log

A short trail of "we picked X over Y". Add to this rather than rewriting old
decisions.

| Date | Decision | Why |
|---|---|---|
| 2026-05 | Next.js 16 over Astro / SvelteKit | Team familiarity; RSC story for static + dynamic mix. |
| 2026-05 | Coolify over Vercel | Mereka infra standard; cost. |
| 2026-05 | Infisical at `secrets.mereka.io` | Existing org-wide secrets platform. |
| 2026-05 | Cloudflare Turnstile over hCaptcha | Already on Cloudflare; lower friction. |
| 2026-05 | Convex over Postgres + Drizzle for launch intake | Faster managed launch path; current runtime stores leads and lead events through Convex mutations. |
| 2026-05 | shadcn/ui over Mantine / MUI | Aligns with Tailwind v4; least runtime bloat. |
| 2026-05 | Single page, anchored sections | Content fits; routing complexity not justified. |
| 2026-05 | Voice agent dual-mode (Voice + Form) | Accessibility, environment, and trust. |
| 2026-05 | OpenAI Realtime over Vapi / Retell | Direct API; existing Mereka credentials. |
