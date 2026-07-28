# Oriental conversation-stitching PR 83 exact-source evidence

## Immutable implementation identity

- source implementation commit:
  `4a79dad0cc1331e3fb9a53cb9b107c7ebdd98344`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `1569cd0c00e2dc1d371476f5847af0b0759fe9de`
- complete source-only patch:
  `.apr/evidence/oriental-conversation-stitching-pr83.patch`
- patch SHA-256:
  `4135f8499415e0a3e4079e1aab96608f369e4fca34a241fba29003bd5b0649c4`

The source range changes only the admin page, the pure grouping module, and its
unit tests. An earlier APR evidence commit is in branch ancestry; the
regenerated source-only patch is the complete review boundary. Any descendant
after the implementation commit may touch only `.apr/`. APR must compare the
remote PR head with this implementation plus APR-only descendants, and final
exact-head GitHub CI must pass.

## Explicit identity boundary

Only a trimmed nonempty `conversationId` is authoritative. Map keys use
disjoint `conversation:` and `review:` namespaces, so:

- empty or whitespace IDs fall back to their unique review IDs;
- an explicit conversation ID cannot collide with a legacy review ID; and
- explicit reconnect calls stay together regardless of missing or conflicting
  inferred identity.

## Fail-closed inferred identity

Cross-ID inference uses only `capturedEmailNormalized`. Raw
`captured.email`, blank values, and malformed values have no authority. Every
call in an explicit unit must carry the same valid normalized email; a missing
or conflicting value makes the whole unit ineligible for inferred edges. This
prevents a stale first capture, later correction, anonymous embedded call, or
input ordering from selecting another person’s identity.

## Actual-call temporal boundary

The sixty-minute test compares actual sorted call timestamps. It never uses a
sparse explicit unit’s broad `[start, end]` interval. A unit with calls at hour
0 and hour 10 therefore cannot absorb an unrelated hour-5 call.

When several same-email clusters exist, the unit joins the compatible cluster
with the smallest actual-call gap. Equal gaps use the canonical namespaced key
as a deterministic tie-breaker. The endpoint at exactly sixty minutes is
included; sixty minutes plus one millisecond is excluded.

All call and unit ordering uses a total `(updatedAt, reviewId)` comparator.
Equal timestamps and input permutations therefore produce the same call order,
head, grouping membership, and output order.

## Purity and completeness

The helper allocates maps and copied arrays, never persists data, and never
sorts the caller’s input array. Every input row appears exactly once in a
returned `calls` array. The server-rendered admin page only imports the pure
helper; authentication, serialization, Convex, and API behavior are unchanged.

## Verification evidence

Against source implementation commit
`4a79dad0cc1331e3fb9a53cb9b107c7ebdd98344`:

- `pnpm lint`: passed, 282 files;
- strict TypeScript: passed;
- focused grouping suite: 1 file and 13 tests passed;
- production Next.js 16.2.10 build: passed;
- `git diff --check`: passed.

The tests cover trimmed explicit IDs, blank and whitespace IDs, ID namespace
collision, same/different/anonymous/raw/malformed emails, conflicting and
missing identity within explicit units, the closed sixty-minute endpoint,
beyond-window isolation, sparse-history rejection, nearest-cluster selection,
equal timestamps, input permutations, row preservation, and input
non-mutation.

APR round 1 correctly rejected blank-ID collisions, raw or inconsistent email
authority, interval bridging, and partial ordering. The implementation above
closes every source blocker. Round 2 must review this regenerated exact patch.

## Remaining admission gates

APR merge verdict, exact-head GitHub CI, combined-tree test/build/security
proof, and canonical staging/production verification remain mandatory.
