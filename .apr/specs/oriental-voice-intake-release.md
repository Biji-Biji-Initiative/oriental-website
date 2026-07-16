# Oriental voice intake release — ship contract

## Scope

Merge the staging-proven availability classification and contact-integrity
corrections into the governed production release while retaining
`baseline/control/low` voice cells.

## Non-goals

- No `instant-v1`, candidate-model, minimal-reasoning, traffic-allocation, or
  voice-variant promotion.
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
4. Speech-captured email MUST remain pending until the exact address is read
   back by Reka and explicitly confirmed by the next grounded visitor turn.
   Correction MUST invalidate confirmation.
5. Typed email edits and verified prefills MAY confirm only their exact current
   value. Client and API MUST reject voice submission without confirmation.
6. Successful lead linkage in a voice review row MUST survive later heartbeat
   snapshots that omit `leadId`.
7. Quota, capacity, and transport failures MUST be counted separately.
   Synthetic `@example.test`/reserved-prompt smokes MUST be excluded from
   customer-quality aggregates without excluding ordinary staging sessions.
8. Staging intake proof MUST verify pending copy appears under Email, exact
   readback occurs, explicit confirmation clears the warning, no lead POST is
   sent, and no browser/application error occurs.
9. Public health, performance budgets, and production voice cells MUST remain
   within the governed release contract.
10. A multi-field capture MUST retain independently valid fields, return every
    rejected item in `rejectedFields`, and retry only those items. Duplicate
    keys MUST invalidate the batch before any field is committed.
11. Native-audio identity drafts MAY tolerate bounded ASR spelling drift only
    with an explicit field cue and close phonetic resemblance. An unrelated
    same-initial name MUST remain rejected. Speech email drafts MUST still pass
    exact readback and explicit confirmation before submission.
12. PII-free email-verification provenance MUST be persisted with the review
    snapshot and survive the current Convex schema. Customer contact values
    MUST remain absent from structured route logs.
13. The intake dialog MUST remain fully contained at 320x568, 390x844,
    844x390, and 1024x600, reset nested scroll at responsive-layout changes,
    and avoid opening the mobile keyboard automatically.
14. The staging voice smoke MUST verify the session model and cell against the
    deployed public health contract (or an explicit expected override), not a
    hard-coded candidate. It MUST not imply model promotion.

## Acceptance and rollout

- Unit tests MUST cover quota/capacity classification, retry selection,
  readback/confirmation/correction, client/API rejection, partial-safe capture,
  bounded name grounding, lead linkage, verification provenance, aggregate
  failure counts, and synthetic exclusion.
- Lint, typecheck, all unit tests, secret contract, build, and mobile
  performance gate MUST pass.
- APR MUST return `VERDICT: SHIP SAFE DEFAULTS`.
- After merge, deploy the exact full SHA to staging, run deterministic public
  verification and both voice smokes, then promote the same SHA to production
  and verify both canonical environments.
- Roll back the web release to the prior exact production SHA if intake,
  transport, health, or performance proof fails. Candidate cells remain off.

## Open manual gates

Human Malaysian multilingual quality judgment and controlled candidate traffic
remain external evidence gates. They do not block shipping these safety fixes
under control cells and MUST NOT be represented as passed.
