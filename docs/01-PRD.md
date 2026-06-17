# 01 — Product Requirements Document

**Product:** Oriental Building Partner Intake Microsite
**Owner:** Mereka
**Partners:** Biji-biji Initiative · CIMB
**Status:** Planning & partnerships phase (2026). Building opens 2027.
**Version:** 1.0 — handover

---

## 1. Problem

A historic Kuala Lumpur landmark — the **Oriental Building** — is being
reactivated. Mereka, Biji-biji Initiative, CIMB, and partners are shaping
**Levels 2 to 4** of the building into a shared hub for future learning,
technology, creativity, culture, and community.

The building opens in 2027. Until then, **the public-facing job is to
attract the right partners** — tenants, programme operators, education
partners, technology partners, cultural and community collaborators —
**before** the doors open, so the space opens with a credible partner mix
rather than empty floors.

There is no central, structured way today for someone who hears about the
project to (a) understand what it is, and (b) reach the right person at
Mereka. Existing channels are scattered: Instagram DMs, generic
team@ email, word of mouth.

## 2. Goal

Build a **single landing experience at `oriental.mereka.io`** that:

1. Communicates the vision, ecosystem, spaces, and partner archetypes
   in a way that feels civic, considered, and credibly future-facing.
2. Captures partner enquiries via a **dual-mode intake**:
   **Voice** (AI agent, OpenAI Realtime) or **Form** (4-field).
3. **Routes** each enquiry to the right Mereka team member based on
   partner segment.
4. Logs all leads into a single CRM table with full transcript or form
   payload, queued for human follow-up within **2 working days**.

## 3. Non-goals

- Not a booking system. No rooms are bookable yet.
- Not a tenant portal. There is no logged-in surface.
- Not the corporate Mereka site. `mereka.io` and `corporate.mereka.io`
  remain authoritative for the organisation.
- Not a press kit / media library — see [`10-ROADMAP.md`](./10-ROADMAP.md).
- Not an event calendar — see [`10-ROADMAP.md`](./10-ROADMAP.md).

## 4. Audiences

In priority order:

1. **Tenancy prospects** — studios, social enterprises, mission-aligned brands
   looking for long-term city-centre space.
2. **Programme & education partners** — academic institutions, training
   providers, social enterprises running learning programmes.
3. **Technology & innovation partners** — companies with AI, digital trust,
   future-work, or creative tech to showcase.
4. **Cultural & community partners** — collectives, civic groups, cultural
   practitioners.
5. **Press, investors, and curious public** — lighter touch; route to the
   "Other" segment.

## 5. User stories

| As a… | I want to… | So that… |
|---|---|---|
| Tenancy prospect | Understand quickly that long-term space is on offer | I know I'm in the right place |
| Programme operator | Pitch a recurring programme | I get a spot in the launch mix |
| Tech partner | See whether technology showcases are welcomed | I propose a demo lab |
| Cultural partner | See examples of cultural activation space | I propose an exhibition or residency |
| Casual visitor | Get updates without committing | I'm in the loop when more is announced |
| Mereka team | Receive a structured lead routed to me with full context | I can follow up in 2 working days |

## 6. Information architecture

Single-page scroll. Anchored sections in order:

1. **Hero** — building photograph, headline, sub-lede, two CTAs (voice + email).
2. **Vision** — narrative intro + caption photo.
3. **Ecosystem** — 5-cell grid of planned uses.
4. **Community & Pillars** — audiences (8) + content pillars (5) + highlight spaces (5).
5. **Partners** — 5 partner archetypes, each with its own CTA + segment routing.
6. **Timeline** — 3 phases: 2026 (co-design) · 2026–27 (renovation & early
   activation) · 2027 (opening).
7. **Closing** — emotional close + voice CTA.
8. **Footer** — email, voice CTA, address, partners, site meta.

## 7. Conversion surfaces

Three surfaces lead to the same `leads` table, distinguished by `source`:

| Surface | `source` | Where | Behaviour |
|---|---|---|---|
| Hero email capture | `hero-email` | Hero | Newsletter-style. On submit shows inline "Take 2 minutes →" link to open Voice Agent in **form mode** with email prefilled. |
| Voice agent — voice | `voice` | Modal | OpenAI Realtime conversation; tool calls populate the lead. |
| Voice agent — form | `form` | Modal | 4-field form (name, email, org, message) + segment picker. |
| Footer email | `footer-email` | Footer | Direct `mailto:team@mereka.io`. (Will move to API-backed when SES live.) |

## 8. Success metrics (post-launch)

| Metric | Target (90 days post-launch) |
|---|---|
| Qualified leads logged | ≥ 60 |
| Voice-mode completion rate | ≥ 40% of started sessions |
| Form-mode completion rate | ≥ 65% of opened forms |
| Time-to-first-touch by Mereka team | ≤ 2 working days for 95% of leads |
| Conversion to "qualified" status | ≥ 25% |
| Mobile traffic share | tracked; no target |

Instrumentation deferred until [`10-ROADMAP.md`](./10-ROADMAP.md) §Analytics
is unblocked.

## 9. Constraints

- **Brand** — Mereka Design System (Anchor Blue, Strategy Teal, Off Black,
  Poppins, Fraunces). See [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md).
- **Languages** — English only at launch. BM (Malay) deferred.
- **Compliance** — Malaysian PDPA. Privacy notice required at intake.
- **Performance** — LCP < 2.5s on mid-tier mobile over 4G. Hero photo
  preloaded; below-fold images lazy.
- **Accessibility** — WCAG 2.2 AA. Keyboard nav, focus rings,
  `prefers-reduced-motion`, alt text on photo content.
- **Cost** — OpenAI Realtime is metered. Cap budget via session length
  limit (150s current client cap), 20s idle timeout, and the per-IP voice
  limiter (`VOICE_SESSION_DAILY_LIMIT`, default 80) backed by Redis in production.
  Page load may import the voice bundle, but Realtime session pre-minting happens
  only for returning visitors with granted microphone permission or after a
  first-time visitor grants access.

## 10. Release plan

| Milestone | Scope |
|---|---|
| **M1 — Static** | Sections 1–6 + Closing + Footer ship as static. Voice agent shows a scripted demo. Hero email writes to Convex. |
| **M2 — Live voice** | OpenAI Realtime wired. Tool-call flow populates lead structure. SES email + Slack ping live. |
| **M3 — Internal CRM** | Mereka-admin app reads `leads` table, lets owners update `status`. Separate workstream. |
| **M4 — Polish** | Analytics, A/B copy, BM translation, press kit. |

M1 + M2 are the **launch gate**. M3 and M4 are post-launch.
