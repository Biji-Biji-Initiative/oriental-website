# 08 — Component Map

Prototype DOM → production component. Use this table when porting; one row =
one port task.

The prototype is HTML + JSX hand-written for prototyping speed. The
production app uses **shadcn/ui** primitives where they fit and bespoke
components where the design diverges from anything shadcn ships.

---

## Section components

| Prototype (`microsite.jsx`) | Production path | shadcn primitives used | Notes |
|---|---|---|---|
| `<Nav>` | `components/nav/SiteNav.tsx` | none | Client component (scroll listener + IntersectionObserver). |
| `<Hero>` | `components/sections/Hero.tsx` | `Button` | Server. Hero photo is `<Image priority>`. Email capture is a small client island. |
| `<HeroEmailCapture>` | `components/sections/HeroEmailCapture.tsx` | `Input`, `Button` | Client. Calls `/api/newsletter`. |
| `<Vision>` | `components/sections/Vision.tsx` | none | Server. |
| `<Ecosystem>` | `components/sections/Ecosystem.tsx` | `Card` (for cells) | Cells trigger the voice modal via context. |
| `<Facilities>` | `components/sections/Facilities.tsx` | `Card` | Three sub-bands. Server, with thin client wrappers for click handlers. |
| `<Partners>` | `components/sections/Partners.tsx` | `Card` | |
| `<Timeline>` | `components/sections/Timeline.tsx` | none | Client (hover state). |
| `<Closing>` | `components/sections/Closing.tsx` | `Button` | |
| `<Footer>` | `components/sections/Footer.tsx` | none | Server. |
| `<VoiceRail>` | `components/nav/VoiceRail.tsx` | none | Client (scroll-trigger). |

## Voice agent

| Prototype (`voice-agent.jsx`) | Production path | shadcn primitives | Notes |
|---|---|---|---|
| `<VoiceAgent>` | `components/voice-agent/VoiceAgentDialog.tsx` | `Dialog` (full-screen variant) | Top-level modal. |
| Mode toggle (Voice / Form) | inside `VoiceAgentDialog` | `Tabs` | Two tabs, shared state. |
| Segment rail (left) | `components/voice-agent/SegmentRail.tsx` | `Card` per item | On mobile: horizontal scroll. |
| `<VoiceMode>` | `components/voice-agent/VoiceMode.tsx` | — | Orb + utterance + tour topics. |
| `<FormMode>` | `components/voice-agent/FormMode.tsx` | `Input`, `Textarea`, `Label`, `Button` | 4-field intake. Inline validation. |
| Captured / Transcript switcher (right rail) | `components/voice-agent/CapturedRail.tsx` | `Tabs` | "Captured" and "Transcript" tabs. |
| `<SubmittedView>` | `components/voice-agent/SubmittedView.tsx` | — | The "Sent to <First name>" screen. |

## Orb

| Prototype | Production path | Notes |
|---|---|---|
| `<VoiceOrb>` (Canvas 2D, in `voice-agent.jsx`) | *retired* | Superseded by `OrbCanvas`. Keep the 2D version commented out for reference. |
| `MerekaOrb3D` (`voice-orb-3d.jsx`) | `components/orb/OrbCanvas.tsx` | React Three Fiber. Lazy-loaded via `next/dynamic({ ssr: false })`. |
| `<MiniOrb>` (SVG) | `components/orb/MiniOrb.tsx` | Pure SVG. Used in all CTAs. |

## Shared / utility

| Prototype | Production path | Notes |
|---|---|---|
| `<Icon>` (SVG sprite-in-JSX) | `components/ui/Icon.tsx` | Same; consider Iconify if the set grows. |
| `TWEAK_DEFAULTS` block | *removed* | Tweak system was prototype-only. In production these become real config or are removed. |
| `<TweaksPanel>` (and friends) | *removed* | |
| `<image-slot>` web component | *removed* | Was loaded but never used. |
| `_reset.html` | *removed* | Dev utility. |

## State management

The prototype uses **prop-drilling + context-less `onVoice` callbacks**. In
production, lift modal open-state into a small context:

```ts
// app/(site)/voice-context.tsx
'use client';

type VoiceContextValue = {
  open: (intent?: Segment, prefill?: { email?: string }) => void;
  close: () => void;
};

export const VoiceContext = createContext<VoiceContextValue | null>(null);
```

Wrap the page in `<VoiceProvider>` (client). Any server component below can
still render — it just hands a server-rendered "click here" anchor, and the
client island reaches into `useVoice()` to open the modal.

## Form validation

Use **react-hook-form + zod resolver**. The same zod schemas from
`lib/schemas.ts` validate on the client and the server.

## Toasts

shadcn's `Toaster` mounted in `app/(site)/layout.tsx`. Toast on:

- Voice unavailable / fallback to form
- `429 rate_limited`
- `403 turnstile_failed` ("Couldn't verify — please refresh.")
- Successful submission (the modal also visibly switches to `<SubmittedView>`)

## Accessibility port notes

The prototype uses `<div onClick>` extensively on the ecosystem cells, pillar
rows, space cards, and partner cards. **In production these MUST become
`<button type="button">` elements** with proper focus rings and Enter/Space
behaviour. shadcn's `Card` accepts an `asChild` pattern that makes this clean:

```tsx
<Card asChild>
  <button type="button" onClick={() => openVoice('education')}>
    {…}
  </button>
</Card>
```
