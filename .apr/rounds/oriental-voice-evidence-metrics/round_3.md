This code introduces critical flaws that violate the experiment governance and metric honesty requirements.

### 1. Experiment Confounding (Overclaiming Product Proof)
In `lib/eval/voice-eval.ts`, the latency autopilot gate fails to isolate experiment cohorts, directly violating the contract that *"runtime cohorts cannot contaminate a model comparison"*:
```typescript
// lib/eval/voice-eval.ts:413-417
export function assessLatencyAutopilotGate(sessions: VoiceEvalSession[]): LatencyAutopilotGate {
  const candidate = profileLatencyGateMetrics(sessions.filter((session) => session.runtimeProfile === "instant-v1"));
  const control = profileLatencyGateMetrics(
    sessions.filter((session) => (session.runtimeProfile ?? "baseline") === "baseline"),
  );
```
Because `assessLatencyAutopilotGate` operates over the mixed historical corpus, checking only `runtimeProfile` means `control` will silently absorb sessions where `VOICE_MODEL_CELL=candidate` or `VOICE_REASONING_CELL=minimal`. If a candidate model degrades latency or contact accuracy, it will artificially ruin the baseline. `instant-v1` would then falsely appear to outperform the baseline, creating a direct path to overclaim product proof and incorrectly automate a promotion.

To satisfy the contract, both filters must strictly require `modelCell === "control"` and `reasoningCell === "low"`.

### 2. Silent Success Inflation (Erased Failure Telemetry)
The conversation stitching logic silently deletes explicit mid-utterance drop signals:
```typescript
// lib/eval/voice-eval.ts:152-160
const foldedTransport = ordered.reduce<EvalTransport>(
  (acc, s) => foldEvalTransport(acc, s.transport ?? null),
  null,
);
const droppedMidTurn = ordered.some(
  (session) =>
    ABNORMAL_CLOSE_REASONS.has(session.closeReason ?? "") && session.transport?.wasSpeakingAtClose === true,
);
const transport = foldedTransport ? { ...foldedTransport, droppedMidTurn } : null;
```
`foldEvalTransport` correctly preserves any explicit `droppedMidTurn` boolean passed via client telemetry (`acc.droppedMidTurn || next.droppedMidTurn`). However, the final `transport` assignment destructively overwrites `foldedTransport.droppedMidTurn` with the result of `ordered.some(...)`. If a mid-utterance drop was explicitly flagged in the transport payload but the server failed to record `wasSpeakingAtClose = true` (or the close reason wasn't caught as abnormal), the failure is erased and overwritten as `false`. This violates the contract to not "erase an earlier mid-utterance drop" and silently inflates success metrics.

It should fall back safely, e.g., `droppedMidTurn: foldedTransport?.droppedMidTurn || ordered.some(...)`.

VERDICT: DO NOT SHIP
