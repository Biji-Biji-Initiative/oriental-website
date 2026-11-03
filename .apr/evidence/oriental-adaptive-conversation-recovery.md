# Adaptive conversation recovery — implementation evidence

## Candidate boundary

Runtime implementation is in commit `c72f418dc64129259e6a91c75efed9a6635418f3`.
The same PR also includes commit `1c1e4c47e4f63568e6d73fc756ea2e73b7f41eac`,
which updates the production dependency pins for the current `fast-uri` and
`brace-expansion` advisories. This record intentionally contains no customer
transcript or contact data.

## Traced corrections

- `VoiceAgentDialog` now carries the server-provided email capture mode into
  both initial and live `serializeHandoffContext` calls, and includes the mode
  in the synchronization key. Adaptive sessions therefore retain their
  adaptive policy instead of acquiring an implicit strict pending state.
- `useVoiceRuntime` distinguishes a deliberate local handoff edit from a
  reducer update caused by an assistant tool. Only the former emits another
  synthetic handoff context, preventing the assistant from responding to its
  own field mutation as though it were another visitor turn.
- `client-events` and `profile` state the adaptive rule plainly: a pending
  address is optional conversational context, not a blocker or typing request;
  the current project discussion takes priority.
- `voiceToolsForEmailCaptureMode` removes `confirm_email` from adaptive
  sessions while retaining the strict-mode tool list. The server uses that
  function when minting its Realtime session.
- `realtime-events` preserves a high-confidence direct spoken address when a
  tool returns only a small same-length spelling near miss. The pre-existing
  rejection logic still applies outside that narrow grounded-ASR case.

## Deterministic verification

The release head passed all of the following after the runtime and dependency
changes:

- `pnpm audit --prod --audit-level=high --json` — no high-or-higher production
  advisories.
- `pnpm lint` and `pnpm typecheck`.
- `pnpm test` — 91 test files and 2,353 tests passed.
- `pnpm build`.

Focused regressions are in `tests/voice-runtime-attribution.test.ts`,
`tests/realtime-events.test.ts`, `tests/realtime-client-events.test.ts`,
`tests/openai-realtime.test.ts`, and `tests/voice-profile.test.ts`. They cover
the local-only handoff refresh, adaptive no-gate message, adaptive tool
exclusion, direct-speech near-miss preservation, and strict-mode retention.

## Deployment boundary

The candidate is not production evidence until it merges, GitHub CI passes,
and the governed staging and production release gates prove the exact final
main SHA. The release does not claim a model promotion or collect a synthetic
customer submission.
