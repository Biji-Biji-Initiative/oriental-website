# Oriental voice intake release — implementation evidence

## Change boundary

- `lib/voice/realtime-call-failure.ts` parses cloned SDP error responses and
  separates transient capacity, exhausted quota, and transport failures.
- `useRealtimeVoiceSession.ts` classifies each failed response before retry
  selection; only `realtime_busy` enters the existing one-shot jittered loop.
- `realtime-events.ts` carries explicit email verification state, exact spoken
  readback instructions, grounded confirmation, correction invalidation, and
  route rejection while pending.
- `VoiceAgentDialog.tsx`, `useVoiceRuntime.ts`, and `HandoffPanel.tsx` keep the
  editable draft visible, focus failed fields, make typed edits authoritative,
  and stop unconfirmed voice submission.
- `/api/leads` requires the verification marker for voice source and strips it
  before persistence. Form submissions are unchanged.
- Typed turns always serialize cancel, clear, text, response. Expected cancel
  races remain review data but are filtered from actionable warnings.
- Convex review heartbeats update `leadId` only when provided, preserving the
  durable submission relationship.
- Evaluation separates quota/capacity/transport totals and excludes only
  reserved `@example.test`/named smoke sessions.

## Verification surface

Focused tests cover classifier bodies (including malformed 429), capacity-only
retry selection, email capture/readback/confirmation/contradiction, API 409,
typed event ordering, durable lead linkage, PII-free telemetry, aggregate
availability, and synthetic exclusion. `smoke-staging-intake.ts` uses the
reserved `qa.nebula@example.test` address and asserts zero lead POSTs.

The source staging stack was already live at
`17992e88405c29b5f800da30922a39d87d9495f9` before this integration. The final
governed merge SHA will include later operations/performance changes and must be
redeployed/re-proven; the historical staging SHA is not final release evidence.

Production remains `baseline/control/low`. The evidence gate remains
`insufficient_data`; this release does not alter that decision.

## Current integration verification

- `pnpm lint`: 195 files, no findings.
- `pnpm typecheck`: passed.
- `pnpm test`: 49 files and 296 tests passed.
- `pnpm check-secrets`: contract passed; local credentials intentionally absent.
- `pnpm build`: production standalone build passed.
- `pnpm test:performance`: LCP 516 ms, CLS 0, initial JavaScript 395,392
  transferred / 1,361,894 decoded bytes, zero serious/critical axe findings.
- `git diff --check`: passed.

During integration review, quota classification was found to occur only after
the retry loop. The hook now parses every failed response before calling
`shouldRetryRealtimeCall`; that policy accepts `realtime_busy` only. A focused
test explicitly rejects retry for `realtime_quota_exhausted`.
