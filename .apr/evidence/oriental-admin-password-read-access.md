# Evidence manifest: Oriental admin password read access

## Frozen implementation

- Base commit: `d29d28005dd8294cdcda9d8c1d7757595cff1e0f`
- Implementation commit: `c6d48da1a8ef0dbbc1cc676b4f97d9fe8ee35351`
- Implementation tree: `192cee4bde43bfa2f323409296255311701dab1f`
- Source patch: `.apr/evidence/0001-fix-auth-let-password-viewers-read-CRM.patch`
- Patch bytes: `51915`
- Patch SHA-256: `df8ce87affd83dce99960d4a51f10c734951abf38fbe77e881b77a8893865397`

The implementation commit contains seventeen tracked-file changes. The APR
packet is deliberately a descendant so review evidence cannot alter the frozen
implementation tree being reviewed.

## Authorization change

- `lib/admin-permissions.ts` grants the password principal read capabilities
  only: aggregate dashboard, full dashboard, leads, voice, and logout.
- `lib/server/admin-auth.ts` delegates password authorization to the canonical
  permission registry instead of applying a second aggregate-only override.
- No password mutation permission was added.
- Password bearer authentication, session role, session duration, cookie
  properties, HMAC verification, and rate limiting were not weakened.
- UI capabilities are calculated server-side. Mutation controls are absent for
  password viewers, while mutation endpoints remain authoritative and return
  `403`.

## Local verification on the exact implementation tree

- Focused Vitest: 60/60 passing, then strengthened auth/dashboard/governance
  subset 44/44 passing.
- `pnpm lint`: passing across 296 files.
- `pnpm typecheck`: passing.
- `pnpm test`: passing full suite with exit status 0.
- `pnpm build`: passing with Next.js 16.2.12.
- Focused Playwright release test in system Chrome: 1/1 passing against real
  staging Convex read data using an ephemeral local password and ephemeral auth
  settings. Password-as-bearer was rejected and mutation returned `403`.
- `git diff --check`: passing.

No production credential was written to the source tree, command log, test
artifact, or APR packet. Generated Playwright traces and screenshots were
removed after verification.

## Reviewer checks

Recompute the implementation commit and tree from Git, then inspect the patch.
At minimum, verify:

1. The password principal has full required read access but no write/evaluation
   capability.
2. Every mutation is rejected server-side independently of UI visibility.
3. Password-as-bearer remains impossible and the session remains viewer-only
   and thirty minutes.
4. The full dashboard and voice-detail reads are permission gated.
5. Read-only component paths cannot render actionable mutation controls.
6. Review-token functionality is preserved.
7. Tests prove real record visibility and a real `403` mutation denial rather
   than checking copy alone.
8. Documentation and release governance agree with the implementation.
9. No secret or customer data was added to the repository or logs.

Live staging and production proof, managed-secret readback, Redis shared-limit
proof, exact-SHA promotion, and post-deploy health are intentionally post-merge
gates and are not claimed by this pre-merge packet.
