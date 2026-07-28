# Oriental conversation-stitching PR 83 exact-tree evidence

## Immutable implementation identity

- implementation head:
  `840b4de90dd072479ab2a2a513ce996be73fc67a`
- base:
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`
- implementation tree:
  `b45829a9f4049ee722eb82eaf94cc2918a4d08cc`
- complete patch:
  `.apr/evidence/oriental-conversation-stitching-pr83.patch`
- patch SHA-256:
  `c53e792d9c066ee64194d6624c8cbb4cd4ab0e542165666442ddb8eb9e4af7fb`

The implementation changes only the admin page, a new pure grouping module,
and its unit tests. Any evidence-only child commits must touch only `.apr/`.
APR must compare the remote PR head with its clean worktree, and GitHub CI must
pass on the final exact PR head.

## Data boundary

`collapseConversations` is a pure presentation function. It does not write to
Convex or modify input rows. Explicit nonempty `conversationId` is authoritative.
Only rows with normalized nonempty captured email can use the fallback.

Fallback groups are bounded to sixty minutes. Candidates are processed in
deterministic chronological order, and the nearest compatible conversation is
selected. A later call beyond the window starts a separate group even with the
same email. Original rows remain in each group's `calls` array.

The server-rendered admin page imports the pure helper and removes its prior
inline implementation; no auth, serialization, persistence, or API contract is
changed.

## Verification evidence

- exact-head GitHub CI: passed before this evidence-only commit
- lint: passed
- strict TypeScript: passed
- focused grouping tests: 6 tests passed
- synthetic integration: all 2,208 tests passed with PRs 78 through 85
- `git diff --check`: passed

Tests cover explicit conversation IDs, same-email fallback, cross-device/new
session behavior, anonymous isolation, distinct-email isolation, sixty-minute
expiry, call preservation, and order independence.

## Release boundary

This is presentation-only source approval. The final merged SHA still requires
the complete test/build/security gate and canonical staging/production proof.
