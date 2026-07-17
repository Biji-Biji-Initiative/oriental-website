# Oriental voice intake release — ship contract

## Scope

Merge the availability classification and contact-integrity corrections into a
governed staging candidate for later production review while retaining
`baseline/candidate/low` on staging, `baseline/control/low` on production, and
the explicitly approved `VOICE_EMAIL_CAPTURE_MODE=adaptive` policy.

## Non-goals

- No `instant-v1`, minimal-reasoning, traffic-allocation, or voice-variant
  promotion. The only model change is the explicit staging-only
  `gpt-realtime-2.1` candidate; production candidate is forbidden.
- No claim that Malaysian voice quality or useful-start latency has passed.
- No customer lead submission from synthetic staging proof.

## Required behaviour

1. Only a Realtime 429 classified as transient `realtime_busy` MAY receive one
   300–700 ms retry. `insufficient_quota` MUST close immediately as
   `realtime_quota_exhausted`; other failures MUST NOT use the capacity retry.
2. The retry MUST reuse the same mint, peer, offer, microphone, typed context,
   and editable handoff. Manual teardown MUST prevent revival.
3. A typed turn MUST cancel and clear queued output before sending text,
   including the opener race before `response.created` is observed. Expected
   no-active-response cancellation MUST not trigger an actionable error alert.
4. Adaptive speech email capture MUST accept only valid addresses whose model
   evidence canonicalizes to the exact proposed value and whose latest visitor
   turn is exact or contains an explicit email cue within the bounded ASR
   distance. It MAY continue immediately with high/medium confidence; no
   blanket confirmation turn is required.
5. Invalid, missing-evidence, unrelated, beyond-tolerance, stale, or corrected
   values MUST be rejected or re-evaluated from scratch. Typed edits and
   verified prefills MAY confirm only their exact current value. `strict` MUST
   remain the fail-closed exact-readback/explicit-confirmation rollback.
6. Successful lead linkage in a voice review row MUST survive later heartbeat
   snapshots that omit `leadId`.
7. Quota, capacity, and transport failures MUST be counted separately.
   Synthetic `@example.test`/reserved-prompt smokes MUST be excluded from
   customer-quality aggregates without excluding ordinary staging sessions.
8. Staging intake proof MUST verify grounded capture appears under Email,
   mandatory-confirmation copy stays absent, no lead POST is sent, and no
   browser/application error occurs.
9. Public health, performance budgets, and production voice cells MUST remain
   within the governed release contract.
10. A multi-field capture MUST retain independently valid fields, return every
    rejected item in `rejectedFields`, and retry only those items. Duplicate
    keys MUST invalidate the batch before any field is committed.
11. Native-audio identity capture MAY tolerate bounded ASR spelling drift only
    with an explicit field cue and close phonetic resemblance. An unrelated
    same-initial name MUST remain rejected. Adaptive speech email capture MUST
    retain its syntax/evidence/latest-turn boundaries.
12. PII-free email capture mode, source, status, confidence, and current-value
    match MUST be persisted with the review snapshot and survive the current
    Convex schema. Customer contact values MUST remain absent from structured
    route logs.
13. The intake dialog MUST remain fully contained at 320x568, 360x800,
    390x844, 844x390, 1024x600, 1280x720, and 1440x900; reset nested scroll at
    responsive-layout changes; keep desktop panes independently scrollable;
    keep the primary Start Voice action inside the initial viewport before any
    scroll; and avoid opening the mobile keyboard automatically. The canonical
    Mereka M, not the generic blue sphere, MUST render in compact and main voice UI.
    While listening, the streaming or last completed assistant caption MUST
    remain rendered above the primary action. That visual caption remains
    `aria-hidden` to avoid duplicate announcements; the completed transcript
    remains the separate accessible log.
14. The staging voice smoke MUST verify `gpt-realtime-2.1` and the `candidate`
    model cell against deployed public health. This proves configuration and
    availability only; it MUST not imply a candidate win or production promotion.
15. Tool telemetry MUST persist at most 120 PII-free per-call samples with
    bounded name/outcome plus response-created-to-call, execution, and result
    timing. Every completed tool sample MUST update review metadata immediately,
    including tools such as `wait_for_user` that may not create another response.
    When the buffer is full, replacing its oldest sample MUST still publish the
    updated metadata; equal array length is not evidence that metadata is unchanged.
    `route_to_team` MUST start persistence and notification fan-out concurrently
    without weakening durability or failure handling.
16. Microphone lifecycle copy MUST treat `prompt` as first use or an expired
    one-time grant, explain persistent versus one-time access honestly, release
    the microphone on close, and keep blocked-mic recovery actionable.
17. Staging MUST explicitly materialize `baseline/candidate/low/adaptive`,
    `gpt-realtime-2.1`, and literal `VOICE_VARIANT_PICKER=false`; public health
    MUST read back those exact values. Infisical remains canonical and MUST pass
    the same candidate-cell check. The host update is defense in depth, not full
    secret synchronization. Production MUST remain unchanged on
    `baseline/control/low/adaptive` and `gpt-realtime-2`. The browser tuner MUST
    consume `/api/client-config` and fail closed when the picker is off; query or
    local preferences MUST NOT bypass the runtime flag.

## Acceptance and rollout

- Unit and browser tests MUST cover quota/capacity classification, retry selection,
  adaptive/strict capture, correction, client/API rejection, partial-safe capture,
  bounded name grounding, lead linkage, verification provenance, aggregate
  failure counts, synthetic exclusion, per-tool telemetry including capped-buffer
  replacement, concurrent routing, mic lifecycle, idle primary-action fit,
  listening-caption/action order, exact staging materialization, missing-picker
  rejection, and the full responsive matrix.
- Lint, typecheck, all unit tests, secret contract, build, and mobile
  performance gate MUST pass.
- APR MUST return `VERDICT: SHIP SAFE DEFAULTS`.
- After merge, deploy the exact full SHA to staging and run deterministic public
  verification plus both voice smokes. Production remains on its current exact
  SHA until the user reviews staging and explicitly approves the promotion.
- Roll staging back to its prior exact staging SHA if intake, transport, health,
  or performance proof fails. The model-only experiment may also roll back to
  control on the same image. Production remains untouched.
- Roll back capture friction independently with
  `VOICE_EMAIL_CAPTURE_MODE=strict` on the same exact image.

## Open manual gates

Human Malaysian multilingual quality judgment and controlled candidate traffic
remain external evidence gates. This staging preview collects evidence; it does
not satisfy those gates or authorize production promotion.
