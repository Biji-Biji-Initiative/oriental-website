# 03 — Design Specification

Visual + interaction reference. Everything here is implemented in the prototype —
this doc lifts it out so engineering doesn't have to read CSS to find it.

---

## 1. Brand

Mereka Design System (Anchor Blue / Strategy Teal / Off Black). Tokens are
defined in `assets/mereka.css` in the prototype and must move into the
Tailwind v4 `@theme` block (see [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) §4).

## 2. Colour tokens

| Token | Hex | Role |
|---|---|---|
| `--color-mk-off-black` | `#100d18` | Primary text on light, background on dark sections |
| `--color-mk-cream` | `#f6f4ef` | Page background, surfaces on dark |
| `--color-mk-anchor-blue` | `#1f3f7c` | Primary accent — links, CTAs, partner segment |
| `--color-mk-strategy-teal` | `#2d6a7a` | Secondary accent |
| `--color-mk-horizon` | `#c9d5ec` | Soft fill, italic accent text on dark |
| `--color-mk-line` | `rgba(16,13,24,0.08)` | Hairlines, dividers |

### Accent palettes (Tweak)

| Tweak | `--color-mk-anchor-blue` becomes |
|---|---|
| `anchor` (default) | `#1f3f7c` |
| `horizon` | `#4a6db0` |
| `mono` | `#100d18` |

In production these are configuration flags exposed via the Mereka-admin app,
not user-visible tweaks. They exist so the brand can re-tune the accent
without a code deploy.

## 3. Type

| Family | Use |
|---|---|
| **Poppins** (300/400/500/600) — self-hosted | Body, UI, display |
| **Fraunces** (300 italic) — Google Fonts | Editorial italic accents within headlines |
| Inter | Reserve only — currently unused |

Display sizes (desktop):

| Role | Size / line-height | Weight |
|---|---|---|
| Hero H1 | clamp(48px, 7.6vw, 112px) / 0.92 | 500 |
| Section H2 | clamp(40px, 5.4vw, 80px) / 0.95 | 500 |
| Sub-H3 | 24–32 / 1.15 | 500 |
| Body lede | 20 / 1.5 | 400 |
| Body | 16–18 / 1.6 | 400 |
| Eyebrow / tag | 12, tracked +0.12em, uppercase | 500 |
| Marginalia | 13 / 1.4, mono fallback | 400 |

Italic editorial accents use Fraunces 300 italic **inline within an H2**
(e.g. *"for a historic building."*). Toggleable via Tweak; flag persists.

## 4. Spacing & layout

- Page max width: **1240px** centred, `--wrap` token.
- Section vertical padding: `clamp(96px, 12vw, 180px)` top + bottom.
- Section gutters: `clamp(20px, 4vw, 56px)`.
- Card radius: `--radius-card` = **18px**. Pills: `--radius-pill` = **999px**.
- Hairlines: **1px** at `--color-mk-line`.

## 5. Sections (visual treatment)

| § | Section | Background | Notes |
|---|---|---|---|
| 01 | Hero | Photo backdrop `orientalhero2.png` with soft dark veil | Four corner labels (TL/TR/BL/BR). CTA + email capture stacked centre. |
| 02 | Vision | Cream | Two-column with marginalia gutter. Caption photo strip (520px tall) below. |
| 03 | Ecosystem | Off-black | 5 cells, 3-col grid → 2 → 1. Per-cell hover lift. |
| 04 | Facilities | Cream | Three sub-bands: Audiences (8), Pillars (5), Highlight Spaces (5 with photos). |
| 05 | Partners | Off-black | 5 archetype cards + "Especially relevant if…" callout. |
| 06 | Timeline | Cream | Horizontal 3-step. Hover bumps `data-progress`. |
| – | Closing | Photo + dark veil | Final emotional close + voice CTA. Footer attached. |
| – | Footer | Off-black | 3-col grid + signature row. |

## 6. Motion

- **Reveal on scroll** — opacity 0 → 1, translateY 12px → 0, 600ms ease-out.
  Triggered by `IntersectionObserver` at 10% threshold.
- **Nav** — solid background fades in after 30px scroll.
- **Voice rail** — appears after 720px scroll. Pulses softly.
- **Timeline** — hovering a step animates the progress fill.
- **Orb** — RAF animation at ~60fps. State-tinted: idle / listening / speaking / thinking.
- **`prefers-reduced-motion: reduce`** — disables all of the above; orb falls
  back to a static gradient sphere.

## 7. Interaction patterns

| Element | Behaviour |
|---|---|
| Voice CTA buttons | Trigger voice modal. SPACE keyboard shortcut also opens it. |
| Ecosystem cells, pillar rows, space cards, partner cards | All clickable, opens voice modal with `intent` segment prefilled. |
| Hero email | Inline validation; on success collapses to confirmation chip with "Take 2 minutes →" link to open form mode prefilled. |
| ESC | Closes voice modal. |
| Tab focus | Visible focus ring (2px `--color-mk-anchor-blue` outline at 2px offset). |

## 8. Voice modal layout

| Region | Contents |
|---|---|
| **Left rail** | Segment list (8 entries — see [`05-VOICE-AGENT-SPEC.md`](./05-VOICE-AGENT-SPEC.md)). Each cell is a tappable card. |
| **Centre stage** | Mode toggle (Voice / Form), then either the orb + utterance + tour topics (Voice) or the 4-field form (Form). |
| **Right rail** | "Captured" tab + "Transcript" tab. Shows lead summary as it accumulates. "Send to Mereka" CTA at bottom when ready. |
| **Top-right** | Close (X). |

Modal frame: rounded 22px, dark backdrop blur, max-width 1340px, max-height 920px,
on mobile becomes full-screen.

## 9. Breakpoints

| Tier | Range | Key changes |
|---|---|---|
| **Desktop** | > 1180px | Default layout. |
| **Tablet** | ≤ 1180px | Section padding tightens. Voice agent right rail collapses to 260px. |
| **Medium** | ≤ 960px | Nav menu hides — only brand + Talk to Mereka pill remain. Partners stack 1-col. Voice agent stacks vertically; segment rail becomes horizontal scroll. |
| **Mobile** | ≤ 640px | Hero stacks. All grids 1-col. Hero email row stacks vertically. Voice agent typography shrinks. |
| **Small** | ≤ 420px | Nav padding shrinks. Orb shrinks to 140px. |

## 10. Accessibility (WCAG 2.2 AA)

- All photos that carry meaning have `alt`. Hero `alt=""` (decorative, has
  copy overlay).
- Colour contrast checked: Anchor Blue on Cream = 8.2:1 (AAA);
  Cream on Off Black = 17.6:1 (AAA).
- Voice modal traps focus; restores focus to trigger on close.
- Live regions: voice utterance announced via `aria-live="polite"`.
- All clickable visual cards (ecosystem cell, pillar row, space, partner) have
  explicit `role="button"` + `tabindex="0"` + Enter/Space handlers in production.
  In the prototype these are `<div onClick>` for prototyping speed — **fix in
  the port**.
- Form labels associated with inputs. Error messages tied via `aria-describedby`.

## 11. Image content guidance

The hero, vision strip, space cards, and closing all use real photography.
Production launch needs:

| Slot | Current placeholder | Action |
|---|---|---|
| Hero | `assets/orientalhero2.png` | Verify rights for `oriental.mereka.io` use. |
| Vision strip | `assets/07-building-context.jpg` | Same. |
| Space 01 Commons | `81_agora_world_cafe_evening_*.png` | Same. |
| Space 02 Academy | `2026-05-04-05-academy-tomorrow-2-v2.png` | Same. |
| Space 03 Events | `16-buy-social-showcase.png` | Same. |
| Space 04 Tech demo | `05-sustainability-workshop.png` | Same — verify it represents tech, not sustainability, or swap. |
| Space 05 Social enterprise | `20-ngo-finance-guild.png` | Same. |
| Closing | `assets/01-hero-welcome.png` (via CSS) | Same. |

Recommended: commission a small photo set specifically for the launch.
See [`10-ROADMAP.md`](./10-ROADMAP.md).
