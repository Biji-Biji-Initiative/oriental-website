The evaluator fails the evidence contract on multiple critical fronts, including silent success inflation, denominator correctness, and experiment confounding.

Here are the blockers:

### 1. Silent Success Inflation in CI Gate
In `meetsThreshold` (`lib/eval/voice-eval.ts:765-799`), the regression checks for quality, routing, and frustration all explicitly bypass validation if the average is `null`:
```ts
  if (
    typeof thresholds.minConversationQuality === "number" &&
    averages.conversationQuality !== null && // <-- Bypasses if null
    averages.conversationQuality < thresholds.minConversationQuality
  )
```
If a deployment completely breaks the voice agent (yielding zero judgeable sessions and a `scoredCount` of 0), `averages.conversationQuality` evaluates to `null`. The function will return `{ ok: true, failures: [] }`, allowing a catastrophic regression to silently pass the CI gate.

### 2. Denominator Correctness & Hidden Activation Failures
In `foldEvalLatency` (`lib/eval/voice-eval.ts:162-166`), the code merges multiple reconnects in a single conversation but only keeps the *first* `activation` object it finds:
```ts
  const activation = latencies.find((latency) => latency?.activation)?.activation;
```
If a user tries to connect, succeeds, drops, and tries again but fails to get audio, the second (failed) attempt is completely discarded from the telemetry. The aggregator (`lib/eval/voice-eval.ts:667-670`) will only register 1 attempt and 1 success, reporting a 100% useful start rate while silently ignoring the subsequent failure. This violates the contract's explicit denominator requirement and constitutes silent success inflation.

### 3. Masking the "Can't Happen" Failure (Dropped Mid-Turn)
In `deriveTransportSignals` (`lib/eval/voice-eval.ts:215`), `droppedMidTurn` depends on `session.closeReason`. For merged sessions (`lib/eval/voice-eval.ts:148`), this inherits the final segment's close reason (`head.closeReason`).
If a user experiences a mid-utterance drop (a critical failure), but patiently reconnects and finishes the conversation normally, the final `closeReason` evaluates as normal. The critical failure is overwritten and erased from the aggregate metrics entirely.

### 4. Missing Experiment Validation (Confounding)
The contract mandates: *"Experiment validation permits at most one non-control dimension among runtime, model, and reasoning."*
The evaluator contains no validation to enforce this. Furthermore, `aggregateEvalsByExperimentCell` (`lib/eval/voice-eval.ts:746-755`) groups solely by `${modelCell}/${reasoningCell}`. If a mixed dataset contains both `baseline` and `instant-v1` runtime profiles under the `control/low` model, the function will silently lump them together, totally confounding the model-cell aggregates with runtime-cell variances.

VERDICT: DO NOT SHIP
