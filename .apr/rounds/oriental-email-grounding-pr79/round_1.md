## Release-blocking findings

### 1. The new lookback path can ground the address that the candidate turn explicitly replaces

**File:** `lib/voice/realtime-events.ts:3840-3872`
**Patch:** `.apr/evidence/oriental-email-grounding-pr79.patch:15-49`

The new branch deliberately omits all candidate-turn correction, selection, rejection, and supersession checks:

```ts
const approxMatchingTurnIndex = recentUserTurns.findLastIndex((entry) => {
  ...
  return (
    entryHasEmailCue &&
    spokenEmailSubstitutionDistance(entry.text, email) <= maxAsrEdits &&
    !hasEmbeddedEmailCollision(entry.text, email) &&
    !literalMismatch
  );
});
```

It then examines only turns **after** the candidate:

```ts
recentUserTurns
  .slice(approxMatchingTurnIndex + 1)
  .every((entry) => !supersedesRecentEmailGrounding(entry.text, email))
```

Consequently, the candidate turn itself can explicitly reject or replace the proposed address and still be treated as evidence for it. For example:

```text
Tool value: sam.carter@gmail.com
Latest visitor turn:
  "No, use sam dot carper at gmail dot com instead."
```

That turn has email cues, no literal-email mismatch, no embedded collision, and is one bounded substitution away from `sam.carter@gmail.com`. Because it is the final turn, the subsequent slice is empty and `.every(...)` succeeds. The function returns:

```ts
{ ok: true, emailConfidence: "medium" }
```

before reaching `latestTurnSupersedes`, `hasContextualEmailCorrection`, or the other replacement logic immediately below the new branch.

This is exactly the ambiguity the comments acknowledge at patch lines 15-25, but accepting the ambiguity is not fail-closed. A completed correction turn cannot safely be assumed to be ASR drift merely because the selected address is close to the rejected one.

There is also an exact-address reopening path. The approximate predicate permits distance zero. Thus, a target rejected by the earlier exact/ordered-correction path can be reconsidered by this fallback without the correction checks that caused the exact path to reject it.

A mixed-literal example exposes the related mismatch defect:

```text
"Don't use sam.carter@gmail.com; use sam.carper@gmail.com."
```

For a tool value of `sam.carter@gmail.com`, this condition is false:

```ts
const literalMismatch =
  entryLiteralEmails.length > 0 &&
  !entryLiteralEmails.some((m) => m.email === email);
```

The presence of the rejected address is sufficient to suppress `literalMismatch`, even though the same turn explicitly selects a different address. Because the approximate branch ignores ordering and rejection semantics, it can re-admit the rejected address.

This violates the closure contract for explicit replacement, ordered correction, pending-transcription contradiction, and correction freshness in `.apr/specs/oriental-email-grounding-closure.md:5-17,23-27`.

**Required correction:** candidate turns need a narrow, fail-closed explicit-negation/replacement guard. Avoiding overly broad `"it's"`/`"that's"` heuristics is reasonable, but unambiguous constructs such as `no`, `not`, `instead`, `use … rather than …`, and ordered selection of another parsed address cannot be skipped. A correction-bearing near match should remain ungrounded or require explicit read-back. Merely requiring edit distance greater than zero would close the exact-path reopening but would not close the near-address correction example.

### 2. Spoken-digit folding makes distinct valid email addresses share evidence

**File:** `lib/voice/realtime-events.ts:4536-4568`
**Patch:** `.apr/evidence/oriental-email-grounding-pr79.patch:54-97`

The canonicalizer unconditionally maps every standalone occurrence of `zero` through `nine` to a numeral:

```ts
.replace(
  /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gu,
  (word) => SPOKEN_DIGIT_WORDS[word] ?? word,
)
```

This does not mutate the tool-supplied stored string, but it can authorize the wrong stored string. Email local parts are literal identifiers, so these are different valid addresses:

```text
one@example.com
1@example.com
```

Yet the spoken evidence:

```text
"one at example dot com"
```

is forcibly interpreted as evidence for `1@example.com`. It could equally have meant the literal word local part `one@example.com`. The same collision exists for `two`/`2`, `four`/`4`, and longer sequences such as `oneninenine`/`199`.

Not mapping `to`, `too`, or `for` does not resolve this collision. It only avoids additional ambiguous spellings. The exact digit words themselves remain ambiguous between a word-bearing local part and a numeric local part.

The new test at `tests/realtime-events.test.ts`—patch lines 109-136—actually codifies the unsafe behavior as **high-confidence confirmation**:

```ts
expect(result.state.captured.email).toBe("sam199@gmail.com");
expect(result.state.emailVerification).toMatchObject({
  status: "confirmed",
  confidence: "high",
});
```

It proves that the already-numeric tool value is stored unchanged. It does not prove that the visitor intended the numeric address rather than `samoneninenine@gmail.com`, nor that distinct word and numeric candidates cannot be cross-grounded.

**Required correction:** digit-word evidence must remain ambiguous unless the visitor supplies explicit digit context, a spelling structure that disambiguates it, or a confirming read-back. Another safe design is to retain literal-word and digit interpretations separately and refuse high-confidence confirmation when they resolve to different valid addresses. Strict mode must reject that ambiguity; adaptive mode may preserve it only as an unrouteable pending draft.

Negative tests are required for at least:

```text
one@example.com       versus 1@example.com
two@example.com       versus 2@example.com
samone@example.com    versus sam1@example.com
to / too              versus 2
for                    versus 4
```

Those tests must exercise the complete bounded-distance matcher, not only prove that the replacement map lacks `to`, `too`, and `for`.

### 3. The tests do not cover the new branch’s hostile temporal cases

**File:** `tests/realtime-events.test.ts`
**Patch:** `.apr/evidence/oriental-email-grounding-pr79.patch:109-183`

The complete patch adds only two positive tests:

1. numeric-word evidence confirms a numeric address;
2. an older approximate match survives an unrelated later turn.

Neither test challenges the newly expanded temporal acceptance boundary. Missing release-blocking cases include:

* the candidate turn itself says “no,” “not,” “instead,” or selects a near different address;
* the candidate turn contains both the rejected target and the selected replacement;
* an exact candidate rejected by ordered-correction logic is reconsidered through the zero-distance approximate branch;
* the older matching turn contains an embedded address;
* the older matching turn contains only a different literal address;
* a typed edit occurs after the old voice evidence;
* strict mode receives the delayed approximate match;
* an address just outside the bounded history is rejected;
* digit words collide with literal word-bearing local parts;
* `to`, `too`, and `for` remain rejected after the bounded-distance matcher runs.

The evidence statement at `.apr/evidence/oriental-email-grounding-pr79.md:52-55` lists several general regression categories, but the patch does not demonstrate that those tests traverse the **new recent-turn branch**. Existing latest-turn tests cannot prove a branch whose defect is specifically candidate-versus-later-turn chronology.

## Control assessment

| Required property            | Assessment                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Superseded address rejection | **Failed.** The candidate turn’s own replacement semantics are skipped.                                                                 |
| Literal mismatch rejection   | **Failed for mixed old/new turns.** Presence of the target suppresses mismatch even when another address is selected.                   |
| Embedded-address rejection   | The guard is called on the candidate turn, but no widened-history hostile test proves it.                                               |
| Invented-address rejection   | **Failed.** Near-address correction and word/digit collisions can authorize a value the visitor did not select.                         |
| Homophone safety             | **Failed.** Excluding `to`/`too`/`for` is insufficient; word local parts and numeric local parts are conflated.                         |
| Stored-value preservation    | No direct string rewrite is introduced, but the validator can authorize the wrong unchanged tool value.                                 |
| Correction freshness         | **Failed.** The candidate turn is excluded from supersession evaluation, and the early return bypasses the existing latest-turn checks. |
| Strict-mode preservation     | Not established for the new delayed-approximate branch; no changed strict-mode test is present.                                         |
| Typed authority              | No typed-authority code is directly changed, but no new test proves that a later typed edit defeats the widened historical match.       |
| Bounded history              | Structurally preserved: the new scan reuses `recentUserTurns` rather than introducing an unbounded transcript scan.                     |

## Exact-head and runtime evidence are incomplete

The evidence document asserts “exact-head GitHub CI: passed” at `.apr/evidence/oriental-email-grounding-pr79.md:45`, but supplies no immutable workflow run, job, required-check inventory, or recorded `head_sha` tying the success to `87202cc4ec4cd9e017434eab68865fc8d79b9325`. The focused count is described as being from “PR creation,” and the 2,208-test result is a combined PRs 78-through-85 run, neither of which substitutes for a final exact-head gate.

The same document explicitly defers canonical staging voice proof until after merge at lines 57-61. There is therefore no deployed-SHA staging evidence showing that the actual Realtime transcript, delayed tool call, verification state, visible draft, and route boundary behave correctly for the widened lookback and spoken-digit cases. The ship contract at `.apr/specs/oriental-email-grounding-closure.md:34-37` requires full gates and both canonical staging voice smokes.

The source contains two independent data-integrity blockers, and the mandatory exact-head CI and staging runtime gates are not proven.

VERDICT: DO NOT MERGE
