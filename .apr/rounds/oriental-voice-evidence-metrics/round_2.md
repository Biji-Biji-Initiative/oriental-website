An analysis of the evaluator against the `oriental-voice-evidence-metrics.md` contract reveals a critical violation that inflates success metrics, alongside missing documentation requirements.

### 1. Silent Success Inflation (Blocker)
The contract strictly dictates: *"Aggregates expose tap-to-audible samples... and an explicit denominator. Missing samples are not silently treated as successes."* and *"Conversation stitching retains every activation attempt."*

However, `foldEvalLatency` and `deriveLatencySignals` silently drop failed activation attempts that lack latency metrics.
In `lib/eval/voice-eval.ts:187-190`:
```typescript
  const activationAttempts = latencies.flatMap((latency) => {
    if (!latency) return [];
    if (latency.activationAttempts && latency.activationAttempts.length > 0) return latency.activationAttempts;
    return latency.activation ? [latency.activation] : [];
  });
```
If a call segment fails immediately (e.g., a `webrtc_failed` disconnect) and does not persist a `latency` object or `activation` telemetry, the flat mapping removes it entirely rather than emitting an empty/failed attempt.

When aggregated in `aggregateEvals` (`lib/eval/voice-eval.ts:720`):
```typescript
const activationAttempts = evals.flatMap((entry) => entry.latency.activationAttempts);
```
These failed attempts vanish from `activationAttempts.length`. Consequently, `usefulStartRate` is calculated using an artificially shrunken denominator. Immediate failures are excluded from the denominator, causing **silent success inflation** and overclaiming product proof. Every `VoiceEvalSession` segment (call) needs to contribute to the attempt denominator regardless of whether the client successfully transmitted the latency payload.

### 2. Missing Documentation Evidence
Requirement 8 dictates: *"Reports and docs explicitly state that the current 82-conversation corpus is baseline-only, lacks activation samples, and is `insufficient_data`."*
This statement is completely absent from `README.md` or any other attached documentation.

### 3. Evaluated Successes
* **Attribution & Backward Compatibility:** `VoiceEvalSession` safely adds `deploymentEnvironment` and `deviceProfile` as optional fields. The aggregations correctly fall back to `'unknown'`, preventing schema breakage on legacy rows.
* **Failure Preservation:** `mergeConversationSessions` correctly retains all `callCloseReasons`. A later clean reconnect correctly does not erase an earlier mid-utterance drop or `realtime_busy` failure (`lib/eval/voice-eval.ts:178`).
* **Experiment Confounding:** `validateVoiceExperimentEvidence` correctly rejects any row where `activeVoiceExperimentDimensions(entry).length > 1`, ensuring model/reasoning/runtime changes remain independent (`lib/eval/voice-eval.ts:823-827`).
* **Fail-Closed Thresholds:** `meetsThreshold` successfully fails closed when judging data is missing rather than interpreting zero data as a pass (`lib/eval/voice-eval.ts:848`).

VERDICT: DO NOT SHIP
