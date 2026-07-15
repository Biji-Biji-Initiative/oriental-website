## Unsupported correction

`.apr/evidence/pre-production-closure.md:54–55` overattributes the reduced-motion proof. `tests/voice-audio-activity.test.ts` tests detector thresholding, hysteresis, sustained-silence shutdown, and invalid samples; it does **not** enable `prefers-reduced-motion`, mount the hook, or test animation suppression. The runtime implementation nevertheless has the intended behavior: analyser sampling, activity detection, and start/stop callbacks remain active, while only the CSS-level animation write is suppressed under reduced motion. ([GitHub][1])

Use this corrected evidence wording:

> `tests/voice-audio-activity.test.ts` proves remote-audio activity-detector hysteresis. Source inspection of `components/voice-agent/useVoiceAudioLevel.ts` confirms that analyser sampling and activity callbacks remain active under reduced motion while only visual CSS writes are suppressed.

This is an **evidence-attribution correction only**, not a runtime ship blocker. A future hook-level reduced-motion test would strengthen the proof but is not required for safe-default deployment.

The remaining newly named proofs are adequately scoped:

* `voice-cues.test.ts` bounds the function’s reported synchronous arm-cue scheduling-call duration below 100 ms; as already qualified, it does not establish audible onset or a production p50 distribution. ([GitHub][2])
* `voice-session-route.test.ts` verifies `parse`, `rate_limit`, `openai_mint`, and `total` `Server-Timing` fields across invalid, successful, and rate-limited paths. ([GitHub][3])
* `voice-latency.test.ts` verifies response-created, first-output, endpoint/VAD, remote-audio, playout, browser-tool, interruption, and rapid-resume decomposition. ([GitHub][4])
* `voice-session-policy.test.ts` verifies the typed default policy, bounded overrides, unsafe-value fallback, and idle/goodbye constraint. ([GitHub][5])
* `voice-tentative-extraction.test.ts` and `realtime-events.test.ts` verify conservative literal-email extraction, example/third-party rejection, non-overwrite behavior, and grounded punctuation-only correction. ([GitHub][6])

## PR4 classification

The corrected classification is supported:

**Implementation:** complete, merged, and covered by deterministic tests. Commit `8fc3386` follows the PR3 implementation commit `b4a11f1` in `main` and implements the compact reflex prompt, atomic reversible field capture, read-only Oriental lookup, and separation of irreversible routing/end-call actions. ([GitHub][7])

**Activation and attribution:** evidence-deferred. PR3 remains too sparse to attribute a controlled latency or quality improvement to the PR4 slice. No controlled-win claim is justified, and this does not change candidate eligibility.

## Merge and deployment decision

The closure PR **may merge after the wording-only correction above**. No directly introduced code, runtime, privacy, persistence, or rollback blocker was found.

The deployable revision is the **exact full post-merge SHA on `main` produced by the closure merge**, after its main-branch CI passes. That SHA does not exist until the merge occurs and therefore cannot honestly be quoted in advance. Current `main`, `7fb9fdc58b49f97f5dcd70ccd7da89ca26e5d1c7`, is the earlier PR13 merge and must not be recorded as the resulting closure commit. ([GitHub][7])

For deployment, pin the image, `SOURCE_COMMIT`, and `GIT_SHA` to that new full SHA and require `/api/health` to report the same revision. Keep the experimental selectors absent or explicitly set to:

```text
VOICE_RUNTIME_PROFILE=baseline
VOICE_MODEL_CELL=control
VOICE_REASONING_CELL=low
```

Those are the source defaults. ([GitHub][8])

The retained empirical gates remain unchanged, and candidate-profile enablement remains blocked.

VERDICT: SHIP SAFE DEFAULTS

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-audio-activity.test.ts "https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-audio-activity.test.ts"
[2]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-cues.test.ts "https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-cues.test.ts"
[3]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-session-route.test.ts "oriental-website/tests/voice-session-route.test.ts at main · Biji-Biji-Initiative/oriental-website · GitHub"
[4]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-latency.test.ts "oriental-website/tests/voice-latency.test.ts at main · Biji-Biji-Initiative/oriental-website · GitHub"
[5]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-session-policy.test.ts "oriental-website/tests/voice-session-policy.test.ts at main · Biji-Biji-Initiative/oriental-website · GitHub"
[6]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/tests/voice-tentative-extraction.test.ts "oriental-website/tests/voice-tentative-extraction.test.ts at main · Biji-Biji-Initiative/oriental-website · GitHub"
[7]: https://github.com/Biji-Biji-Initiative/oriental-website/commits/main/ "Commits · Biji-Biji-Initiative/oriental-website · GitHub"
[8]: https://github.com/Biji-Biji-Initiative/oriental-website/blob/main/lib/server/openai-realtime.ts "oriental-website/lib/server/openai-realtime.ts at main · Biji-Biji-Initiative/oriental-website · GitHub"
