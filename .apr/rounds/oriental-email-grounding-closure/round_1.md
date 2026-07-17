Static trace only: no production/staging mutation, no test/gate pass claim.

I would **not ship** this reducer as-is. It handles several ordinary cases, but there are routeable stale-email paths and contract misses.

## Blocking counterexamples

### 1. Spoken selected replacement can leave stale verified email routeable

Initial state: `old@example.com` is captured and confirmed. Completed visitor turn:

> “My email is new at example dot com; old at example dot com is just for invoices.”

For `old@example.com`, `emailCorrectionInvalidates` can return **false**: there is no literal `@` mention, the old spoken address is not rejected, “my email is …” is not treated as correction language, and `emailTurnSelectsDifferentAddress` refuses to detect the selected new spoken address because the current old address appears somewhere in the same turn. See `lib/voice/realtime-events.ts:656-669` and `lib/voice/realtime-events.ts:1260-1276`.

Result: the old verification can remain confirmed, and `route_to_team` can submit because only email is required and confirmed email passes the route gate. See `lib/voice/realtime-events.ts:172-180`, `lib/voice/realtime-events.ts:897-898`, and `lib/voice/realtime-events.ts:483-522`.

This violates the correction, ownership, stale-draft, and chronology contracts in `.apr/specs/oriental-email-grounding-closure.md:5-25`.

### 2. Non-contact secondary literal addresses are not safely distinguished

Completed visitor turn:

> “Use contact@example.com for contact; billing email is billing@example.com for invoices.”

The literal resolver marks `contact@example.com` as selected, but it can also mark `billing@example.com` as selected because any preceding “email is” pattern qualifies. There is no billing/invoice exclusion, and the later selected literal wins. See `lib/voice/realtime-events.ts:1166-1198` and `lib/voice/realtime-events.ts:1200-1224`.

That directly conflicts with the requirement that an explicitly selected current contact address remain valid when a later address is clearly secondary. See `.apr/specs/oriental-email-grounding-closure.md:14-19`.

Worse, if the model then captures `billing@example.com` as the lead email, exact recent grounding accepts it, adaptive mode confirms it, and route can submit it. See `lib/voice/realtime-events.ts:979-1031`, `lib/voice/realtime-events.ts:827-843`, and `lib/voice/realtime-events.ts:483-522`.

### 3. Pending-audio duplicate can reaccept stale evidence after a completed selected replacement

State after a completed correction:

> “Use new@example.com.”

Current captured draft is still `old@example.com`, verification has been cleared, and another audio item is pending. If the model issues a duplicate `capture_field` for `old@example.com` with stale exact evidence while transcription is pending, the duplicate email does cross validation, but the pending relaxation can still accept it.

The rejection block computes `latestTurnSupersedes`, but it only fails when the old address was matched in recent turns, the latest turn contains the old target, or the latest turn has contextual correction language. A selected “Use new@example.com” has no `actually/no/change/...` correction token, so with pending audio the function returns medium-confidence success. See `lib/voice/realtime-events.ts:998-1016` and `lib/voice/realtime-events.ts:1054-1057`.

In adaptive mode that medium-confidence speech capture becomes confirmed, so a following `route_to_team` can submit stale `old@example.com`. See `lib/voice/realtime-events.ts:827-843` and `lib/voice/realtime-events.ts:520-522`.

This violates duplicate-call and pending-contradiction requirements in `.apr/specs/oriental-email-grounding-closure.md:8-13`.

### 4. Spoken alternatives with post-selection are incomplete

Literal alternatives with a later selected address are handled by the literal mention resolver. But spoken alternatives are not equivalently protected when the current address is also mentioned:

> “Either old at example dot com or new at example dot com works; use new at example dot com.”

For current `old@example.com`, `emailTurnSelectsDifferentAddress` is suppressed because the old address appears in the same spoken turn. The alternative helper is only effective through `supersedesRecentEmailGrounding`, and `emailCorrectionInvalidates` does not call that path for plain `use`/`keep` selection without correction language. See `lib/voice/realtime-events.ts:656-669`, `lib/voice/realtime-events.ts:1278-1294`, and `lib/voice/realtime-events.ts:1260-1276`.

That leaves a direct-route stale-email path after a spoken selected alternative, contrary to `.apr/specs/oriental-email-grounding-closure.md:12-17`.

### 5. Typed/prefill authority is not fully protected from older pending ASR

Typed/prefill confirmations are represented as confirmed authority. See `lib/voice/realtime-events.ts:164-170`. But if an older pending audio transcription completes after a later typed/form email edit, the reconciliation fallback can apply that older speech text to the current state whenever the awaited value no longer matches the current email. See `lib/voice/realtime-events.ts:600-609`.

Because `applyTentativeEmail` invalidates an existing captured email based on the completed text and does not check typed authority or item chronology, an older ASR item can demote a later typed confirmation. See `lib/voice/realtime-events.ts:570-579`. That misses the chronology requirement in `.apr/specs/oriental-email-grounding-closure.md:23-25`.

## What does trace as intended

- Email duplicate captures do not use the non-email duplicate early return; they re-enter grounding. See `lib/voice/realtime-events.ts:862-872`.
- Common literal “use new instead of old” ordering is represented by selected/rejected literal mention disposition. See `lib/voice/realtime-events.ts:1166-1224`.
- Common spoken “instead of/rather than old” rejection is covered by the canonical rejection path. See `lib/voice/realtime-events.ts:1133-1164`.
- Pending item binding exists and reconciles by item id when the awaiting value still matches current captured email. See `lib/voice/realtime-events.ts:242-249`, `lib/voice/realtime-events.ts:787-804`, and `lib/voice/realtime-events.ts:600-637`.
- Strict speech capture remains pending and route blocks unconfirmed email. See `lib/voice/realtime-events.ts:827-843` and `lib/voice/realtime-events.ts:1650-1653`.

Those positives are not enough because stale verified values can still remain routeable after completed spoken replacements, and adaptive pending duplicate capture can re-confirm stale evidence.

VERDICT: DO NOT SHIP
