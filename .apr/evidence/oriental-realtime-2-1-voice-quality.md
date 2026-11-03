# Evidence — Realtime 2.1 voice-quality release

## Scope

- Exact review target: the current `fix/realtime-2-1-voice-quality` pull
  request head. Merge and deployment use a fresh exact SHA; no prose SHA is
  runtime authority.
- The live staging transcript was reviewed only through the access-controlled
  session record. It showed 2.1/Coral at `1.28`, a direct clear request that
  received conversational acknowledgement without a tool action, English
  preference that initially drifted, and an incomplete handoff despite captured
  details. No transcript or contact values are included here.

## Implementation map

- `lib/voice/profile.ts` makes spoken delivery relaxed, brief, English-first,
  and explicitly directs `clear_fields` for “clear the form” wording.
- `lib/voice/realtime-events.ts` recognises only unambiguous all-field clear
  intent. `useVoiceRuntime.ts` applies the existing reducer clear transition on
  completed speech when the model omits its required action, revokes browser
  memory through the normal callback, and reports PII-free tool timing without
  emitting a fictitious provider function result. The client accepts that
  transition only when the reducer emits its own successful `clear_fields`
  result, rather than inferring success from selected state fields.
- `scripts/lib/release-governance.ts`, session minting, health, examples, and
  operator documentation align both governed lanes to Realtime 2.1. The
  production deployer has a separately tested, opt-in previous-control health
  bridge solely for this transition.
- `NebulaM.tsx` reduces point size, alpha, glow, and active-audio gain; the
  particle field is reduced from 2,100 to 1,200 points so the M stays legible
  when audio is active.

## Executable evidence

- Focused voice, brand, health, model, session, and deployment suite: 1,667
  tests passed before PR creation.
- Release/deployment/deadline suite: 43 tests passed. The deadline test now
  waits for its actual child startup instead of using a 300 ms race, while
  retaining its process-group kill assertion.
- The clear fallback regression test first commits the spoken clear request,
  then proves the reducer wipes every captured field and transcript and emits
  the successful local clear result that authorizes browser-memory revocation.
- `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed locally.
- PR CI is the exact-head gate: production dependency audit, lint, typecheck,
  complete unit suite, secret check, build, and performance all must pass before
  merge. Staging smoke and production health verification are post-merge gates.
