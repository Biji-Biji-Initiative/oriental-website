# 04 — Content Inventory

Every string and asset that ships with the microsite, organised by section.
Use this to brief copywriters, get legal sign-off, and verify that what's in
the production database matches what's on screen.

Copy is **final-draft** in the prototype unless flagged `(DRAFT)` below.

---

## Global

| Slot | Value |
|---|---|
| `<title>` | `Oriental · A future we build together` |
| `<meta name="description">` | Oriental Building — a historic Kuala Lumpur landmark, reactivated as a home for future learning, technology, creativity, and community. Mereka, Biji-biji Initiative, CIMB, and partners are shaping Levels 2 to 4 before the building opens in 2027. |
| `theme-color` | `#100d18` |
| OG image | `/assets/og-image.svg` |
| Favicon | `/assets/favicon.svg` |
| Email (footer + mailto) | `team@mereka.io` |

## Nav

- Brand: `Mereka × ORIENTAL`
- Items: `Vision · Ecosystem · Spaces · Partners · Timeline`
- CTA: `Talk to Mereka` (with pulse dot)

## Section 01 — Hero

| Slot | Copy |
|---|---|
| Corner TL | `Oriental Building` / `Jalan Tun Perak · Kuala Lumpur` |
| Corner TR | `Levels Two–Four` / `Opening 2027` |
| Corner BL | `Status` / `Partner conversations now open` |
| Corner BR | `oriental.mereka.io` / `A founding invitation` |
| Eyebrow | `A new chapter for a historic building` |
| H1 | `Reimagining Oriental. A future we build together.` (italic "A future" / stroke "Oriental.") |
| Lede | Mereka, Biji-biji Initiative, CIMB, and partners are shaping Levels 2 to 4 of Oriental Building into a shared hub for future learning, technology, creativity, culture, and community — in the heart of Kuala Lumpur. |
| Voice CTA primary | `Tell us why you're here` |
| Voice CTA hint | `Speak or type — Mereka will route you to the right team` |
| Voice CTA shortcut | `SPACE` |
| Email capture label | `Just want updates?` |
| Email capture placeholder | `your@email.com` |
| Email capture submit | `Keep me posted →` |
| Email capture success | `Got it. We'll be in touch.` + `Want to tell us more? Take 2 minutes →` |
| Privacy footnote | `End-to-end · private · no recordings kept · routed only to your partner's team at Mereka` |
| Scroll cue | `Scroll` |

## Section 02 — Vision

- Eyebrow: `02 — The Vision`
- H2: `A new chapter for a historic building.`
- Marginalia: `Levels 2 — 4 · Reactivation begins 2026`
- Body (3 paragraphs + 1 italic pull) — see `microsite.jsx` `<Vision>` for verbatim text.
- Photo caption: `Oriental Building` / `Art Deco landmark · Jalan Tun Perak · Kuala Lumpur`

## Section 03 — Ecosystem

Eyebrow: `03 — The Ecosystem`. H2: `Spaces for learning, making, gathering, & testing new ideas.`

| # | Title | Description |
|---|---|---|
| 01 | Public Programme & Event Spaces | Talks, forums, launches, screenings, exhibitions, performances, and public conversations. |
| 02 | Creative Studios & Collaboration Spaces | Making, designing, teaching, prototyping, production, and project-based work. |
| 03 | Technology Showcase & Demo Spaces | Hands-on experiences with AI, digital tools, future skills, digital trust, and emerging technologies. |
| 04 | Workshops & Future Skills Programmes | Youth development, professional upskilling, entrepreneurship, creative learning, and community education. |
| 05 | Innovation & Social Impact Initiatives | NGOs, social enterprises, startups, and mission-driven teams building solutions with community relevance. |

Foot CTA: `Discuss a partnership`.

## Section 04 — Community, Pillars & Spaces

Eyebrow: `04 — Community & Content Pillars`. H2: `Built for communities that should meet more often.`

**Audiences (8):**
Students & youth · Social enterprises & NGOs · MSMEs & working professionals ·
Creative practitioners & cultural communities · Ageing & community groups ·
Educators & programme operators · Technology & innovation partners ·
Institutions & mission-aligned tenants.

**Pillars (5):**
1. Future Readiness & New Economic Opportunities
2. Digital Trust, AI Literacy & Inclusion
3. NGO & Social Enterprise Capability Building
4. MSME & Livelihood Resilience
5. Health, Ageing & Community Wellbeing

**Highlight spaces (4):**

| # | Title | Routes to segment | Image |
|---|---|---|---|
| 01 | Public Commons & Community Lounge | `community` | `spaces/public-commons-community-lounge.jpg` |
| 02 | Academy of Tomorrow Learning Studios | `education` | `2026-05-04-05-academy-tomorrow-2-v2.png` |
| 03 | Flexible Event Spaces | `programme` | `spaces/flexible-event-spaces-forum.jpg` |
| 04 | Social Enterprise & Innovation Spaces | `tenancy` | `16-buy-social-showcase.png` |

CTA per space — see `lib/content.ts` `spaces[].cta`.

## Section 05 — Partners

Eyebrow: `05 — Call for Partners & Tenants`. H2: `Let's build this together.`

Three core partner and tenant categories. Each is a card with a tag, title,
description, and per-segment CTA — full strings in `lib/content.ts` `partners`
array.

| # | Tag | Title | CTA | Intent |
|---|---|---|---|---|
| 01 | TENANCY | Mission-Aligned Tenants | Discuss Tenancy | `tenancy` |
| 02 | EDUCATION | Education & Programme Partners | Propose a Learning Partnership | `education` |
| 03 | TECHNOLOGY | Technology & Innovation Partners | Explore a Technology Showcase | `technology` |

**"Especially relevant if you want to" list (6):**
- Host recurring programmes in the city centre
- Reach students, youth, MSMEs, NGOs, creatives, or community groups
- Showcase technology in a human, hands-on way
- Build public trust around AI, digital tools, and future skills
- Contribute to a heritage-led civic and cultural activation
- Shape the partner mix before the building opens

Note: `No polished proposal needed. Your enquiry routes to the right Mereka team. No public listing. No commitment required.`

## Section 06 — Timeline

Eyebrow: `06 — The Journey Ahead`. H2: `From planning to public activation.`

| Phase | Year | Label | Description |
|---|---|---|---|
| 01 | 2026 | Co-design & Partnerships | Shaping the vision, partner mix, spatial planning, programme models, commercial pathways, and ecosystem opportunities. |
| 02 | 2026–27 | Renovation & Early Activation | Transforming the space into a future-ready hub, with early pilots and partner-led activations. |
| 03 | 2027 | Opening & Public Programmes | Opening with collaborations, workshops, events, exhibitions, technology showcases, cultural activations, and community-driven programmes. |

## Closing

Eyebrow: `Final — More Than a Move`. H2: `More than a move.`

Two paragraph close + final voice CTA (`Start the conversation`).

## Footer

| Slot | Copy |
|---|---|
| Eyebrow | `Get in touch` |
| H2 | `Let's build this together.` |
| Lede | See `<Footer>` `footer__hero-lede`. |
| Primary CTA | `Email · team@mereka.io` |
| Secondary CTA | `Or · Talk to Mereka` |
| Address | `Oriental Building / No. 32, Jalan Tun Perak / 50050 Kuala Lumpur / Malaysia` |
| Partner row | Mereka · Biji-biji Initiative · CIMB (with one-line role each) |
| Meta row | Domain · Phase · Status |
| Signature | `© 2026 · Mereka × Biji-biji Initiative × CIMB` + `Oriental Building · A new chapter for a historic Kuala Lumpur landmark` |

## Voice Agent — overlay copy

The voice agent has its own strings. Source: `voice-agent.jsx` constants
`SEGMENTS`, `GREETING`, `GREETING_CONTEXT`, `CAPTURE_LABELS`. See
[`05-VOICE-AGENT-SPEC.md`](./05-VOICE-AGENT-SPEC.md) for the full inventory.

## Assets

All under `/public/assets/` in production. Each must be re-licensed for
public web use before launch — track in [`10-ROADMAP.md`](./10-ROADMAP.md).

| File | Use |
|---|---|
| `orientalhero2.png` | Hero background |
| `07-building-context.jpg` | Vision strip caption photo |
| `01-hero-welcome.png` | Closing section background |
| `05-sustainability-workshop.png` | Space 04 — Tech demo |
| `16-buy-social-showcase.png` | Space 03 — Events |
| `20-ngo-finance-guild.png` | Space 05 — Social enterprise |
| `2026-05-04-05-academy-tomorrow-2-v2.png` | Space 02 — Academy |
| `81_agora_world_cafe_evening_openai_4e792ccfe15d_20260504-213415_0.png` | Space 01 — Commons |
| `exterior_render_*.png` | Reserve / unused (potential press kit) |
| `oriental hsots.png` | Reserve (rename — has typo, will not ship) |
| `mereka-white.png`, `mereka-symbol-white.png` | Brand marks |
| `brand/biji-biji/biji-biji-logo-*.svg` | Footer Biji-biji primary mark, black/white variants |
| `brand/biji-biji/biji-biji-elaborated-logo-*.svg` | Stored Biji-biji elaborated mark variants |
| `brand/cimb/cimb-symbol.svg` | Footer CIMB square symbol |
| `brand/cimb/cimb-logo-elaborated.svg` | Stored CIMB full logo |
| `brand/mereka/favicon-*.png` | Browser favicon set from canonical Mereka brand assets |
| `og-image.svg`, `favicon.svg` | Legacy browser chrome / OG fallback |
| `fonts/Poppins-*.ttf`, `fonts/Fraunces-*.ttf` | Self-hosted fonts |

## External links

| Anchor | URL | Notes |
|---|---|---|
| Mereka | `https://corporate.mereka.io` | Footer partner row |
| Biji-biji Initiative | `https://biji-biji.com` | Footer partner row |
| CIMB | `https://www.cimb.com` | Footer partner row |
| Map | Google Maps search for `Oriental Building 32 Jalan Tun Perak Kuala Lumpur` | Footer address link |
| Email | `mailto:team@mereka.io` | Primary footer CTA |

## Open content questions

1. Are we comfortable saying "Opens 2027" or do we need to soften to "Opens in 2027" / "Anticipated 2027"?
2. Does "no recordings kept" hold once voice goes live? OpenAI Realtime may
   transiently store audio — confirm with legal before launch.
3. Final spellings + titles for the routed-to people (see [`05-VOICE-AGENT-SPEC.md`](./05-VOICE-AGENT-SPEC.md)).
4. Sign-off on **PDPA privacy notice** copy — where it lives and how it's surfaced.
