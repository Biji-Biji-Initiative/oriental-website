# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The complete implementation under review is the single commit
`f21791098715a4c28db2695227784c78b8f4afad` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `f6c13072aadbcbb4c4e0b0ffcc4439c3389ac151`
- Commit count above the recorded base: `1`
- Full mail patch:
  `.apr/evidence/0001-fix-auth-manage-interactive-password.patch`
- Patch SHA-256:
  `bb9b959f2b818230da1a7d0d0e42085114d18c427f427ce31e087432be48352b`
- The replaced unsafe PR commit
  `4703d44822d2c23f367b23a4664b720e7c8a6f16` is not an ancestor of the
  implementation commit (`git merge-base --is-ancestor` exits `1`).

The saved APR round may be added by an evidence-only child commit after review.
APR must still compare the remote PR head with the clean review worktree and
confirm that any commits after the implementation SHA touch only `.apr/`.
GitHub CI must pass on the final exact PR head.

The patch contains every changed source, test, release, UI, and documentation
file. It is the authoritative implementation input, not the excerpts below.

## Explicit risk boundary

The owner-selected password is a convenience credential and is not represented
as a high-entropy secret or bearer authority. Earlier repository history
contained a universal password alias, so this design does not rely on the
password remaining unknown. The compensating boundary is deliberate:

- only `POST /api/admin/login` can evaluate the password;
- the endpoint requires same-origin JSON before authentication;
- attempts are limited to eight per proxy-owned identity per fifteen minutes;
- successful login produces a signed, HTTP-only, SameSite session;
- every `Authorization: Bearer` path rejects the password;
- the three bearer credentials remain independent, high-entropy secrets;
- the password is never a session-signing key.

The owner has explicitly reaffirmed this exact convenience password. This risk
acceptance does not authorize weakening any of the controls above.

## Login-only implementation and provenance

`verifyAdminLoginCredential` is the only function that can evaluate
`ADMIN_REVIEW_PASSWORD_HMAC`. It returns `interactive_password` for password
success and `review_bearer` for strong-token success. The login route is its
only production call site.

`verifyAdminRequest` never calls the login verifier. Authorization headers are
sent directly to the private `verifyAdminBearerToken`, whose candidates are
only:

1. `ADMIN_REVIEW_TOKEN`,
2. `OPS_AUTOMATION_TOKEN`,
3. `PRIVACY_ADMIN_TOKEN`.

There are twelve admin route handlers. A static governance test inventories all
of them, proves only `app/api/admin/login/route.ts` references
`verifyAdminLoginCredential`, and proves every other handler references
`verifyAdminPermission`.

## Cryptographic boundaries

- Password verifier domain: `oriental-admin-password:v1\0`
- Session-signature domain: `oriental-admin-session:v2\0`
- Password verifier: HMAC-SHA256 keyed only by `ADMIN_REVIEW_TOKEN`
- Session signer: HMAC-SHA256 keyed only by `ADMIN_REVIEW_TOKEN`
- Stored password representation: exactly 64 lowercase hexadecimal characters
- Session format: `v2.<expiresAt>.<role>.<base64url actor>.<signature>`
- Session verification checks field count, version, constant-time signature
  comparison, finite future expiry, governed role, bounded canonical actor
  encoding, and actor validity.

`constantTimeEqual` converts both values to buffers, rejects unequal lengths,
and calls `timingSafeEqual` only for equal-length buffers. The raw password-HMAC
environment value is validated without trimming or quote normalization, so
missing, short, long, uppercase, padded, and nonhex values fail closed.

Rotating `ADMIN_REVIEW_TOKEN` immediately invalidates both the prior session
signature and the prior password HMAC. A new password HMAC deliberately derived
with the new token restores only interactive password login.

## Request and rate-limit boundaries

`POST /api/admin/login` runs these checks in order:

1. same-origin and `application/json`;
2. Redis-backed rate limit with the existing fail-closed memory fallback;
3. schema validation;
4. login-specific credential verification;
5. signed session issuance.

The rate-limit identity uses the proxy-owned rightmost valid
`X-Forwarded-For` address. Tests vary attacker-controlled earlier hops while
holding the proxy-owned address constant and prove the ninth request is blocked.
Missing, malformed, cross-origin, and non-JSON requests are rejected before
credential evaluation.

## Managed release boundary

`ADMIN_REVIEW_PASSWORD_HMAC` is:

- required by production `check-secrets`;
- a member of `MANAGED_APPLICATION_ENVIRONMENT_KEYS`;
- a runtime, non-build-time Coolify value;
- reconciled from the complete Infisical application scope;
- included in post-write parity readback;
- not eligible for implicit retirement.

Tests prove a missing Coolify entry produces an explicit mutation, an exact
readback passes, and a mismatched readback fails. The existing deployer applies
and reads back the complete managed environment before changing the release
SHA. The token/HMAC pair therefore moves as one governed configuration set.

Secret materialization remains a post-merge operation. The derivation command
uses environment input rather than command arguments and emits only the HMAC
into the managed secret write. Neither plaintext password nor
`ADMIN_REVIEW_TOKEN` may appear in logs, patches, shell history, or diagnostics.

## Exact implementation verification

Completed against implementation commit
`f21791098715a4c28db2695227784c78b8f4afad`:

- `pnpm lint`: pass, 280 files
- `pnpm typecheck`: pass
- focused Vitest: pass, 4 files and 57 tests
- `git diff --check`: pass

The focused suite proves:

- password and strong review-token login with distinct provenance;
- password rejection as a bearer;
- missing, short, long, uppercase, padded, and nonhex HMAC failure;
- valid review-token operation when password-HMAC configuration is malformed;
- stale password-HMAC failure after token rotation;
- old signed-session failure after token rotation;
- deliberately co-rotated password-HMAC success;
- missing, malformed, cross-origin, and non-JSON login rejection;
- proxy-hop spoofing cannot rotate login buckets;
- the ninth attempt is rate-limited;
- the login-only call-site inventory across all twelve admin routes;
- managed environment mutation and parity readback for the HMAC.

The conflict-free combined release tree with PRs 78 through 85 was also
validated before this evidence update:

- production dependency audit: no known vulnerabilities;
- lint: pass;
- typecheck: pass;
- Vitest: 86 files and 2,208 tests passed;
- Next.js 16.2.12 production build: pass.

The combined tree must be rebuilt after this hardened implementation commit is
integrated, and exact-head GitHub CI remains mandatory.

## Mandatory post-merge gates

1. Derive the reaffirmed password HMAC without logging either input.
2. Write it to the governed staging and production Infisical scopes.
3. Reconcile and read back the complete managed Coolify environment.
4. Deploy the exact merge SHA to canonical staging.
5. Prove password login, password rejection as a bearer, valid review-token
   behavior, secure session-cookie attributes, exact running SHA, and rate-limit
   behavior.
6. Promote the same SHA to production control.
7. Repeat health, authentication, and managed-environment proof while retaining
   the prior production SHA as the rollback target.
