## Release-blocking findings

The patch closes several round-one chronology defects, but **three exact-source data-integrity defects remain**, including one path that promotes an ambiguous mailbox to confirmed and routeable in adaptive mode.

### 1. BLOCKER — unrelated context suppresses spoken-digit ambiguity and makes either mailbox routeable

`hasAmbiguousSpokenDigitEmail()` returns `false` before examining the target mailbox whenever either condition is true:

* **Any** literal email appears anywhere in the matching turn.
* **Any** punctuation-delimited clause contains both a digit-context word and a spoken digit word.

Neither condition is tied to the email token window, the selected address, or the corresponding email-decision clause. The exact-match path then reports `high`; adaptive mode converts `high` speech directly to `confirmed`; and `route_to_team` may submit when email is the only required field. See `lib/voice/realtime-events.ts:4241-4265`, `3652-3672`, `3470-3491`, and `2254-2292`. ([GitHub][1])

Two deterministic full-reducer cases demonstrate the failure:

```text
Transcript:
  Room number one is ready. My email is two at example dot com.

Model capture:
  value    = 2@example.com
  evidence = two at example dot com
  mode     = adaptive
```

The matcher correctly finds both `two@example.com` and `2@example.com`. But the unrelated first sentence satisfies `hasExplicitSpokenDigitContext()` because it contains “number” and “one.” The ambiguity guard is therefore disabled for the email sentence. The result is `high → confirmed → routeable`, rather than `medium → pending`.

The literal-address bypass is equally unsafe:

```text
Transcript:
  billing@example.com is only for invoices.
  My email is sam one at example dot com.

Model capture:
  value    = sam1@example.com
  evidence = sam one at example dot com
  mode     = adaptive
```

The billing clause is secondary, while the second clause selects the contact address. Nevertheless, the mere presence of `billing@example.com` causes the ambiguity function to return `false`. Either `samone@example.com` or `sam1@example.com` can consequently become high-confidence depending on the model’s choice.

The clean `one/1`, `two/2`, and `samone/sam1` tests all use a single uncomplicated sentence, so they demonstrate the dual interpretation only in the absence of unrelated turn content. They do not prove the required “same decision clause” restriction. ([GitHub][2])

**Required correction:** determine the exact selected email token window and its email-decision clause first. Explicit numeric intent must positively apply to that window and must be polarity-aware. A literal-email exception must require that the literal mention is the selected target itself—not merely that some literal address exists elsewhere in the turn.

### 2. BLOCKER — `to` / `too` / `for` still ground numeric mailboxes through the approximate matcher

The new canonicalizer does not directly replace `to`, `too`, or `for` with digits. However, the full matcher subsequently applies bounded edit distance to every valid, same-length canonical candidate. Thus, the homophones can still support numeric model values through the ASR-drift path.

`spokenEmailSubstitutionDistance()` accepts any likely-email candidate of the same length when its edit distance is within the address-length-derived cap; the delayed/latest approximate path then stores it at medium confidence. See `lib/voice/realtime-events.ts:4193-4214` and `3685-3707`. ([GitHub][1])

Concrete full-matcher traces using a sufficiently long valid domain are:

| Spoken evidence              | Model mailbox         | Canonical spoken candidate | Distance | Allowed cap | Result          |
| ---------------------------- | --------------------- | -------------------------: | -------: | ----------: | --------------- |
| `to at longexample dot com`  | `22@longexample.com`  |       `to@longexample.com` |        2 |           3 | Accepted medium |
| `too at longexample dot com` | `222@longexample.com` |      `too@longexample.com` |        3 |           3 | Accepted medium |
| `for at longexample dot com` | `444@longexample.com` |      `for@longexample.com` |        3 |           3 | Accepted medium |

All six addresses satisfy the implementation’s permissive email syntax check. There is no literal mismatch, embedded collision, or rejection language, so the approximate branch accepts and stores the numeric mailbox.

The attached tests use only:

* `to` or `too` against `2@example.com`
* `for` against `4@example.com`

Those cases reject because the candidate and target lengths differ, causing the matcher to skip them before calculating edit distance. They therefore do **not** establish that homophones cannot ground digits through the complete bounded matcher. ([GitHub][2])

This is not merely a stored-value rewrite issue—the numeric model value remains unchanged—but the grounding boundary has nevertheless treated prohibited homophone evidence as sufficient support for it.

**Required correction:** the approximate matcher must preserve token provenance. Without explicit digit context, an edit path must not introduce numeric characters where the spoken candidate used `to`, `too`, or `for`. Add hostile reducer cases using equal-length pure-numeric mailboxes and domains long enough to reach the three-edit cap.

### 3. BLOCKER — delayed approximate candidates still accept explicit same-turn retractions and spoken replacements

The new candidate guard is materially narrower than the repository’s existing rejection semantics. It recognizes a fixed list such as `no`, `not`, `instead`, `wrong`, and `forget`, but omits unambiguous operations including:

* `scratch that`
* `ignore that`
* `retract that`
* `take that back`
* `cancel that`
* `replace that with`
* `change that to`
* `switch that to`

Because `emailTurnRejectsTarget()` is target-exact, it does not reliably help when the visitor’s ASR form is precisely the one-character approximation being considered. `resolveLiteralEmailSelection()` also cannot help when both addresses were spoken. The approximate branch returns early before the broader correction machinery runs. See `lib/voice/realtime-events.ts:3685-3707` and `3751-3758`. ([GitHub][1])

Deterministic examples are:

```text
Transcript:
  Sam dot carper at gmail dot com, scratch that.

Model capture:
  value    = sam.carter@gmail.com
  evidence = sam dot carter at gmail dot com
```

and:

```text
Transcript:
  Sam dot carper at gmail dot com;
  replace that with final dot address at example dot com.

Model capture:
  value    = sam.carter@gmail.com
  evidence = sam dot carter at gmail dot com
```

For both:

1. The evidence supports the model value.
2. `carper` versus `carter` has positive distance within the cap.
3. There is no literal mismatch.
4. Neither address embeds the other.
5. The new rejection helper returns false.
6. With no later user turn, the approximate branch returns `ok: true, medium`.

The first stores a value the visitor explicitly retracted. The second stores the old approximate candidate despite an explicit spoken-to-spoken replacement in the same turn.

This is especially inconsistent because the existing anaphoric rejection helper already recognizes `scratch`, `ignore`, `retract`, `avoid`, `exclude`, `discard`, `reject`, `remove`, and stop-using forms. Existing tests also treat spoken-email “scratch that,” “forget that,” and “ignore that” as rejection language. ([GitHub][1])

The newly added candidate tests cover only three forms—`No … instead`, `Not …`, and `was wrong`—so they do not close the broader round-one candidate-turn correction blocker. ([GitHub][2])

**Required correction:** apply candidate-relative anaphoric rejection and replacement semantics to the actual approximate email token window. Do not simply apply every global correction cue, because that would recreate the valid “it’s …” false rejection; inspect the disposition following the candidate window and any subsequently selected spoken address.

## Round-one recheck

| Requirement                                          | Result                      | Assessment                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive edit distance                               | **Pass**                    | Approximate candidates require distance `> 0` and within the cap.                                                                                                                             |
| Exact-path reopening                                 | **Pass**                    | An exact occurrence gives distance zero, preventing fallback through the approximate branch; explicit exact replacement is also tested.                                                       |
| Mixed literal selection                              | **Pass**                    | A different or ambiguous literal selection rejects the candidate; literal mismatch is fail closed.                                                                                            |
| Listed `no` / `not` / `wrong` forms                  | **Pass**                    | The newly added cases reject.                                                                                                                                                                 |
| All unambiguous own-turn rejection/replacement forms | **Fail**                    | `scratch`, `retract`, `replace that with`, and similar spoken forms bypass the narrow helper.                                                                                                 |
| Newer typed decision wins                            | **Pass**                    | Later literal selection defeats an older approximate candidate.                                                                                                                               |
| Newer spoken decision wins                           | **Pass across later turns** | The post-candidate slice rejects when a later turn supersedes the target; same-turn spoken replacement remains defective as described above.                                                  |
| Six-user-turn bound                                  | **Pass**                    | Both exact and approximate searches use the final six user turns, and the out-of-window test rejects. ([GitHub][1])                                                                           |
| Strict mode                                          | **Pass**                    | Only adaptive plus high confidence auto-confirms; strict retains pending verification and requires confirmation. ([GitHub][1])                                                                |
| Clean `one/1`, `two/2`, `samone/sam1`                | **Pass only in isolation**  | Both valid interpretations remain medium/pending in the supplied uncomplicated cases.                                                                                                         |
| Digit intent restricted to selected clause           | **Fail**                    | Unrelated number language or an unrelated literal address suppresses ambiguity.                                                                                                               |
| `to` / `too` / `for` through complete matcher        | **Fail**                    | The exact canonicalizer leaves them literal, but edit-distance grounding can still accept pure-numeric mailboxes.                                                                             |
| Stored mailbox rewritten by canonicalizer            | **Pass**                    | Email capture stores the model-provided string, apart from trimming surrounding whitespace; digit folding is evidence-only. `normalizedValue` changes only organisation values. ([GitHub][1]) |

## Admission and runtime proof

The current PR head is `52e1597`, an APR-only child of implementation commit `56641b2`; its changed files are confined to `.apr/`. The visible exact-head `verify` job succeeded on July 28, 2026 in 2 minutes 16 seconds. That is valid current-head CI evidence, but it does not exercise the hostile variants above, and any source correction must produce a new exact-head run. ([GitHub][3])

The required combined-tree admission is not satisfied. PR #78—the stated prerequisite for the macOS regex portability correction and hermetic full-suite run—remains open as of July 28, 2026. Its own test report is not proof of the PR #78 plus PR #79 combined tree. ([GitHub][4])

Canonical staging voice proof also remains mandatory after merge on the exact default-branch SHA. No such proof is part of this source review, so production promotion must remain blocked even after the source defects and combined-tree gate are resolved.

VERDICT: DO NOT MERGE

[1]: https://raw.githubusercontent.com/Biji-Biji-Initiative/oriental-website/56641b29937db8791aab8a838b78d04b940106c3/lib/voice/realtime-events.ts "https://raw.githubusercontent.com/Biji-Biji-Initiative/oriental-website/56641b29937db8791aab8a838b78d04b940106c3/lib/voice/realtime-events.ts"
[2]: https://raw.githubusercontent.com/Biji-Biji-Initiative/oriental-website/56641b29937db8791aab8a838b78d04b940106c3/tests/realtime-events.test.ts "https://raw.githubusercontent.com/Biji-Biji-Initiative/oriental-website/56641b29937db8791aab8a838b78d04b940106c3/tests/realtime-events.test.ts"
[3]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/52e1597 "https://github.com/Biji-Biji-Initiative/oriental-website/commit/52e1597"
[4]: https://github.com/Biji-Biji-Initiative/oriental-website/pull/78 "https://github.com/Biji-Biji-Initiative/oriental-website/pull/78"

