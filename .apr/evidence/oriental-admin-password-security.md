# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The source implementation under review is the exact commit
`62122a9bf51d920232ceb84a57512b8bd572b35a` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `61846556ffc9d51384507d55854eca262d8db684`
- Authoritative source-only patch:
  `.apr/evidence/oriental-admin-password-security.patch`
- Patch SHA-256:
  `c67f236c72aef7c635334d79cd1c2553ed08ce4a47e26c8e505243d122e9687c`
- The patch contains all eighteen changed non-APR source, test, release, UI,
  environment-example, and documentation files.
- The replaced unsafe PR commit
  `4703d44822d2c23f367b23a4664b720e7c8a6f16` is not an ancestor of this
  implementation.

The obsolete mail patch that conflicted with the evidence manifest was removed.
The authoritative patch excludes `.apr/`, so saved review rounds cannot change
its bytes or implementation tree. Any child after the implementation commit
must touch only `.apr/`. APR must compare the live PR head with the clean review
worktree and verify that condition. GitHub CI must pass on the final exact PR
head.

## Explicit threat and authority boundary

Earlier repository history exposed a universal password alias. The
owner-selected password is therefore treated as potentially known. It is not a
high-entropy secret, bearer credential, signing key, or full-session credential.

The password is retained only with these compensating controls:

- it can be evaluated only by `POST /api/admin/login`;
- login requires same-origin JSON and is rate-limited to eight attempts per
  proxy-owned identity per fifteen minutes;
- it mints a signed `method=password`, role `viewer` session for thirty minutes;
- viewer authority is limited to `dashboard.read`, `leads.read`, and
  `voice.read`;
- it cannot mutate, bulk-assign, archive, export, follow up, run evals, execute
  SLA/retention jobs, or delete privacy data;
- sensitive actions require a fresh strong review token or the dedicated ops or
  privacy bearer;
- the supplied password is rejected by every `Authorization: Bearer` path;
- the password and its HMAC never sign a session.

The strong `ADMIN_REVIEW_TOKEN` login signs `method=review`, retains the
configured interactive role, and expires after twelve hours. It remains the
only review bearer and the only admin session-signing key.

## Signed provenance and audit behavior

Admin cookies now use:

```text
v3.<expiresAt>.<role>.<base64url actor>.<method>.<signature>
```

The signature covers version, expiry, role, actor, and method under the
domain-separated `oriental-admin-session:v3\0` HMAC. Verification rejects:

- the wrong field count or version;
- invalid or unequal-length signatures;
- expired/nonfinite timestamps;
- unknown roles or methods;
- noncanonical/oversized actors;
- any `method=password` cookie whose signed role is not exactly `viewer`.

Successful login emits bounded `admin_login.succeeded` telemetry containing only
actor, credential method, role, and expiry. It never logs the submitted
credential, password HMAC, review token, cookie, or request body.

## Login-only and bearer call graph

`verifyAdminLoginCredential` is the only function that reads
`ADMIN_REVIEW_PASSWORD_HMAC`. It returns distinct `interactive_password` or
`review_bearer` provenance. `verifyAdminBearerToken` is private and considers
only:

1. `ADMIN_REVIEW_TOKEN`,
2. `OPS_AUTOMATION_TOKEN`,
3. `PRIVACY_ADMIN_TOKEN`.

`tests/admin-auth-boundary.test.ts` parses the production TypeScript/TSX AST
rather than searching strings. It proves:

- exactly one production import and one call of
  `verifyAdminLoginCredential`, both in the login route;
- exactly twelve admin route modules;
- every exported HTTP handler outside login imports and calls
  `verifyAdminPermission`;
- authorization occurs before the first awaited effect in each handler;
- non-login handlers cannot import alternate admin-auth entry points;
- `verifyAdminBearerToken` is not exported and has no outside production call.

Comments, dead string literals, unused imports, aliases, and alternate route
extensions cannot satisfy this contract.

## Cryptographic and rotation boundaries

- Password verifier domain: `oriental-admin-password:v1\0`
- Session signer domain: `oriental-admin-session:v3\0`
- Both use HMAC-SHA256 keyed only by `ADMIN_REVIEW_TOKEN`
- The stored password representation is exactly 64 lowercase hexadecimal
  characters
- Raw HMAC parsing rejects missing, short, long, uppercase, padded, quoted, and
  nonhex values without normalization
- Constant-time comparison rejects unequal lengths before `timingSafeEqual`
- Rotating `ADMIN_REVIEW_TOKEN` immediately invalidates prior password HMACs and
  both password/review sessions

## Managed release boundary

`ADMIN_REVIEW_PASSWORD_HMAC` is required by production preflight, belongs to the
complete managed runtime inventory, reconciles from Infisical into Coolify, and
participates in exact post-write parity readback. Missing values cannot silently
clear or retire it.

`docs/09-LAUNCH-CHECKLIST.md` now truthfully marks both-scope materialization,
reconciliation, and live reduced-session proof as post-merge pending. Current
documentation says the plaintext is absent from the current tree and runtime
configuration while historical exposure is treated as real; it no longer claims
the value was never committed.

## Exact implementation verification

Completed against implementation commit
`62122a9bf51d920232ceb84a57512b8bd572b35a`:

- `pnpm lint`: pass, 281 files
- `pnpm typecheck`: pass
- focused Vitest: 5 files and 59 tests passed
- `git diff --check`: pass

The focused suite proves:

- password login creates a viewer-only thirty-minute signed session;
- review-token login creates a configured-role twelve-hour signed session;
- signed provenance survives cookie issuance and verification;
- password sessions cannot perform `leads.update`;
- password rejection as bearer auth;
- missing/malformed HMAC failure without disabling the strong token;
- stale password HMAC and old sessions fail after token rotation;
- co-rotated token/HMAC succeeds;
- missing, malformed, cross-origin, and non-JSON login rejection;
- spoofed earlier forwarding hops cannot rotate the login bucket;
- the ninth attempt is rejected;
- whole-production AST authorization ownership;
- managed environment mutation and parity readback.

The final synthetic integration and exact-head GitHub CI must be rerun after
this implementation commit. They are mandatory pre-merge gates.

## Mandatory post-merge gates

1. Derive the reaffirmed password HMAC without logging either input.
2. Write it to governed staging and production Infisical scopes.
3. Reconcile and read back the complete managed Coolify environment.
4. Deploy the exact merge SHA to canonical staging.
5. From a clean cookie jar, prove:
   - password login succeeds;
   - signed method is password, role is viewer, and expiry is thirty minutes;
   - the password session reads allowed review data but receives 403 for an
     operator mutation;
   - the password is rejected as bearer;
   - strong review-token login retains the configured role;
   - cookie attributes are HTTP-only, SameSite, Secure in production;
   - the Redis-backed rate limit is stable under spoofed earlier XFF hops.
6. Promote the identical SHA to production and repeat authentication, managed
   environment, health, and exact-running-SHA proof while retaining rollback.
