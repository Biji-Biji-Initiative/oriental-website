# Oriental resumed-conversation grouping contract

## Required behavior

1. Explicit `conversationId` remains the primary grouping authority.
2. A bounded fallback may stitch sessions sharing the same normalized captured
   email only when calls fall within sixty minutes.
3. Anonymous sessions must never stitch through fallback inference.
4. Different emails must never stitch.
5. The stitch window must be order-independent and use the nearest compatible
   conversation.
6. Sessions outside the window must remain distinct enquiries.
7. Every original call remains individually inspectable inside the group.
8. Grouping is presentation-only and must not mutate persisted records.
9. Output ordering must remain deterministic.

## Acceptance evidence

- Exact implementation SHA and complete patch are recorded.
- Unit tests cover explicit IDs, bounded same-email fallback, no-email,
  different-email, outside-window, and input-order cases.
- Lint, strict TypeScript, combined tests, and exact-head GitHub CI pass.
- Hermetic APR returns an explicit merge verdict.
