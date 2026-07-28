# Oriental conversation-stitching PR 83 exact-source evidence

## Immutable implementation identity

- source implementation commit:
  `267756841dcbef362c5d741ed80240c885d88479`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `75405539423958eec5e4a8192705bd4b12bee42f`
- complete source-only patch:
  `.apr/evidence/oriental-conversation-stitching-pr83.patch`
- patch SHA-256:
  `d8ee0f379c0807a3989236723a91c6919fbd705c47a7ef7565fb45beb2f6b022`

The source range changes only the admin page, a conservative email-identity
helper, the pure grouping module, and its unit tests. Earlier APR evidence
commits are in branch ancestry; the regenerated source-only patch is the
complete review boundary. Any descendant after the implementation commit may
touch only `.apr/`. APR must compare the remote PR head with this implementation
plus APR-only descendants, and final exact-head GitHub CI must pass.

## Explicit identity boundary

Only a trimmed nonempty `conversationId` is authoritative. Map keys use
disjoint `conversation:` and `review:` namespaces, so:

- empty or whitespace IDs fall back to their unique review IDs;
- an explicit conversation ID cannot collide with a legacy review ID; and
- explicit reconnect calls stay together regardless of missing or conflicting
  inferred identity.

## Fail-closed inferred identity

Cross-ID inference uses only `capturedEmailNormalized`. Raw
`captured.email`, blank values, and malformed values have no authority. The
identity helper deliberately accepts only conservative canonical ASCII
addresses: it rejects whitespace and controls, multiple `@` signs, invalid
local characters, leading/trailing/consecutive local dots, invalid or empty
domain labels, consecutive domain dots, and non-letter or out-of-range TLDs.
Valid-but-unusual internationalized addresses remain separate by design because
a false negative is safer than joining two customers. Every call in an explicit
unit must carry the same identity key; a missing, malformed, non-canonical, or
conflicting value makes the whole unit ineligible for inferred edges. This
prevents a stale first capture, later correction, anonymous embedded call, or
input ordering from selecting another person's identity.

## Actual-call temporal boundary

The sixty-minute test compares actual sorted call timestamps. It never uses a
sparse explicit unit’s broad `[start, end]` interval. A unit with calls at hour
0 and hour 10 therefore cannot absorb an unrelated hour-5 call.

When several same-email clusters exist, the unit joins the compatible cluster
with the smallest actual-call gap. Equal gaps use the canonical namespaced key
as a deterministic tie-breaker. The endpoint at exactly sixty minutes is
included; sixty minutes plus one millisecond is excluded.

All call and unit ordering uses a total `(updatedAt, reviewId)` comparator with
exact JavaScript code-unit comparisons for opaque IDs; locale collation is never
used. Equal timestamps, equal cluster gaps, canonically distinct Unicode IDs,
and every input permutation therefore produce the same call order, head,
grouping membership, and output order.

## Purity and completeness

The helper allocates maps and copied arrays, never persists data, and never
sorts the caller’s input array. Every input row appears exactly once in a
returned `calls` array. The server-rendered admin page only imports the pure
helper; authentication, serialization, Convex, and API behavior are unchanged.

## Verification evidence

Against source implementation commit
`267756841dcbef362c5d741ed80240c885d88479`:

- `pnpm lint`: passed, 283 files on macOS and canonical Linux;
- strict TypeScript: passed on macOS and canonical Linux;
- focused grouping plus data-payload suite: 2 files and 25 tests passed;
  the grouping file alone passed all 21 hostile tests on both platforms;
- production Next.js 16.2.10 build: passed on macOS;
- `git diff --check`: passed;
- the macOS release suite passed 83 files and 2,211 tests; its sole failure is
  the pre-existing macOS Bash `{20,256}` portability defect fixed by PR 78;
- an exact-commit Linux run likewise passed 83 files and 2,211 tests, including
  the previously failing deployment test, while one unrelated CLI subprocess
  test exceeded its fixed five-second timeout on the heavily loaded APR host.
  It passes on macOS and remains a combined-tree admission gate after the APR
  browser workload drains.

The hostile tests cover trimmed explicit IDs, blank and whitespace IDs, ID
namespace collision, same/different/anonymous/raw/malformed identities,
consecutive dots and control bytes, conflicting and missing identity within
explicit units, the closed sixty-minute endpoint, beyond-window isolation,
sparse-history rejection, actual nearest selection among several compatible
clusters, equal-gap canonical selection under all 24 permutations, exact
composed/decomposed Unicode ordering, exact-once original-reference
preservation across every grouping branch, and input non-mutation.

APR round 1 correctly rejected blank-ID collisions, raw or inconsistent email
authority, interval bridging, partial ordering, and overstated evidence. Round 2
correctly rejected the permissive normalized-email regex, locale-sensitive
opaque-ID ordering, and insufficient nearest/tie/reference hostile fixtures.
The exact implementation above closes every source blocker. Round 3 must review
this regenerated patch without waiving remaining admission gates.

## Remaining admission gates

APR merge verdict, exact-head GitHub CI, combined-tree test/build/security
proof, and canonical staging/production verification remain mandatory.
