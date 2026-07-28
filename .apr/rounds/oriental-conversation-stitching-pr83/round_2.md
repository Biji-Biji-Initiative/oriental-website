## Release-blocking findings

### 1. Malformed `capturedEmailNormalized` values can still authorize cross-conversation stitching

`sessionEmailKey` uses:

```ts
/^[^\s@]+@[^\s@]+\.[^\s@]+$/u
```

at `lib/voice-conversation-grouping.ts:20-23` (patch lines 56-59). This only establishes one `@`, at least one later dot, and no whitespace. It is not sufficient to establish a valid normalized email.

It accepts, among others:

```text
a..b@example.com
a@example..com
a@example.com<NUL>
```

Consequently, two separate explicit units such as:

```ts
{ reviewId: "a", conversationId: "conv-a",
  updatedAt: 0,
  capturedEmailNormalized: "a@example..com" }

{ reviewId: "b", conversationId: "conv-b",
  updatedAt: 1,
  capturedEmailNormalized: "a@example..com" }
```

receive the same nonempty key. `consistentUnitEmail` approves both units at `lib/voice-conversation-grouping.ts:95-98`; they enter the same `byEmail` bucket and are stitched because their actual-call gap is within sixty minutes.

That directly violates `.apr/specs/oriental-conversation-stitching.md:7-10`: malformed evidence must make the unit ineligible, not become identity authority.

The test titled “never stitches anonymous, raw-only, malformed, or different-email units” is false-confidence evidence. At `tests/voice-conversation-grouping.test.ts:81-111`:

* there is only one raw-only unit;
* there is only one malformed unit;
* neither has a second unit carrying the same invalid evidence.

Therefore, that test would still pass if raw email were incorrectly made authoritative, or if every nonempty malformed normalized value were accepted. There would simply be no matching invalid key to stitch.

This needs a shared authoritative email validator—the same validation contract that creates `capturedEmailNormalized`—or an equivalently conservative parser. The hostile tests must include two distinct explicit IDs with the same raw-only email and two with the same syntactically invalid normalized value, asserting that both pairs remain separate.

### 2. The claimed total and canonical ordering is not total

The implementation uses default-locale `localeCompare` for:

* call ordering and head selection at `lib/voice-conversation-grouping.ts:100-102`;
* unit ordering at `lib/voice-conversation-grouping.ts:104-109`;
* equal-gap cluster tie-breaking at `lib/voice-conversation-grouping.ts:73`;
* canonical cluster-key replacement at `lib/voice-conversation-grouping.ts:78`;
* final output ordering through `compareSessions` at `lib/voice-conversation-grouping.ts:92`.

`localeCompare` is collation, not exact opaque-identifier comparison. Distinct strings can compare equal. For example, the composed string `"é"` and the decomposed string `"e\u0301"` commonly produce a collation result of zero.

That gives a direct permutation counterexample. Put two equal-time calls in the same explicit conversation:

```ts
[
  { reviewId: "\u00e9", conversationId: "conv", updatedAt: 1000 },
  { reviewId: "e\u0301", conversationId: "conv", updatedAt: 1000 },
]
```

`compareSessions` returns zero. JavaScript’s stable sort preserves their input ordering, and the implementation selects the final sorted call as the head. Reversing the input therefore reverses the `calls` order and changes the selected head.

The same defect can make separate equal-time output rows retain input order, and it prevents the supposed canonical key from resolving equal-gap cluster ties. Default collation can additionally vary with runtime locale and ICU configuration.

No invariant in the supplied source restricts `reviewId` or `conversationId` to an ASCII alphabet. `StitchableSession` exposes both as unrestricted strings, so the implementation cannot rely on such an unstated constraint.

Opaque identifiers need a locale-independent exact comparator, for example:

```ts
function compareOpaqueIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
```

That comparator must replace every identifier/key `localeCompare` use. IDs should not be Unicode-normalized before comparison because doing so would collapse distinct opaque identifiers.

### 3. The acceptance suite does not exercise several claimed round-one closures

These are admission-proof defects even where the current ordinary-input implementation appears correct.

The “nearest compatible conversation” test at `tests/voice-conversation-grouping.test.ts:191-218` has:

* `old` at zero;
* `near` at three hours;
* `resume` at three hours plus one second.

When `resume` is evaluated, `old` is outside the sixty-minute window. Only `near` is compatible. A first-compatible implementation, a nearest implementation, and many broken tie implementations would all pass this test. It does not exercise selection among several compatible clusters.

A valid hostile fixture can create two still-separate sparse explicit units whose nearest mutual call gap exceeds sixty minutes, followed by a unit within sixty minutes of both. The test must verify the smaller gap wins. A second fixture must make those two gaps equal and verify the exact canonical-key winner under every input permutation.

The equal-time test at `tests/voice-conversation-grouping.test.ts:220-247` checks only the original ordering and its reversal, with identifiers that collate distinctly. It therefore misses the actual `localeCompare` failure above and does not exercise an equal-gap cluster tie.

Finally, `tests/voice-conversation-grouping.test.ts:249-269` verifies deep-value non-mutation, but there is no test that flattens every returned `calls` array and proves:

* the flattened count equals the input count;
* every original row reference occurs exactly once;
* no extra row occurs;
* all branches—eligible inference, ineligible inference, explicit grouping, and standalone rows—are covered together.

That is explicitly required by `.apr/specs/oriental-conversation-stitching.md:18` and claimed by the evidence manifest, but the claimed preservation test is absent.

## Recheck of the remaining requirements

| Requirement                                      | Result                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trimmed, nonempty explicit IDs                   | **Pass.** Optional chaining plus `trim()` and the truthiness check at `lib/voice-conversation-grouping.ts:42-43` make blank and whitespace-only IDs fall back.                                                                                |
| Explicit/review namespace separation             | **Pass.** `conversation:` and `review:` prefixes are disjoint.                                                                                                                                                                                |
| Raw email has no authority                       | **Pass in current source**, but the test does not independently prove this because it supplies only one raw-only unit.                                                                                                                        |
| Missing or conflicting identity blocks inference | **Pass.** `consistentUnitEmail` requires every call to produce the same nonempty key. Explicit-ID grouping remains intact.                                                                                                                    |
| Malformed identity blocks inference              | **Fail.** The validator admits plainly malformed values.                                                                                                                                                                                      |
| Actual-call sixty-minute bound                   | **Pass.** `nearestActualCallGap` compares sorted call timestamps directly, and `<=` correctly includes the exact endpoint. The sparse-history implementation does not use an enclosing interval.                                              |
| Nearest compatible cluster                       | **Implemented for ordinary identifiers**, but its deterministic tie contract fails because key comparison is not total, and the claimed nearest-selection test has only one compatible cluster.                                               |
| Every input row appears once in `calls`          | **Pass by source control-flow inspection.** Each input enters one initial group, each unit enters one cluster or standalone result once, and no filtering or multi-cluster append exists. The required exact-once regression test is missing. |
| Input mutation                                   | **Pass.** All sorting occurs on copied arrays; cluster appends mutate newly allocated arrays; returned heads are object spreads.                                                                                                              |
| Persistence mutation                             | **Pass.** The helper has no persistence dependency or write, and the admin-page change only replaces the local helper with the imported pure helper.                                                                                          |

## Admission status

The evidence manifest itself leaves exact-head GitHub CI, combined-tree test/build/security admission, and canonical staging verification outstanding at `.apr/evidence/oriental-conversation-stitching-pr83.md:86-89`. The claimed local lint, TypeScript, focused-test, and build results cannot substitute for those gates.

Those gates remain mandatory after the source and hostile-test blockers above are corrected. They cannot cure the current privacy failure because the present focused suite permits it to remain green.

VERDICT: DO NOT MERGE
