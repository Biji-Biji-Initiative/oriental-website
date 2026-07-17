The implemented reducer in `lib/voice/realtime-events.ts` successfully meets all the criteria outlined in the ship contract and executable evidence. Here is the detailed trace against the required behavior:

1. **Direct routing after correction / invalidation before routing**:
   * **Evidence**: `reduceRealtimeServerEvent` unconditionally processes `invalidateSupersededEmailVerification(state)` on every incoming event (path: `lib/voice/realtime-events.ts:193`).
   * **Enforcement**: If a completed transcript turn contradicts the verified email, this invalidation wipes `emailVerification`. A subsequent `route_to_team` call checks `getUnconfirmedFields` (path: `lib/voice/realtime-events.ts:559`), flags the `email` as unconfirmed (path: `lib/voice/realtime-events.ts:1878-1881`), and actively denies the route.

2. **Duplicate tool calls cross the grounding boundary**:
   * **Evidence**: `applyCaptureField` actively exempts `email` from early duplicate returns (path: `lib/voice/realtime-events.ts:1084-1089`), explicitly forcing it to pass through `validateCaptureGrounding()` where it is subjected to contradiction checks against the latest evidence.

3. **Pending transcription relaxation and contradiction constraints**:
   * **Evidence**: Inside `validateEmailCaptureGrounding`, a contradiction is strictly defined via `supersedesRecentEmailGrounding` (path: `lib/voice/realtime-events.ts:1232`). If the latest turn contradicts or overrides the proposed target, the capture is strictly rejected (path: `lib/voice/realtime-events.ts:1237-1245`).
   * **Relaxation**: Only when no rejection occurs is the native-audio pending bypass triggered `if (transcriptionPending) return { ok: true, emailConfidence: "medium" }` (path: `lib/voice/realtime-events.ts:1251`).

4. **Literal and spoken ordered corrections**:
   * **Evidence**: `resolveLiteralEmailSelection` maps terms like "instead of" or "rather than" directly to a `"rejected"` disposition (path: `lib/voice/realtime-events.ts:1423-1430`) and cues like "use" or "switch to" to `"selected"`. It then reconciles these relative positions to discard the rejected address in favor of the newly selected one (path: `lib/voice/realtime-events.ts:1396-1413`). Spoken addresses undergo the exact same validation within `resolveEmailClauseSelection`.

5. **Alternatives, ownership authority, and non-contact secondary addresses**:
   * **Evidence (Secondary)**: Rejections are short-circuited if the clause carries secondary billing/invoice/web contexts (`hasSecondaryEmailContext`) without ownership or strict selection cues (path: `lib/voice/realtime-events.ts:766`).
   * **Evidence (Ownership/Authority)**: If explicit primary contact ownership is asserted (`hasExplicitEmailOwnershipContext`), it dictates strict superseding authority (path: `lib/voice/realtime-events.ts:1335`).
   * **Evidence (Alternatives)**: Mentioning both via alternatives acts dynamically—returning `"different"` (invalidating context) unless immediately followed by a post-alternative selection cue specifying one option over the other (path: `lib/voice/realtime-events.ts:799`).

6. **Typed/prefill authority and chronological synchronization**:
   * **Evidence**: Handled tightly at the snapshot layer. When an active response is created, `activeResponseTranscriptBinding` takes a snapshot of the pending `item_id` (path: `lib/voice/realtime-events.ts:260-264`).
   * **Typed overrides**: Typed edits bypass old transcripts (`emailVerificationIgnoredTranscriptIds: source === "typed" ? [...(state.pendingUserTranscriptIds ?? [])] : undefined`) and actively version an ongoing response as stale (path: `lib/voice/realtime-events.ts:655-656`), rendering follow-up mutations unrouteable.
   * **Out-of-Order Transcripts**: Pending resolution reconciles exactly by string identity `completedItemId === awaiting.itemId`, safely shielding the flow from late-arriving async transcriptions (path: `lib/voice/realtime-events.ts:685-687`).

7. **Adaptive/Strict fallback behaviors**:
   * **Evidence**: `spokenEmailVerification` dynamically shifts into `"confirmed"` with `"medium"` confidence strictly when the policy reads `mode === "adaptive"` (path: `lib/voice/realtime-events.ts:1060-1062`). Otherwise, it behaves fail-closed by enforcing `status: "pending"` (path: `lib/voice/realtime-events.ts:1063`).

VERDICT: SHIP SAFE DEFAULTS
