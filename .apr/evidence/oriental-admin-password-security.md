# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The source implementation under review is the exact commit
`a79184b5d60aeeb5eca1c8071bfc6d5ba9accb5c` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `3ee9f9a4f5082deb958f43427c6aab7766d7b180`
- Authoritative source-only patch:
  `.apr/evidence/oriental-admin-password-security.patch`
- Patch SHA-256:
  `5d133743bec08f6085c1a8e08f0320a644d6a7ed2fe8537d0684202b495eaf39`
- The patch contains all thirty-five changed non-APR source, test, release, UI,
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
- password-session authority is limited to `dashboard.aggregate` and
  `session.logout`;
- it cannot read customer records, email addresses, transcripts, raw lead or
  voice evidence, analytics detail, or queues;
- it cannot mutate, bulk-assign, archive, export, follow up, run evals, execute
  SLA/retention jobs, or delete privacy data;
- raw customer data and interactive actions require signing out and completing a
  fresh managed review-token login; ops and privacy actions retain their
  dedicated bearer principals;
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

`verifyAdminLoginCredential` is the only function that reads and verifies the
password HMAC. The only public session-minting API accepts a narrowed successful
login result, requires an explicit timestamp, exhaustively handles exactly
`interactive_password` and `review_bearer`, and owns no default identity. Its
private signer cannot be imported. Both verifier and mint API have one
production import and invocation, in the login route.

`verifyAdminBearerToken` is private and considers only:

1. `ADMIN_REVIEW_TOKEN`,
2. `OPS_AUTOMATION_TOKEN`,
3. `PRIVACY_ADMIN_TOKEN`.

`tests/admin-auth-boundary.test.ts` parses the production AST rather than
searching strings. It proves:

- one exact canonical inventory of twelve admin route modules across every
  supported TypeScript and JavaScript route extension;
- every non-login HTTP export, including `HEAD` and `OPTIONS`, is an exported
  const directly initialized by `withAdminPermission` with a canonical literal
  permission and inline protected callback;
- variable handlers, named callbacks, method aliases, re-exports, namespace or
  dynamic imports, CommonJS exports, and manual positional auth checks fail the
  analyzer's hostile fixtures;
- the structural wrapper authenticates and authorizes before the protected
  callback can parse a body, await I/O, log, or mutate state;
- exactly one production import and call each of
  `verifyAdminLoginCredential` and `createAdminLoginSession`, both in login;
- `verifyAdminBearerToken` is not exported and has no outside production call.

Comments, dead string literals, unused imports, aliases, alternate methods, and
alternate route extensions cannot satisfy this contract.

## Cryptographic and rotation boundaries

- Password verifier domain: `oriental-admin-password:v1\0`
- Session signer domain: `oriental-admin-session:v3\0`
- Both use HMAC-SHA256 keyed only by `ADMIN_REVIEW_TOKEN`
- The stored password representation is exactly 64 lowercase hexadecimal
  characters
- Raw HMAC parsing rejects missing, short, long, uppercase, padded, quoted, and
  nonhex values without normalization
- Production secret validation HMACs the review, ops, and privacy bearer
  candidates under the same domain/key and rejects any value equal to the stored
  password HMAC without printing credential material
- Runtime auth returns `unconfigured` on an actual password/bearer collision for
  login, session-cookie, review bearer, ops bearer, and privacy bearer planes
- Missing or malformed password metadata disables password verification and
  password-session acceptance without disabling distinct bearer principals
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
`a79184b5d60aeeb5eca1c8071bfc6d5ba9accb5c`:

- `pnpm lint`: pass, 283 files
- `pnpm typecheck`: pass
- admin and secret focused Vitest: 18 files and 105 tests passed
- `pnpm build`: pass, including all admin route handlers
- `git diff --check`: pass
- full standalone branch Vitest: 79 files and 2,195 tests passed; the remaining
  15 failures are the exact-base macOS Node localStorage and Bash ERE
  portability defects already corrected and independently reviewed in PR #78.
  Final combined-tree admission must prove all tests after #78 is integrated.

The focused suite proves:

- password login creates a viewer-only thirty-minute signed session;
- review-token login creates a configured-role twelve-hour signed session;
- signed provenance survives cookie issuance and verification;
- password sessions authorize only aggregate metrics and same-origin logout;
- raw dashboard, lead, voice, transcript, and mutation permissions return
  forbidden for the same signed password cookie;
- the server-rendered password page never calls the raw lead-table query and
  renders no raw sentinel data;
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
   - the password session reads only PII-free aggregate metrics and receives 403
     from raw review, lead, transcript/voice, and mutation routes;
   - the password is rejected as bearer;
   - strong review-token login retains the configured role;
   - cookie attributes are HTTP-only, SameSite, Secure in production;
   - the Redis-backed rate limit is stable under spoofed earlier XFF hops.
6. Promote the identical SHA to production and repeat authentication, managed
   environment, health, and exact-running-SHA proof while retaining rollback.
