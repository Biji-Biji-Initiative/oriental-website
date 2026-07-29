## Blocking findings

### 1. Non-canonical normalized-email values can still acquire inference authority

**Path:** `lib/email-identity.ts:14-17` and `lib/voice-conversation-grouping.ts:96-99`
**Patch lines:** 62-65 and 202-205
**Contract:** `.apr/specs/oriental-conversation-stitching.md:7-10`

`canonicalEmailIdentityKey` validates the **result** of `normalizeStoredEmail(value)`:

```ts
const email = normalizeStoredEmail(value);
```

It never proves that the stored `capturedEmailNormalized` value was already canonical. Consequently, any non-canonical value that `normalizeStoredEmail` transforms into an accepted address receives inference authority. Formally, for any `x` where:

```ts
normalizeStoredEmail(x) === canonicalAddress
```

both `x` and `canonicalAddress` produce the same identity key. `consistentUnitEmail` then treats them as consistent because it compares only those transformed keys:

```ts
return email && calls.every((call) => sessionEmailKey(call) === email) ? email : "";
```

This violates the fail-closed requirement that **non-canonical stored values make the entire unit ineligible**. It can also let one canonical call and one rewritten/non-canonical call pass the “same identity on every call” requirement.

The hostile cases at `tests/voice-conversation-grouping.test.ts:309-321` only exercise values rejected after parsing—consecutive dots, NUL, and leading whitespace. They do not exercise a syntactically recoverable value that the imported normalizer changes.

The helper must perform a round-trip canonicality check before granting authority, for example:

```ts
const email = normalizeStoredEmail(value);
if (email !== value) return "";
```

Alternatively, validate `value` directly after confirming that the authoritative normalizer returns it byte-for-byte unchanged. Add tests for every transformation the existing normalizer performs, including at least:

* two matching non-canonical values remaining separate;
* one canonical and one equivalent non-canonical value making an explicit unit ineligible;
* a non-canonical unit not joining a canonical external unit.

Until that check exists, two records that the privacy contract requires to remain separate can be inferred into one conversation.

### 2. The round-two permutation and Unicode tie-break proof remains incomplete

**Path:** `tests/voice-conversation-grouping.test.ts:236-288,350-377`
**Patch lines:** 478-530 and 592-619
**Contract:** `.apr/specs/oriental-conversation-stitching.md:23-25,32-34`

The implementation itself now uses exact JavaScript relational comparison rather than locale collation:

```ts
return left < right ? -1 : left > right ? 1 : 0;
```

That comparator is correctly used for call ordering, unit ordering, cluster-gap ties, and head ordering at `lib/voice-conversation-grouping.ts:101-116`. However, the required hostile proof does not exercise every affected path:

* The equal-gap test enumerates all 24 permutations, but uses only ASCII cluster IDs (`conv-a`, `conv-b`). `localeCompare` would choose the same order for that fixture, so the test would not detect reintroduction of locale collation specifically in the cluster tie-break.
* The canonically distinct Unicode test uses `é` and `e\u0301`, but only inside one explicit conversation. It exercises call/head ordering, not an equal-gap choice between clusters whose canonical namespaced keys contain those IDs.
* The three-row equal-timestamp test checks only the original input and its reversal. It does not enumerate all six permutations despite the explicit every-permutation requirement.

A sufficient regression fixture should use canonically distinct Unicode `conversationId` values in the equal-gap cluster test and retain the all-24-permutations loop. The equal-time three-row test should iterate `permutations(calls)` and assert the exact expected calls, head, membership, and output order for all six arrangements.

This is not merely additional coverage: locale collation in the equal-gap branch would currently survive the hostile suite that is claimed to close the prior locale-sensitive-ordering blocker.

### 3. Mandatory admission gates have not passed

**Path:** `.apr/evidence/oriental-conversation-stitching-pr83.md:77-89,107-110`

The attached evidence expressly records incomplete or non-green admission:

* The macOS release suite still had a failure, even though it is attributed to a pre-existing Bash defect.
* The exact-commit Linux run still had a timed-out CLI subprocess test.
* Only the macOS production build is reported.
* Exact-head GitHub CI is still listed as outstanding.
* Combined-tree test/build/security admission is still listed as outstanding.
* Canonical staging/production verification is still listed as outstanding.

Attribution to pre-existing or host-load causes does not convert a failed mandatory run into a passing admission result. The evidence itself correctly says the combined-tree run remains a gate. An exact source commit run also cannot substitute for verification of the remote PR head plus permitted APR-only descendants.

Before merge, the evidence must show:

1. remote PR head/source identity reconciliation against `267756841dcbef362c5d741ed80240c885d88479`;
2. all required exact-head GitHub checks passing;
3. the complete combined-tree lint, strict TypeScript, tests, production build, and security admission passing without exclusions or timeouts;
4. exact candidate deployment to canonical staging, including confirmation that explicit reconnects group, prohibited inferred identities remain separate, boundary/nearest behavior matches the source contract, and no persisted session row changes occur.

## Rechecked source behavior

The following round-one and round-two implementation defects are otherwise closed in the attached patch:

* **Explicit-ID authority:** `lib/voice-conversation-grouping.ts:43-47` trims IDs, treats an empty result as absent, and uses disjoint `conversation:` and `review:` namespaces.
* **Raw, missing, malformed, and conflicting identities:** raw `captured.email` is never consulted; every call in an explicit unit must return the same nonempty identity key. The remaining defect is specifically that non-canonical values can first be transformed into such a key.
* **Actual-call temporal distance:** `lib/voice-conversation-grouping.ts:118-130` computes the minimum distance between sorted actual calls, not interval endpoints. The closed 60-minute boundary and sparse-history cases are represented.
* **Nearest compatible cluster:** `lib/voice-conversation-grouping.ts:71-84` evaluates every existing cluster, sorts by actual-call gap, and then by the opaque cluster key.
* **Exact code-unit comparison in production source:** no locale-sensitive comparator remains in the changed implementation.
* **Exact-once preservation:** each unit enters exactly one no-email branch or one email bucket, and each email unit enters exactly one cluster. Original row objects are retained in the returned `calls` arrays.
* **Purity:** all sorting occurs on newly allocated arrays or internal cluster arrays. The caller’s array and row objects are not modified, and the changed admin page introduces no persistence mutation.

The non-canonical identity defect is independently merge-blocking, and the missing hostile proof and unfinished mandatory admission gates reinforce the rejection.

VERDICT: DO NOT MERGE
