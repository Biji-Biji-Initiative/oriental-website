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
| Dialog shell | `components/voice-agent/VoiceAgentDialog.tsx` | `Dialog`, `Form`, `Input`, `Textarea`, `Button` | Layout, lead submission, review snapshots, handoff-context sync, idle-goodbye wiring. |
| Realtime runtime | `components/voice-agent/useVoiceRuntime.ts` | — | Owns reducer state (segment/captured/transcript), command dispatch over the data channel, typed-message append, and the voice toast policy. |
| Voice stage | `components/voice-agent/VoiceSessionStage.tsx` | `Input`, `Button`, `Chip` | Orb, status chips, live captions, story cues, typed-chat composer while voice is live. |
| Handoff panel | `components/voice-agent/HandoffPanel.tsx` | `Form`, `Input`, `Textarea`, `Button` | Editable lead form, completion chips, live notes transcript. |
| WebRTC lifecycle | `components/voice-agent/useRealtimeVoiceSession.ts` | — | Mic, peer connection, data channel, idle warning + goodbye + max timers, teardown. |
| Audio level | `components/voice-agent/useVoiceAudioLevel.ts` | — | WebAudio analyser → `--voice-level` CSS variable on the orb; reduced-motion aware, no per-frame React renders. |
| Turnstile | `components/security/useTurnstile.ts` | — | Script/widget lifecycle and local-dev token fallback. |
| Realtime profile | `lib/voice/profile.ts` | — | Prompt sections, tools, semantic-VAD/transcription/session defaults. |
| Realtime reducer | `lib/voice/realtime-events.ts` | — | Pure state machine for transcripts, tool calls, capture grounding, error classification, route command. |
| Client events | `lib/voice/client-events.ts` | — | Serializes tool outputs, typed user messages, typed interruptions, handoff/reconnect context, `response.create`. |
| Review snapshots | `lib/voice/review-snapshot.ts` | — | Builds and posts signed session snapshots to `/api/voice/debug`. |

The dialog stays one component for layout and submission; realtime behavior
lives in `useVoiceRuntime` and the session/audio hooks. Extend those hooks
rather than re-inlining realtime state into the dialog.

## Orb

| Runtime surface | Production path | Notes |
|---|---|---|
| Mini orb | `components/orb/MiniOrb.tsx` | Pure SVG. Used in nav, CTAs, and dialog. |
| Living orb chrome | `.voice-orb*` in `app/globals.css` + `components/voice-agent/VoiceSessionStage.tsx` | Aurora rotation, idle breathing, voice-level ripples driven by `--voice-level`; inert under reduced motion. |

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
