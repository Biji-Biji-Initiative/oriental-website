# 08 — Component Map

Current production component map after the prototype parity pass. Use this file
to route future homepage and voice changes without reopening the raw prototype
unless visual fidelity is in question.

## Page Composition

| Runtime surface | Production path | Client? | Notes |
|---|---|---:|---|
| Root layout | `app/layout.tsx` | Server | Fonts, metadata, `VoiceProvider`, `SiteNav`, `VoiceRail`, `Toaster`. Uses `connection()` so the root is dynamic. |
| Home page | `app/page.tsx` | Server | JSON-LD and ordered section composition. |
| Nav | `components/site/SiteNav.tsx` | Yes | Scroll background, active-section observer, mobile menu, Space shortcut, voice CTA. |
| Voice rail | `components/site/VoiceRail.tsx` | Yes | Floating voice affordance. |

## Homepage Sections

Most sections live in `components/site/Sections.tsx` to preserve the single-page
story order. Large interactive bands are split out so the main section file does
not own every click target.

| Section | Runtime path | Notes |
|---|---|---|
| Hero | `components/site/Sections.tsx` | Background image, primary `VoiceButton`, `HeroEmailCapture`. |
| Hero email capture | `components/voice-agent/HeroEmailCapture.tsx` | Client island; calls `/api/newsletter`. |
| Vision | `components/site/Sections.tsx` | Static story + building image. |
| Ecosystem | `components/site/Sections.tsx` + `components/site/EcosystemGrid.tsx` | Clickable cells open voice with segment intent. |
| Facilities / Spaces | `components/site/Sections.tsx` + `components/site/FacilitiesBands.tsx` | Audience grid, pillars, and space cards. |
| Partners | `components/site/Sections.tsx` + `components/site/PartnersBands.tsx` | Partner archetype cards and relevant-if list. |
| Timeline | `components/site/Timeline.tsx` | Client hover/focus progress state. |
| Closing | `components/site/Sections.tsx` | Static CTA section. |
| Footer | `components/site/Sections.tsx` | Contact CTA, address, official partner logo row. |

CSS for prototype-parity homepage chrome lives in `app/globals.css` using
component-prefixed class names:

- `.eco-*`
- `.facilities-*`
- `.partner-*`
- `.partners-relevant*`
- `.timeline*`
- `.site-nav__*`
- `.footer-brand*`

## Voice Agent

| Runtime surface | Production path | shadcn primitives | Notes |
|---|---|---|---|
| Voice context | `components/voice-agent/voice-state.tsx` | — | Owns global open state and passes Turnstile site key. |
| Voice button | `components/voice-agent/VoiceButton.tsx` | — | Opens dialog with optional segment/prefill. |
| Dialog shell | `components/voice-agent/VoiceAgentDialog.tsx` | `Dialog`, `Tabs`, `Input`, `Textarea`, `Label` | Segment rail, voice tab, form tab, captured rail, submitted state. |
| WebRTC lifecycle | `components/voice-agent/useRealtimeVoiceSession.ts` | — | Mic, peer connection, data channel, timers, teardown. |
| Turnstile | `components/security/useTurnstile.ts` | — | Script/widget lifecycle and local-dev token fallback. |
| Realtime profile | `lib/voice/profile.ts` | — | Prompt sections, tools, VAD/session defaults. |
| Realtime reducer | `lib/voice/realtime-events.ts` | — | Pure state machine for transcripts, tool calls, route command. |
| Client events | `lib/voice/client-events.ts` | — | Serializes `function_call_output` and optional `response.create`. |

The voice modal is intentionally still a single component because the left rail,
main tab body, captured rail, and submission flow share form state. Split only
when a new behavior boundary emerges.

## Orb

| Runtime surface | Production path | Notes |
|---|---|---|
| Mini orb | `components/orb/MiniOrb.tsx` | Pure SVG. Used in nav, CTAs, and dialog. |

There is no React Three Fiber runtime in the current app. Prototype R3F/WebGL
notes are reference-only until a future PR reintroduces 3D.

## Content And Routing

| Concern | Production path |
|---|---|
| Marketing copy, nav labels, grids, partners, timeline | `lib/content.ts` |
| Segment metadata, owner labels, env mapping | `lib/segments.ts` |
| API request validation | `lib/schemas.ts` |
| Lead persistence | `lib/server/convex.ts`, `convex/leads.ts`, `convex/schema.ts` |
| Notifications | `lib/server/notifications.ts`, `lib/server/smtp.ts` |

## Accessibility Notes

Prototype `div onClick` regions are now real buttons in the key interactive
areas:

- ecosystem cells
- facilities audiences
- facilities pillars
- facilities space cards
- partner cards
- timeline steps

Keep this invariant. New interactive visual cards should be
`<button type="button">` or a semantic link, with visible focus styles in
`app/globals.css`.
