# Oracle Browser Transcript

Conversation: https://chatgpt.com/c/6a688fdd-b570-83eb-8732-a180b70d03e4

## Prompt

Perform an adversarial exact-source voice data-integrity review of
implementation commit 918805adf3bada7c64847475b00567ec63c7b324 against
the attached complete source-only patch. Recheck every round-one blocker:
the delayed approximate candidate turn itself must reject explicit negation,
replacement, mixed literal selection, and exact-path reopening; newer typed
or spoken decisions must win; strict mode and the six-turn history bound must
remain fail closed; and spoken digit words must preserve distinct literal
and numeric valid mailboxes unless the visitor supplies explicit digit
context. Also prove unrelated literal addresses or numeric sentences cannot
suppress ambiguity, negative digit language cannot authorize it,
equal-length to/too/for forms cannot introduce numeric mailbox digits, and
candidate-relative scratch/ignore/retract/take-back/cancel/replace/change/
switch language rejects the approximation. Exercise one/1, two/2, samone/sam1,
and to/too/for through the full matcher. Confirm stored values are never
rewritten. Do not waive exact-head CI, combined-tree admission, or staging
voice proof. End with
`VERDICT: MERGE` or `VERDICT: DO NOT MERGE` on its own final line.

## Answer

## Exact-source decision

Commit `918805adf3bada7c64847475b00567ec63c7b324` closes several earlier defects, but it is **not mergeable**. The new digit-disambiguation and candidate-relative matching logic still has four concrete data-integrity failures.

## Release blockers

### 1. Explicit digit context does not select the numeric interpretation

`canonicalizeEmailSpeechInterpretations()` correctly creates both numeric and literal interpretations, for example:

* `one at example dot com` → `1@example.com`
* `one at example dot com` → `one@example.com`

But explicit digit context merely makes `hasAmbiguousSpokenDigitEmail()` return false. It does not remove the literal interpretation from exact matching:

* `findExactEmailTokenWindow()` accepts the target when **either** interpretation matches.
* `hasAmbiguousSpokenDigitEmail()` suppresses ambiguity when `emailWindowHasExplicitDigitIntent()` is true.
* The exact path then returns high confidence.

See `.apr/evidence/oriental-email-grounding-pr79.patch:224-249`, `:269-277`, and `:300-324`, feeding the high-confidence returns at `:30-35` and `:44-50`.

Hostile case:

```text
Visitor: “Those are digits: my email is one at example dot com.”
Model value: one@example.com
```

The literal `one@example.com` remains an exact interpretation. Because the turn says “digits,” ambiguity is disabled and the literal mailbox is promoted to high confidence—even though the visitor selected `1@example.com`.

The same failure applies to:

```text
“Those are digits: sam one at example dot com.”
Model value: samone@example.com
```

That can promote `samone@example.com` instead of the explicitly selected `sam1@example.com`.

The added positive test only verifies that explicit digit context promotes the numeric value `sam199@gmail.com`; it never supplies the literal alternative under the same explicit digit context. See `tests/realtime-events.test.ts` additions at patch lines `369-401`.

**Required correction:** interpretations must remain tagged as numeric or literal. Explicit positive digit intent must allow only the numeric interpretation to establish exact or approximate grounding. It must not merely suppress the ambiguity flag.

---

### 2. Unrelated numeric context and sufficiently distant negative language can authorize digits

`emailWindowHasExplicitDigitIntent()` searches backward through the entire tokenized decision clause for any of:

```text
digit, digits, number, numbers, numeric, numeral, numerals
```

It rejects such context only when:

* an intervening token is one of the spelled words `zero` through `nine`; or
* negation occurs within three tokens before the context word, or after it before the candidate.

See `.apr/evidence/oriental-email-grounding-pr79.patch:251-267`.

#### Unrelated actual-number bypass

```text
Visitor: “For room number 7, my email is two at example dot com.”
Model value: 2@example.com
```

For the candidate window beginning at `two`:

* `number` is found before the candidate;
* the intervening actual token `7` is not a key in `SPOKEN_DIGIT_WORDS`;
* no negation is present.

The helper therefore returns true and suppresses the `two@example.com` versus `2@example.com` ambiguity.

The test at patch lines `403-450` uses `Room number one`. It passes because the intervening word `one` happens to trigger the spoken-digit barrier. It does not cover an actual numeric token such as `7`, `42`, or `199`.

#### Long-range negative-context bypass

```text
Visitor:
“Do not ever treat this phrase as a numeric digit label;
 my email is two at example dot com.”
Model value: 2@example.com
```

When the backward scan reaches `digit`, the preceding three-token polarity window no longer includes `not`. The intervening text after `digit` also contains no negation. The context is consequently treated as positive digit intent.

The existing negative test—`Those are not digits`—places `not` immediately next to `digits`, so it does not exercise this boundary.

**Required correction:** digit intent must be structurally attached to the candidate sequence, rather than inherited from any earlier context token. Negation must govern the complete candidate-local intent phrase, not a three-token prefix. Actual numeric expressions and unrelated number terminology must not authorize the mailbox interpretation.

---

### 3. Mixed `one to` / `one too` / `one for` forms still introduce numeric digits through bounded approximation

The pure `to`, `too`, and `for` tests are now rejected, but the guard remains bypassable when the same candidate window also contains a genuine spoken digit word.

`introducesUnspokenHomophoneDigit()` rejects an unsafe homophone only when `emailWindowHasExplicitDigitIntent()` is false:

```ts
return hasUnsafeHomophone && !emailWindowHasExplicitDigitIntent(tokens, start, end);
```

See `.apr/evidence/oriental-email-grounding-pr79.patch:184-197`.

Hostile full-matcher cases:

| Spoken evidence                         | Model mailbox          | Candidate produced by canonicalization | Distance / cap |
| --------------------------------------- | ---------------------- | -------------------------------------- | -------------- |
| `digits one to at longexample dot com`  | `122@longexample.com`  | `1to@longexample.com`                  | 2 / 3          |
| `digits one too at longexample dot com` | `1222@longexample.com` | `1too@longexample.com`                 | 3 / 3          |
| `digits one for at longexample dot com` | `1444@longexample.com` | `1for@longexample.com`                 | 3 / 3          |

Because each window contains `one`, explicit digit intent returns true. The presence of `to`, `too`, or `for` is therefore no longer disqualifying. The candidate has the same length as the proposed numeric mailbox and falls within the three-edit cap, so `findSpokenEmailSubstitution()` can admit it as bounded ASR evidence at `.apr/evidence/oriental-email-grounding-pr79.patch:153-170`.

This does not immediately make the capture high confidence, but it does admit and store an otherwise ungrounded numeric mailbox as medium-confidence evidence. That contradicts the absolute contract that `to`, `too`, and `for` must not introduce digits. The pure cases at test patch lines `516-544` do not cover these mixed forms.

**Required correction:** a `to`, `too`, or `for` token that aligns against target digits must be disqualifying independently of other correctly spoken digit words in the same address. Explicit digit context must never turn those homophones into bounded substitutions for `2` or `4`.

---

### 4. Candidate-relative retraction examines only one globally selected match

`findSpokenEmailSubstitution()` returns one match only. Equal-distance ties preserve the first match because the winner is changed only for a strictly lower distance:

```ts
if (!best || distance < best.distance) {
  best = { candidate, distance, start, end, tokens };
}
```

See `.apr/evidence/oriental-email-grounding-pr79.patch:153-170`.

`followingApproximateEmailDispositionRejects()` then examines only the suffix following that one match. Its replacement expression is anchored at the beginning of that suffix. See patch lines `119-126`.

A hostile turn can therefore contain two equal-distance approximate windows:

```text
“The transcript says sam dot carper at gmail dot com.
 My email is sam dot carper at gmail dot com, cancel that.”
```

Proposed value:

```text
sam.carter@gmail.com
```

Both occurrences are one edit from the proposed value. The first occurrence wins the tie. Its following text begins with `my email is ...`, not `cancel that`, so the anchored candidate-relative guard does not see the cancellation attached to the second, actual ownership statement.

The fallback regex in `approximateEmailTurnRejectsGrounding()` does not include `scratch`, `ignore`, `retract`, `take back`, or `cancel`; it relies on the selected match’s following disposition for those forms. See patch lines `105-117`.

The same structural problem applies to later repeated candidates followed by the listed disposition language. Every added test at patch lines `620-657` contains exactly one approximate candidate, so no equal-best or repeated-candidate chronology is exercised.

**Required correction:** retain and evaluate all bounded candidate windows, with dispositions tied to each candidate and later decisions superseding earlier equal-value mentions. At minimum, add first/last and equal-distance permutations for scratch, ignore, retract, take-back, cancel, replace, change, and switch.

## Rechecked items that are closed

The following earlier blockers are materially closed in the changed source:

* **Positive edit distance and exact-path reopening:** delayed approximation requires `substitutionDistance > 0`; an exact zero-distance match cannot itself enter the approximate branch. Patch lines `64-80`.
* **Direct candidate negation and mixed literal selection:** the new guard combines literal selection, target-specific rejection, and explicit rejection vocabulary. The supplied single-candidate hostile cases are appropriate. Patch lines `105-117` and tests `620-691`.
* **Later-turn supersession:** the delayed approximate branch still requires every later user turn not to supersede the target. Patch lines `81-86`. The typed replacement test at `723-752` confirms that path; the changed source does not visibly remove the previously established spoken supersession behavior.
* **Strict mode:** ordinary ambiguous `one`/`1` speech remains pending and confirmation-required. Tests `546-571` and `754-784`.
* **Six-user-turn bound:** the delayed approximation searches the bounded `recentUserTurns` collection, and the seven-turn hostile case rejects the expired candidate. Tests `786-815`.
* **Unrelated different literal address:** the supplied `billing@example.com` cases do not disable digit ambiguity. Tests `403-484`.
* **Unqualified `one`/`1`, `two`/`2`, and `samone`/`sam1`:** both model values remain medium-confidence under ordinary speech, as required. Tests `486-514`.
* **Stored-value preservation:** the new canonicalizers are used for comparison and candidate generation; no changed source writes a canonical interpretation back into the captured value. The tests explicitly preserve the tool-supplied `one`, numeric, and `samone`/`sam1` mailbox values. This property is closed, although preserving an incorrectly grounded model value does not cure the blockers above.

## CI, integration, and runtime boundary

The evidence manifest reports:

* `verify` success on exact implementation commit `918805adf3bada7c64847475b00567ec63c7b324`;
* lint, strict TypeScript, 1,562 reducer tests, and the production build passing;
* synthetic eight-PR integration commit `76746d98e6a7b220c3abaf4a93dd426236fc2b2b` passing its combined test/build/audit gate.

Those results do not validate the hostile cases above because the necessary tests are absent. Any correction changes the source SHA and therefore requires fresh exact-head CI and fresh combined-tree admission. The final remote PR head must also be shown to equal the corrected implementation plus APR-only descendants.

Canonical staging voice smoke remains mandatory on the eventual merged exact default-branch SHA before production promotion; the source-only manifest explicitly does not provide that runtime proof.

VERDICT: DO NOT MERGE
