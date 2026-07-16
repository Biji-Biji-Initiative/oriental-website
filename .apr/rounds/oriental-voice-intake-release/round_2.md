The implementation evidence successfully addresses the requirements laid out in the voice intake release contract. Here is the traceability analysis:

1. **Failure classification & retry selection:** 
   * Evidence confirms (`.apr/evidence/oriental-voice-intake-release.md:5-8`, `64-68`) that quota classification and 429 parsing now occur *before* the retry loop. The `shouldRetryRealtimeCall` policy strictly accepts `realtime_busy` while immediately rejecting `realtime_quota_exhausted`. 
   * Retry reuse identity limits (mint, peer, offer, microphone) and manual teardown invalidation are proven via the cited external APR trace (`.apr/evidence/oriental-voice-intake-release.md:74-78`).

2. **Typed interruption & cancellation:**
   * Evidence confirms typed turns serialize cancel, clear, text, and response operations (`.apr/evidence/oriental-voice-intake-release.md:17-18`). 
   * The expected no-active-response races are correctly isolated from actionable alerts via `isBenignVoiceError` (`lib/voice/realtime-events.ts:129-139`).

3. **Email capture, readback, confirmation, and correction:** 
   * **Capture & Readback:** The system explicitly instructions the model to read back the email verbatim (`lib/voice/realtime-events.ts:592-594`).
   * **Confirmation:** Explicit visitor confirmation is validated against prior assistant readback and grounded transcript contents (`lib/voice/realtime-events.ts:764-794`).
   * **Correction/Invalidation:** `pendingSpokenEmailVerification` correctly resets the state to `pending` whenever an already speech-confirmed email receives a duplicate or altered capture (`lib/voice/realtime-events.ts:597-609`).

4. **API Submission & Rejection:** 
   * The `route_to_team` tool prevents unconfirmed submission by intercepting and rejecting `unconfirmed_required_fields` (`lib/voice/realtime-events.ts:397-408`). 
   * API endpoints require and strip the verification marker (`.apr/evidence/oriental-voice-intake-release.md:15-16`), while typed prefill emails are safely confirmed for exact current values (`lib/voice/realtime-events.ts:150-156`).

5. **Review persistence:**
   * Convex heartbeat snapshots preserve durable submission relationships by updating the `leadId` only when provided (`.apr/evidence/oriental-voice-intake-release.md:19-20`).

6. **Evaluation attribution:**
   * Quota, capacity, and transport are counted separately. Synthetic staging proof utilizing the `qa.nebula@example.test` address safely excludes telemetry without excluding ordinary staging traffic (`.apr/evidence/oriental-voice-intake-release.md:21-22`).

7. **Staging proof & Rollout safety:**
   * The staging proof execution verifies exact workflow constraints (pending UI changes, verifiable transcript readback, blocking unconfirmed posts, clean teardown) (`.apr/evidence/oriental-voice-intake-release.md:32-39`). 
   * No candidate models, latency claims, or traffic allocations are unsafely promoted; the rollout remains strictly governed under `baseline/control/low` (`.apr/evidence/oriental-voice-intake-release.md:50-51`). 

VERDICT: SHIP SAFE DEFAULTS
