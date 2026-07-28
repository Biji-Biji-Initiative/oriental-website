## Release-blocking findings

### 1. Blank IDs and cross-namespace collisions bypass every email and time safeguard

`lib/voice-conversation-grouping.ts:39-42` uses:

```ts
const key = session.conversationId ?? session.reviewId;
```

This does not implement the stated **nonempty** conversation-ID authority:

* `conversationId: ""` is not nullish, so every row with an empty ID is placed in the same initial group.
* Repeated whitespace-only IDs have the same problem.
* An explicit `conversationId` equal to another legacy row’s `reviewId` aliases in the same unnamespaced `Map`.

These joins occur during the authoritative first pass, before checking email or time. Two anonymous rows, two different-email rows, or rows separated by days can therefore collapse together.

This needs a trimmed-nonempty validity check and disjoint key domains, such as distinct `conversation:` and `review:` namespaces. Tests must cover empty and whitespace IDs plus an explicit-ID/legacy-review-ID collision.

### 2. Inferred identity is taken from the first email ever observed, not a consistent authoritative email

At `lib/voice-conversation-grouping.ts:45-48`, an entire explicit-ID unit receives one email using:

```ts
const email = calls.reduce(
  (found, call) => found || sessionEmailKey(call),
  "",
);
```

That creates several privacy failures:

* A session beginning with `wrong@example.com` and later corrected to `right@example.com` remains keyed to the superseded first address.
* A unit containing both Alice’s and Bob’s email becomes eligible under whichever nonempty email appears first.
* A unit containing anonymous calls inherits another call’s email and can carry those anonymous calls across an inferred boundary.
* Equal-timestamp conflicting calls make the selected identity depend on input order.

For example, an explicit group containing an early `victim@example.com` capture and a later correction can be stitched to an unrelated `victim@example.com` conversation. The explicit calls properly remain together, but the **external inferred edge** is grounded in stale, conflicting evidence.

Additionally, `sessionEmailKey` at lines 20-21 accepts raw `captured.email` whenever `capturedEmailNormalized` is absent. The supplied test at `tests/voice-conversation-grouping.test.ts:58-64` deliberately enshrines that broader authority. The manifest’s claim that fallback uses only normalized captured email is therefore not established unless the tree separately proves that raw values are valid, canonical, and authoritative; no such proof is attached.

Fallback should fail closed unless the participating unit has one consistent, authoritative, nonempty normalized email. Under the evidence’s stated row-level boundary, any missing or conflicting email must make that unit ineligible for inferred stitching.

### 3. The sixty-minute test can accept calls hours from every real call

The implementation reduces each explicit-ID unit to a broad `[start, end]` interval at `lib/voice-conversation-grouping.ts:45-48`, then checks at lines 63-68:

```ts
unit.start - cluster.end <= CONVERSATION_STITCH_WINDOW_MS
```

This treats all time between an explicit group’s first and last calls as continuous activity.

Concrete counterexample:

* Explicit conversation A has calls at 00:00 and 10:00.
* Conversation B has one same-email call at 05:00.
* B is five hours from either actual A call.

A is processed first with `cluster.end = 10:00`. For B, the computed difference is negative five hours, which satisfies `<= 60 minutes`, so B is stitched into A.

That violates both the strict sixty-minute evidence requirement and the “nearest compatible conversation” requirement. It can even use a future call in A to justify stitching an earlier B call.

Inference must compare actual call timestamps, not membership in a sparse unit’s enclosing interval. A candidate should join only through a real same-email call whose defined chronological gap is at most sixty minutes, with deterministic selection when multiple candidates qualify.

The `<=` endpoint itself is a reasonable closed sixty-minute boundary; the blocker is that negative interval gaps and empty spans bypass that boundary.

### 4. Ordering and even grouping membership are input-dependent on timestamp ties

Every comparator uses only a timestamp:

* Call ordering: `lib/voice-conversation-grouping.ts:46`
* Unit ordering: line 63
* Final call ordering and head selection: lines 79-80
* Conversation ordering: line 83

When timestamps tie, no canonical tie-breaker exists:

* Reversing two same-time calls changes their `calls` order.
* The selected head changes because the last tied input becomes the head.
* Same-time conversation heads change output order.
* If tied calls contain conflicting emails, reversing input changes the email selected at line 47 and can change which conversations merge.

Thus the output is not order-independent or deterministically ordered for valid numeric inputs. A total comparator is required, using an immutable unique field such as `reviewId` after `updatedAt`, together with a canonical explicit-unit key. Permutation tests must include equal timestamps, not merely uniquely ordered examples.

### 5. The evidence manifest materially overstates test and admission coverage

The complete focused test file contains six tests at `tests/voice-conversation-grouping.test.ts:12-74`. It has no test for:

* Different-email isolation.
* Input permutations or equal timestamps.
* Empty or whitespace conversation IDs.
* Conversation-ID/review-ID namespace collisions.
* Conflicting or corrected emails within one explicit group.
* Anonymous calls embedded in an otherwise identified group.
* Sparse explicit histories that bridge the sixty-minute limit.
* Input non-mutation.

Nevertheless, `.apr/evidence/oriental-conversation-stitching-pr83.md:45-47` claims distinct-email isolation and order independence are covered. That claim is false for the attached test file.

The CI evidence is also insufficient for the final admission boundary. Line 38 says CI passed **before an evidence-only commit**, while lines 18-19 require CI on the final exact PR head. No run identity, checked SHA, complete required-check set, or remote-head/clean-worktree comparison is attached. Any source correction will create another head and require a fresh complete exact-SHA run regardless.

Final canonical staging verification is explicitly still outstanding at evidence lines 49-52 and cannot be waived.

## Properties that do hold

The helper does preserve every input row once in a returned `calls` array: no filtering or dropping path is visible. Calls can be wrongly colocated, but they remain present for per-call inspection.

The implementation also performs no persistence operation. It allocates new maps and arrays, sorts copied arrays, creates a shallow head object, and does not write to the input rows. The admin-page patch only replaces the inline helper with an import; it changes no Convex mutation, authentication, serialization, or API code.

Those properties do not compensate for the cross-person grouping and nondeterminism defects.

VERDICT: DO NOT MERGE
