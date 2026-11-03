## Release-blocking findings

### 1. The required six-permutation Unicode equal-time oracle is still absent

The evidence claims that the prior equal-time blocker is closed, but the fixtures do not implement the requirement stated in this review.

* `tests/voice-conversation-grouping.test.ts` patch lines **664–690** exercise all six permutations of three equal-time rows, but their opaque IDs are only `"a"`, `"b"`, and `"z"`.
* The canonically distinct Unicode fixture at patch lines **519–530** uses `"e\u0301"` and `"é"`, but with only two rows it exercises only `2! = 2` permutations.
* There is therefore no test exercising all six equal-time arrangements with canonically distinct Unicode IDs across unit ordering, grouping, head selection, call ordering, and final output ordering.

This matters because the ASCII permutation test would remain green under locale collation. The two-row Unicode test protects ordering inside one explicit unit, but it does not exercise Unicode-sensitive ordering among separate equal-time units or returned heads. The source currently uses the correct exact comparator, but the required regression oracle is missing.

This contradicts the closure claim in `.apr/evidence/oriental-conversation-stitching-pr83.md` lines **101–112**.

**Required correction:** make the three-row equal-time fixture itself use canonically distinct Unicode review IDs—for example `"e\u0301"`, `"é"`, and a third Unicode ID—and run all six permutations with exact expected membership, call order, head, and output order.

### 2. The “nearest compatible cluster” fixture has a false-green path

The implementation correctly sorts compatible clusters by numeric gap first:

```ts
.sort((left, right) =>
  left.gap - right.gap ||
  compareOpaqueIds(left.cluster.key, right.cluster.key)
);
```

That is correct at `lib/voice-conversation-grouping.ts` patch lines **177–181**. However, the test at `tests/voice-conversation-grouping.test.ts` patch lines **440–476** does not prove that gap has precedence.

At the `resume` decision:

* cluster A’s nearest gap is `0.6 × window`;
* cluster B’s nearest gap is `0.9 × window`;
* cluster A was created first; and
* `conversation:conv-a` is also lexicographically smaller than `conversation:conv-b`.

Consequently, all of these incorrect implementations would still pass:

* selecting the first compatible cluster;
* selecting the earliest-created cluster;
* selecting only the smallest opaque key;
* omitting the numeric-gap term from the sort.

The equal-gap fixture does not close this hole: an implementation that always selects the smallest exact key would pass both the current nearest fixture and the equal-gap fixture.

The evidence therefore overstates “actual nearest selection among several compatible clusters” at `.apr/evidence/oriental-conversation-stitching-pr83.md` line **99**.

**Required correction:** construct two already-separated compatible clusters where the later-created, lexicographically larger-key cluster has the smaller actual-call gap. For example, with cluster A calls at `0` and `5.8W`, cluster B at `4.5W`, and the candidate at `5.1W`, A and B initially remain separate, but the candidate is `0.7W` from A and `0.6W` from B. The expected selection must therefore be B, defeating both first-cluster and smallest-key implementations.

## Source behavior that is correctly implemented

The implementation itself closes the substantive privacy and data-integrity defects reviewed previously:

* **Explicit authority:** `conversationId` is trimmed and accepted only when nonempty; explicit and fallback keys use disjoint `conversation:` and `review:` namespaces at grouping patch lines **147–154**.
* **Canonical email authority:** only `capturedEmailNormalized` is consulted. Raw `captured.email` is never used by `sessionEmailKey` at lines **128–130**.
* **Byte-canonical storage:** `canonicalEmailIdentityKey` rejects a value whenever `normalizeStoredEmail(value) !== value`, and then applies conservative ASCII, length, dot, label, domain, TLD, whitespace, and control validation at `lib/email-identity.ts` patch lines **62–92**.
* **Whole-unit consistency:** every call in an explicit unit must produce the same nonempty canonical key; otherwise the unit receives no inferred edge at grouping lines **202–205**.
* **Actual-call temporal comparison:** unit calls are sorted, and `nearestActualCallGap` performs a two-pointer comparison over actual timestamps rather than enclosing intervals at lines **224–236**. The closed boundary uses `<= CONVERSATION_STITCH_WINDOW_MS`.
* **Exact opaque-ID ordering:** `compareOpaqueIds` uses JavaScript’s exact relational string comparison and no locale API at lines **207–222**. It is used for calls, units, equal-gap clusters, heads, and output.
* **Deterministic cluster state:** cluster keys are maintained as the exact minimum namespaced constituent key at lines **183–188**.
* **Reference completeness:** each input row enters exactly one initial group, each unit takes exactly one ineligible or email-cluster branch, each email unit enters exactly one cluster, and each cluster is emitted once. The reference-identity oracle at test patch lines **637–662** additionally checks length, `Set` cardinality, and identity occurrence.
* **Purity:** the caller’s array is never sorted; grouping, call arrays, clusters, and heads are newly allocated. No persistence or Convex mutation was added. The page change only replaces the local presentation helper with the imported pure helper. The non-mutation test is at patch lines **693–713**.

Thus I found no current implementation-level counterexample to the email, namespace, temporal, deterministic-ordering, exact-once, or non-mutation rules. The blockers are admission-proof defects in two specifically mandatory hostile fixtures.

## Admission consequences

Correcting either test changes the exact source commit, implementation tree, patch digest, and focused-test evidence. The current exact-head and synthetic combined-tree results cannot be inherited by the corrected descendant. The regenerated candidate must therefore receive:

* final GitHub CI on the new exact PR head;
* a regenerated combined-tree admission commit containing the corrected PR #83 head and all other exact candidate heads and conflict resolutions;
* the full lint, strict-TypeScript, audit, combined-test, and production-build gates; and
* canonical staging verification before any production promotion, including confirmation that grouping remains presentation-only and does not alter persisted rows.

VERDICT: DO NOT MERGE
