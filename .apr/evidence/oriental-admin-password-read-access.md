# Evidence manifest: Oriental admin password full access

## Frozen implementation

- Base commit: `d29d28005dd8294cdcda9d8c1d7757595cff1e0f`
- Implementation commit: `049f130cac56fc6890b12d2317ef87da7d3082bc`
- Implementation tree: `6e3ee4600fb26c62ed605e7e7571d4be88385ec1`
- Full non-APR diff:
  `.apr/evidence/oriental-admin-password-full-access.patch`
- Full diff bytes: `55945`
- Full diff SHA-256:
  `1fb548daacc1e3445088f55509e9a3e7c5b82b2f4f70ae6f268bcc4134f59dfb`
- Compact runtime-and-test review diff:
  `.apr/evidence/oriental-admin-password-read-access-compact.patch`
- Compact diff bytes: `29801`
- Compact diff SHA-256:
  `95ce7b4db8d0a2d9697c2c9634e9f56f1eb1542060f50bcafa88e5229c1bf222`

The implementation commit follows the superseded read-only review packet. The
net diffs above are calculated from the unchanged base to the final full-admin
implementation so the reviewer evaluates only the resulting contract.

## Authorization outcome

- `lib/admin-permissions.ts` grants the password principal the complete
  canonical permission registry.
- `lib/server/admin-auth.ts` binds verified password logins and cookies to role
  `admin` for thirty minutes.
- Password bearer authentication remains rejected.
- Unsafe cookie requests still require same-origin JSON.
- HMAC storage, collision checks, signed cookie provenance, login rate limits,
  managed bearer credentials, and production validation remain intact.
- Capability-derived UI controls render for the password admin session.

## Local verification

- Focused auth/dashboard/governance Vitest: 44/44 passing.
- `pnpm lint`: passing across 296 files.
- `pnpm typecheck`: passing.
- `pnpm test`: passing full suite with exit status 0.
- `pnpm build`: production compilation and generated build artifacts passing.
- `git diff --check`: passing.

No production credential or customer payload was written to source, command
logs, test artifacts, or this packet.

## Reviewer checks

1. Recompute the implementation commit/tree and both attached diff hashes.
2. Confirm password login is role `admin` with exactly thirty-minute expiry.
3. Confirm the password principal receives every canonical admin permission.
4. Confirm password-as-bearer remains impossible.
5. Confirm same-origin JSON is enforced for password-cookie mutations.
6. Confirm UI controls render because of server-derived capabilities, while
   route authorization remains authoritative.
7. Confirm tests prove mutation admission by reaching `400 invalid_payload`
   without mutating a real record.
8. Confirm review/ops/privacy bearer scopes and HMAC collision protections are
   not weakened.
9. Confirm docs and release governance describe the same full-admin contract.

Live password-to-HMAC proof, exact-SHA staging/production deployment, nonempty
runtime reads, shared Redis limiting, and post-deploy health remain mandatory
post-merge gates and are not claimed by this pre-merge packet.
