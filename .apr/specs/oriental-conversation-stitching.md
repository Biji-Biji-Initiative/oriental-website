# Oriental resumed-conversation grouping contract

## Required behavior

1. Only a trimmed nonempty `conversationId` is primary grouping authority;
   explicit and legacy review keys must use disjoint namespaces.
2. A bounded fallback may stitch units only when every participating call has
   the same valid nonempty `capturedEmailNormalized` value. Raw, missing,
   malformed, or conflicting email evidence must make the unit ineligible.
3. Anonymous or inconsistent-identity units must never stitch through fallback
   inference, though explicit-ID calls remain together.
4. Different emails must never stitch.
5. The sixty-minute bound must compare actual call timestamps, not a sparse
   explicit unit's enclosing interval.
6. When several clusters qualify, select the smallest actual-call gap with a
   canonical key tie-breaker.
7. Sessions outside the closed sixty-minute window remain distinct enquiries.
8. Every original call remains individually inspectable exactly once.
9. Grouping is presentation-only and must not mutate inputs or persisted
   records.
10. Calls, heads, membership, and output must be deterministic under input
    permutations and equal timestamps.

## Acceptance evidence

- Exact implementation SHA and complete source-only patch are recorded.
- Unit tests cover explicit, empty, and whitespace IDs; ID namespace collision;
  normalized/raw/missing/conflicting/different email; the exact time boundary;
  sparse histories; nearest selection; equal-time permutations; preservation;
  and input non-mutation.
- Lint, strict TypeScript, combined tests, and exact-head GitHub CI pass.
- Hermetic APR returns an explicit merge verdict.
