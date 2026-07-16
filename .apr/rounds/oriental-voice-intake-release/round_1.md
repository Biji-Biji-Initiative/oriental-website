Here is the review of the implementation evidence against the Oriental voice intake release contract.

### Trace
- **Failure classification**: Proven. `.apr/evidence/oriental-voice-intake-release.md:5-7` and `51-54` confirm parsing of cloned SDP error responses into transient capacity, quota, and transport failures before any retry hooks evaluate them.
- **Retry selection**: Proven. `.apr/evidence/oriental-voice-intake-release.md:7-8` and `51-54` establish that only `realtime_busy` is accepted by `shouldRetryRealtimeCall` while `realtime_quota_exhausted` is explicitly rejected.
- **Typed interruption**: Proven. `.apr/evidence/oriental-voice-intake-release.md:17-18` asserts typed turns serialize cancellation prior to text. Expected race condition errors are effectively filtered from telemetry by `isBenignVoiceError` (`lib/voice/realtime-events.ts:129-139`).
- **Email capture/readback/confirmation/correction**: Proven. `.apr/evidence/oriental-voice-intake-release.md:9-11` covers the state machine lifecycle. Instructions coerce verbatim readbacks (`lib/voice/realtime-events.ts:586-595`), explicit grounded confirmation demands verification against the assistant's previous turn (`lib/voice/realtime-events.ts:764-793`), and corrections strictly invalidate existing spoken confirmations (`lib/voice/realtime-events.ts:597-609`). 
- **API submission**: Proven. The `route_to_team` tool safely halts execution and returns `unconfirmed_required_fields` internally, while `/api/leads` requires the voice verification marker to complete submission (`.apr/evidence/oriental-voice-intake-release.md:15-16`). 
- **Review persistence**: Proven. Convex heartbeats preserve existing durability by updating `leadId` only when a value is provided (`.apr/evidence/oriental-voice-intake-release.md:19-20`).
- **Evaluation attribution**: Proven. Telemetry safely partitions capacity/quota/transport aggregations and excludes reserved `@example.test` synthetic smokes from quality calculations (`.apr/evidence/oriental-voice-intake-release.md:21-22`).

### Blockers / Unproven Claims
1. **Insufficient Staging Intake Proof (Section 8)**: The contract strictly requires the staging intake proof to explicitly verify that *"pending copy appears under Email, exact readback occurs, explicit confirmation clears the warning... and no browser/application error occurs"*. However, the evidence limits its claim solely to asserting zero lead POSTs (`.apr/evidence/oriental-voice-intake-release.md:29-30`). The failure to prove UI state mutations, readback verification, and error-free rendering in the staging smoke test violates the contract.
2. **Missing Revival/Teardown Constraints (Section 2)**: The contract mandates that manual teardown *MUST* prevent revival and that the retry utilizes the same mint, peer, and typed context. While the evidence notes entering an existing "one-shot jittered loop" (`.apr/evidence/oriental-voice-intake-release.md:7-8`), it contains no proof or claim that manual teardown prevents revival or that state reuse is strictly preserved across the capacity retry.

VERDICT: DO NOT SHIP
