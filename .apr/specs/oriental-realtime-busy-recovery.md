# Oriental Realtime-busy recovery ship contract

## Goal

Increase useful voice-start availability when OpenAI Realtime capacity is
temporarily busy, without retrying user limits, microphone denial, malformed
sessions, network timeouts, or any non-capacity failure.

## Required behaviour

1. The browser may retry the Realtime SDP exchange exactly once, and only when
   `POST https://api.openai.com/v1/realtime/calls` returns an HTTP 429 body
   classified as transient `realtime_busy`.
2. Retry delay is randomized and bounded to 300–700 ms.
3. The retry reuses the minted ephemeral session, local media stream, peer,
   data channel, SDP offer, visitor context, and current editable handoff.
4. The UI enters an explicit `reconnecting` state. It must not appear idle and
   must prevent a second connect action during the bounded retry.
5. After the one retry, another capacity 429 closes as `realtime_busy`.
   `insufficient_quota` closes immediately as `realtime_quota_exhausted`.
   Other SDP HTTP failures, fetch timeouts, microphone denial, and invalid
   session mint responses keep their existing reason and are never retried here.
6. Manual teardown during jitter prevents the second exchange from reviving a
   closed call.
7. Telemetry records the retry count and first remote-track receipt without
   logging credentials, SDP, recordings, or raw customer data.
8. Existing typed fallback and reversible captured fields remain intact.
9. Every async microphone/session result is owned by a monotonic connect
   attempt. A stale permission result must stop all of its tracks even when a
   newer attempt has already entered `connecting`; a stale catch must not tear
   down the newer connection; and stale `finally` work must never unlock the
   newer attempt. Manual teardown releases the old gate immediately.

## Safety boundary

This is an availability hardening cell, not evidence that voice is instant or
excellent. Production remains `baseline` / `control` / `low`; candidate
promotion stays evidence-gated.

## Verification

- Unit tests prove only the first 429 is retryable and jitter stays bounded.
- Route, schema, reducer, copy, type, lint, build, unit, and Playwright suites
  must pass.
- No model, voice, endpointing, prompt, or traffic-allocation change is part of
  this release.
