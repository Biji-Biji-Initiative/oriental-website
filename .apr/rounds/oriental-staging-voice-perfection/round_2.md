## Release decision

I do **not** approve exact head `0562883b9c06bf1917d9e56959fa6421c2b09058` against exact base `b0b0d83c7499ea4ed470430e8e3cfa80ab7bd68e`.

The exact-host picker changes and read-only enrichment changes are materially better than round 1. They do not, however, close the complete release contract. Several deterministic fail-open paths remain in email authority, clear-all item identity, experiment attribution, and audio behavior.

## Round-1 blocker reassessment

**Exact-host picker and submitted-variant authority: closed.**
`app/api/client-config/route.ts` now requires the exact hostname `staging.oriental.mereka.io` and `VOICE_VARIANT_PICKER=true`. `app/api/voice/session/route.ts` independently applies the same exact-host requirement before passing a submitted variant, while `oriental.mereka.io` wins over stale staging environment metadata. The noncanonical-host and production-host tests exercise both surfaces (`implementation-bundle.patch:299-355`, `2827-2874`, `4653-4723`).

**URL and storage visibility authority: closed.**
`components/voice-agent/voice-tuner.ts` no longer reads `?voices=1`, `?voices=0`, or `oriental.voiceTunerHidden`; the runtime route is now the only production-build visibility authority (`implementation-bundle.patch:824-862`, `4725-4750`).

**Read-only profile enrichment failure handling: closed.**
`scripts/eval-voice.ts` queries only rows with incomplete voice attribution, uses the pre-existing per-review query, bounds concurrency, and throws generic errors on query failure or incomplete results. It does not continue with partial evidence or expose identifiers (`implementation-bundle.patch:2473-2525`, `3103-3197`). Nothing in this patch requires a candidate Convex mutation or function deployment.

**Control baseline and ordinary null-variant voice/speed drift: substantially closed.**
The evaluator now requires one complete `baseline/control/low`, null-variant voice profile before accepting a non-voice experiment, and compares null-variant experiment rows against that profile (`implementation-bundle.patch:1268-1316`, `4517-4583`).

**Stale-submission accounting and mixed reconnect profiles: not closed.**
Both still have release-blocking holes described below.

## Remaining blockers

### 1. Contradicted literal emails can be installed as current authority

`applyUserEmailUpdate()` gives special authority to the final literal address in any turn containing correction language:

```ts
const correctedLiteral =
  hasEmailCorrectionLanguage(text)
    ? getLiteralEmailMentions(text).at(-1)?.email
    : undefined;
const email = correctedLiteral ?? extractExplicitVisitorEmail(text);
```

This bypasses the ownership, negation, and target-rejection checks used by the tool-capture path (`lib/voice/realtime-events.ts`; `implementation-bundle.patch:1971-1993`).

For example:

> “Actually, do not use [new@example.com](mailto:new@example.com); keep the address already there.”

The only literal address is `new@example.com`, so it becomes the selected replacement despite being explicitly rejected. Typed input is immediately confirmed; exact adaptive speech can likewise become high-confidence confirmed authority. The added test covers only the positive form, “actually use [new@example.com](mailto:new@example.com),” and does not cover negated, third-party, example, or “do not use” literals (`implementation-bundle.patch:3286-3294`).

That is a contradicted-address routing path and violates the email-authority boundary in specification lines 31-35.

### 2. A contaminated multi-address readback can still confirm

`hasExactEmailReadback()` splits an assistant turn into candidate clauses and succeeds when **any** one clause canonicalizes to the target:

```ts
const candidates = [text, ...text.split(...)];
return candidates.some(...);
```

There is no whole-turn uniqueness check and no rejection when another clause contains a conflicting address (`lib/voice/realtime-events.ts`; `implementation-bundle.patch:2290-2332`).

A turn such as:

> “I heard sora dot kim at gmail dot com. Actually, I heard x sora dot kim at gmail dot com.”

passes because the first sentence is an exact candidate. A following “Yes, correct” can therefore confirm despite the same assistant turn containing a contaminated, conflicting readback.

The tests cover a prefix or suffix contaminating the same address string, but not an exact target sentence accompanied by a second conflicting email sentence (`implementation-bundle.patch:3443-3499`). Specification lines 33-35 require contaminated readbacks to fail closed, not merely contaminated substrings.

### 3. Stale-submission accounting still misses spoken corrections and does not identify the routed address

`deriveCaptureIntegritySignals()` uses `lastLiteralEmailCorrection()`, whose email parser only recognizes literal `local@domain` syntax:

```ts
const EVAL_EMAIL_PATTERN = /...@.../gi;
```

It cannot recognize a correction transcribed as:

> “Actually, use new dot address at example dot com.”

That representation is explicitly expected elsewhere in this patch—the golden session and spoken-email tests were changed to use `at`/`dot` speech forms (`implementation-bundle.patch:1128-1141`, `4116-4121`). All new stale-accounting tests use literal `@` addresses, so the spoken path remains uncovered (`implementation-bundle.patch:4324-4371`).

There is a second authority problem: the evaluator calls `session.captured.email` the “submitted email,” but stores only a boolean indication that some submission occurred:

```ts
const submittedEmail = session.captured?.email ...;
const submitted = typeof session.submittedAt === "number" || Boolean(session.leadId);
```

It has no immutable PII-free fingerprint or event-time record of the address actually passed to the submission. If captured state changes after the routed payload is formed, the evaluator cannot determine whether the routed address was stale.

The round-1 dependency on a rejection event is gone, but the required stale-submission signal is still incomplete.

### 4. Mixed reconnect evidence can still be falsely attributed

`mergeConversationSessions()` detects voice-profile differences but then retains the latest call as the merged row’s authoritative profile:

```ts
const mixedVoiceProfile = new Set(ordered.map(voiceProfileKey)).size > 1;
merged.push({
  ...head,
  ...
  mixedVoiceProfile,
});
```

`aggregateEvalsByExperimentCell()` subsequently assigns the entire merged conversation to that latest `variant/voice/speed` key (`implementation-bundle.patch:1078-1093`, `1254-1265`).

The validator does not reject `mixedVoiceProfile` unconditionally. It merely adds `"voice profile"` as one active dimension:

```ts
if (entry.mixedVoiceProfile && !activeDimensions.includes("voice profile")) {
  activeDimensions.push("voice profile");
}
return activeDimensions.length > 1 ? failure : success;
```

Consequently, a `baseline/control/low` conversation whose reconnect segments use different voices or speeds while both have `variant: null` has exactly one active dimension—`voice profile`—and passes. It is then attributed wholesale to the latest voice and speed.

The added mixed-profile test uses a non-null variant, so it fails only because `"voice variant"` plus `"voice profile"` produces two dimensions (`implementation-bundle.patch:4586-4600`). There is no test for the null-variant mixed case.

The same merge structure also does not preserve a full per-call runtime/model/reasoning experiment key. A reconnect spanning a deployment boundary can therefore inherit the latest call’s model cell unless some separate mechanism rejects it. Clean experiment evidence must either split at any full-profile boundary or reject every merged conversation containing more than one runtime/model/reasoning/variant/voice/speed profile.

### 5. A post-clear item ID can be reused after its first successful settlement

After clear-all, commits are rejected only when the item ID is currently pending or is in the pre-clear ignored list:

```ts
[
  ...(state.pendingUserTranscriptIds ?? []),
  ...(state.ignoredUserTranscriptIds ?? []),
].includes(committedTranscriptId)
```

When a valid post-clear item completes, its ID is removed from `pendingUserTranscriptIds` and is not added to any completed-ID tombstone (`lib/voice/realtime-events.ts`; `implementation-bundle.patch:1721-1745`, `1760-1803`).

The resulting sequence is fail-open:

1. Commit post-clear item `new-item`.
2. Complete `new-item`; its transcription is accepted.
3. Commit `new-item` again; it is no longer pending or ignored, so the commit is accepted.
4. Complete `new-item` again; the transcription is accepted again.

That is precisely a reused post-clear identity. It can restore or replace cleared PII.

The “deduplicates a newly committed tagged transcript” test duplicates the commit **before** the first settlement. The broader “reused” test reuses a pre-clear tombstoned ID. Neither tests reuse an accepted post-clear ID after settlement (`implementation-bundle.patch:3861-3973`).

Additionally, pre-clear tombstones are truncated to 100 IDs. Although an uncommitted unknown completion remains fenced, a dropped old ID can participate in the same commit-reuse bypass.

Clear-all correctly empties captured fields, verification, route state, transcript, draft, and browser handoff memory. Unknown, untagged, duplicate completions, and already-tombstoned pre-clear IDs are also improved. The settled-ID reuse hole nevertheless violates specification lines 38-41.

### 6. The steady-noise test does not exercise the newly added RMS signal, and the implementation has a permanent-activation region

`updateAudioReactivity()` uses:

```ts
const signal = Math.max(frequencySignal, timeDomainRms * 2.8);
const floorTarget = Math.min(signal, 0.09);
```

Because the noise floor can never exceed `0.09`, a steady signal above roughly `0.10` cannot converge to rest (`lib/voice/audio-reactivity.ts`; `implementation-bundle.patch:1428-1469`).

For example, a steady `frequencyLevel=0.08` and `timeDomainRms=0.043` produces a combined signal of about `0.1204`. The floor converges to `0.09`, while the visual level converges to roughly `0.34`, leaving the nebula visibly active indefinitely.

The test named “learns steady room noise” always supplies `timeDomainRms=0`, even though the hook now supplies real RMS every frame (`implementation-bundle.patch:4198-4206`). It therefore does not test the path that causes the permanent response.

The audio envelope is numerically bounded and its attack/release behavior is otherwise reasonable, but the asserted steady-room-noise boundary is not satisfied over the function’s valid input domain.

### 7. Operator identity copy still brands the lead as “Oriental”

`lib/server/notification-payloads.ts` changes the email body to “New Mereka at Oriental partner intake,” but leaves the owner-notification subject unchanged:

```ts
const subject =
  `[Oriental] ${segment.label} lead from ...`;
```

(`implementation-bundle.patch:1408-1415`)

That subject is the most visible operator-facing identity string. It still labels the lead as Oriental rather than Mereka or Mereka at Oriental. This contradicts specification lines 27-30 and the evidence claim that operator copy consistently identifies Mereka as the team and Oriental Building as the place.

## Other traced boundaries

The WebGL shader changes retain bounded audio uniforms and do not add new buffers, listeners, or animation loops. The added waveform array and envelope state are effect-local, so the delta itself does not introduce a separate cleanup leak. Existing reduced-motion, WebGL-initialization fallback, point-count, and teardown mechanisms still require the planned exact-SHA browser proof, but the absence of that post-merge staging run is not itself a pre-merge blocker.

The short-landscape picker CSS is correctly applied with sufficient specificity to both collapsed and expanded controls, and the new tests cover 844×390 and 1024×390. The canonical runtime route remains authoritative, so the local E2E environment showing the picker without a query string does not recreate the production bypass.

The governed candidate cell, release verifier, and host deployer consistently require picker-on only for candidate staging and picker-off for production control. Picker-enabled rows are explicitly treated as audition evidence rather than clean candidate-model evidence. No production deployment or production mutation is authorized here.

The merged SHA, optimistic-concurrency staging deployment, real WebRTC/audio run, no-submit intake run, and post-staging production invariance check remain later gates. They cannot cure the deterministic code and attribution defects above.

VERDICT: DO NOT MERGE
