# Oriental resumed-conversation grouping contract

## Required behavior

1. Only a trimmed nonempty `conversationId` is primary grouping authority;
   explicit and legacy review keys must use disjoint namespaces.
2. A bounded fallback may stitch units only when every participating call has
   the same conservative canonical `capturedEmailNormalized` identity. Raw,
   missing, non-canonical, malformed, whitespace/control-bearing, or conflicting
   email evidence must make the unit ineligible.
3. Anonymous or inconsistent-identity units must never stitch through fallback
   inference, though explicit-ID calls remain together.
4. Different emails must never stitch.
5. The sixty-minute bound must compare actual call timestamps, not a sparse
   explicit unit's enclosing interval.
6. When several clusters qualify, select the smallest actual-call gap with an
   exact code-unit canonical-key tie-breaker; locale collation is forbidden for
   opaque identifiers.
7. Sessions outside the closed sixty-minute window remain distinct enquiries.
8. Every original call remains individually inspectable exactly once.
9. Grouping is presentation-only and must not mutate inputs or persisted
   records.
10. Calls, heads, membership, and output must be deterministic under every input
    permutation, equal timestamps, equal gaps, and canonically distinct Unicode
    opaque identifiers.

## Acceptance evidence

- Exact implementation SHA and complete source-only patch are recorded.
- Unit tests cover explicit, empty, and whitespace IDs; ID namespace collision;
  normalized/raw/missing/conflicting/different and hostile malformed email;
  the exact time boundary; sparse histories; several-compatible nearest
  selection; equal-gap and equal-time permutations; exact Unicode ID ordering;
  original-reference preservation; and input non-mutation.
- Lint, strict TypeScript, combined tests, and exact-head GitHub CI pass.
- Hermetic APR returns an explicit merge verdict.
