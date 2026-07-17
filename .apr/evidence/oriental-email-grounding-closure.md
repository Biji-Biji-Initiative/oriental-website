# Oriental email grounding closure — implementation evidence

## Change boundary

- `lib/voice/realtime-events.ts` invalidates superseded verification before
  reducing any tool call, so direct routing cannot bypass capture freshness.
- Duplicate email captures no longer return before grounding.
- Pending-transcription confidence is applied only after completed turns are
  checked for contradiction.
- Verification carries an internal non-PII user-turn sequence, and pending
  native-audio capture binds to the Realtime response's snapshotted
  transcription `item_id`, including an explicit no-input sentinel. Older ASR
  cannot override a later form edit or interruption, and out-of-order
  transcript completion reconciles only the audio item that produced the
  capture. A typed edit also versions an already-active response stale and
  rejects its later email mutation or routing calls.
- Ordered literal and spoken address helpers distinguish the selected address
  from the address rejected by “instead of” or “rather than”.
- Explicit visitor-owned replacements invalidate stale verification, while an
  explicit selection of the current contact address takes precedence over a
  later invoice/reference address.
- The stale visible value is retained for an editable recovery path but is not
  routeable until current evidence is grounded.

## Executable evidence

- Focused reducer plus golden-session suites: 223 tests passed.
- TypeScript typecheck passed.
- Current full candidate gate: lint passed; 57 files / 546 tests passed; local
  secret-contract check completed without managed credentials; production
  build passed.
- Independent executable probes confirmed the original duplicate, pending,
  ordering, and direct-route failures before the patch. A final independent
  adversarial review returned SHIP on this exact delta; no staging or
  production mutation is claimed here.
