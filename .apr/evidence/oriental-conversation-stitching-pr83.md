# Oriental conversation-stitching PR 83 exact-source evidence

## Immutable implementation identity

- source implementation commit:
  `acbf066104d6b603d092fdc02554c6dd5a67089d`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `6e4d1158cefb9dfe8f826492392bc48736c5ca92`
- complete source-only patch:
  `.apr/evidence/oriental-conversation-stitching-pr83.patch`
- patch SHA-256:
  `9b9d0f66e6e87faf6488a10187fc85e725a5eabee11bb72cf4310c1da24dad5f`

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
identity helper deliberately accepts only conservative, byte-canonical ASCII
addresses: normalization must return the exact stored value, so case-foldable,
trim-recoverable, or otherwise normalizable values have no inference authority.
It also rejects whitespace and controls, multiple `@` signs, invalid local
characters, leading/trailing/consecutive local dots, invalid or empty domain
labels, consecutive domain dots, and non-letter or out-of-range TLDs.
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
`acbf066104d6b603d092fdc02554c6dd5a67089d`:

- `pnpm lint`: passed, 283 files;
- strict TypeScript: passed;
- the focused grouping suite passed all 25 hostile tests;
- production Next.js 16.2.10 build: passed;
- source-only `git diff --check`: passed;
- GitHub `verify`: success on exact source head
  `acbf066104d6b603d092fdc02554c6dd5a67089d`;
- synthetic eight-PR integration commit
  `94c4457a37820d5cfbac220ac4881c19cc296005`, tree
  `2236e4bf2c93545431c38484ab2326b48cb9dec3`, containing every current PR
  implementation source head (later descendants are APR-only), passed frozen
  pnpm 10.34.5 install, warning-free lint on
  295 files, strict TypeScript, production audit with zero findings across 378
  production dependencies, all 89 test files and 2,337 tests, and the Next.js
  16.2.12 production build.

The hostile tests cover trimmed explicit IDs, blank and whitespace IDs, ID
namespace collision, same/different/anonymous/raw/malformed identities,
consecutive dots and control bytes, two equivalent noncanonical identities,
mixed canonical/noncanonical explicit units, wholly noncanonical units against
a canonical external unit, conflicting and missing identity within explicit
units, the closed sixty-minute endpoint, beyond-window isolation,
sparse-history rejection, actual nearest selection where the later-created,
lexicographically larger-key cluster wins solely because its real call gap is
smaller, equal-gap canonical selection with composed/decomposed Unicode cluster
keys under all 24 permutations, all six equal-time permutations using three
canonically distinct Unicode opaque IDs across membership, call order, head, and
output order, exact-once original-reference preservation across every grouping
branch, and input non-mutation.

APR round 4 correctly rejected a nearest-cluster fixture whose expected cluster
also won creation and key order, plus an ASCII three-row equal-time fixture that
could not detect locale collation across every output surface. The corrected
fixtures close both proof gaps without changing production behavior. Round 5
must review this exact regenerated patch without waiving managed runtime
verification.

## Remaining admission gates

APR merge verdict, final exact-head GitHub CI, and canonical staging/production
verification remain mandatory.
