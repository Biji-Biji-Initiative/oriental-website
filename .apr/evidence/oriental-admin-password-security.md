# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The source implementation under review is the exact commit
`cf083667a2e2fd54d478edbc8906ef0f4adf0d19` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `a593231700e3cbc1f38281ca6c7108b89f14fbc0`
- Authoritative source-only patch:
  `.apr/evidence/oriental-admin-password-security.patch`
- Patch SHA-256:
  `f68b58b75df50b559316fd7ae0d778c098f54297d784cdd4f286fab32b746825`
- The patch contains all thirty-eight changed non-APR source, test, release, UI,
  environment-example, and documentation files.

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
- its page and API call only a dedicated Convex aggregate query whose
  Convex-to-Next return type contains `generatedAt` and a fixed numeric metrics
  DTO; an explicit Convex return validator and an independent strict Next-side
  runtime schema reject missing, extra, nonnumeric, nonfinite, negative,
  fractional-count, and out-of-range-percentage values;
- bounded payload-safe lead and voice rows are processed only inside trusted
  Convex execution to calculate aggregates; raw customer records, email
  addresses, transcripts, raw lead or voice evidence, event data, analytics
  detail, and queues never cross into Next or the password principal;
- it cannot mutate, bulk-assign, archive, export, follow up, run evals, execute
  SLA/retention jobs, or delete privacy data;
- raw customer data and interactive actions require signing out and completing a
  fresh managed review-token login; ops and privacy actions retain their
  dedicated bearer principals;
- the supplied password is rejected by every `Authorization: Bearer` path;
- the password and its HMAC never sign a session.

Because the historical password is potentially known, the owner explicitly
accepts disclosure of the permitted aggregate values and their changes over
time, plus repeatable bounded Convex compute after reauthentication. Thirty-
minute expiry does not restore password secrecy or prevent a holder from logging
in again. This acceptance does not extend to raw records, PII, transcripts,
mutations, bearer authority, or signing authority.

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
password HMAC. A successful result is keyed to canonical claims in a module-
private `WeakMap`; the session mint retrieves those claims from the exact
returned object, deletes them before minting, and never trusts caller-visible
fields. Object spread, mutation, symbol discovery, proxies, structural forgery,
and replay therefore cannot relabel or reuse the verified authority. It
requires an explicit timestamp, exhaustively handles exactly
`interactive_password` and `review_bearer`, and owns no default identity. Its
private signer cannot be imported. Both verifier and mint API have one
production import and invocation, in the login route.

`verifyAdminBearerToken` is private and considers only:

1. `ADMIN_REVIEW_TOKEN`,
2. `OPS_AUTOMATION_TOKEN`,
3. `PRIVACY_ADMIN_TOKEN`.

`tests/admin-auth-boundary.test.ts` parses the production AST with the
TypeScript module resolver rather than searching strings. It proves:

- one exact canonical path/method/permission map for twelve admin route modules
  across every supported TypeScript and JavaScript route extension;
- every non-login HTTP export, including `HEAD` and `OPTIONS`, is one immutable
  simple-identifier exported `const` directly initialized by
  `withAdminPermission` with that route method's exact literal permission and
  an inline protected callback;
- `let` reassignment, object/array destructuring, named callbacks, method
  aliases, re-exports, namespace/default/import-equals/dynamic/relative/CommonJS
  imports, CommonJS property and object exports, `Object.assign`, extra login
  methods, wrong-but-valid permissions, and manual positional auth all fail
  hostile fixtures;
- effective TypeScript module exports are compared with the canonical method map;
- star and namespace re-exports, default login handlers, every CommonJS export
  mechanism, and the full hostile matrix across all supported extensions fail;
- all non-test tsconfig sources plus JavaScript sources in any top-level
  directory are scanned, legacy Pages admin handlers are part of the route
  inventory, and checker-resolved symbol calls catch alias and bridge modules;
- exactly one production import and checker-resolved call each of
  `verifyAdminLoginCredential` and `createAdminLoginSession`, both in login;
- `verifyAdminBearerToken` and the private signer are absent from the auth
  module's effective exports and have no outside production call.

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

`docs/09-LAUNCH-CHECKLIST.md` truthfully marks both-scope materialization,
reconciliation, plaintext-alias absence, and live reduced-session proof as
post-merge pending. README and infrastructure guidance state that plaintext
must be absent from source, Infisical, Coolify, and the running container and
require a redacted live readback; they do not claim source review proved current
runtime state.

## Exact implementation verification

Completed against implementation commit
`cf083667a2e2fd54d478edbc8906ef0f4adf0d19`:

- `pnpm lint`: pass, 283 files on the source branch
- strict application and Convex TypeScript: pass
- focused auth, route-governance, aggregate DTO, Convex adapter, and login
  suites: 5 files and 55 tests passed
- `pnpm build`: pass, including all admin route handlers
- source-only `git diff --check`: pass
- GitHub `verify`: success on exact remote source head
  `cf083667a2e2fd54d478edbc8906ef0f4adf0d19`
- synthetic integration commit
  `76746d98e6a7b220c3abaf4a93dd426236fc2b2b`, tree
  `058805ee5d6860b760b14657d3ede08735111a91`, containing all eight exact PR
  source/evidence heads, passed frozen pnpm 10.34.5 install, lint on 293 files,
  strict TypeScript, production audit with zero findings across 378 production
  dependencies, all 89 test files and 2,303 tests, and the Next.js 16.2.12
  production build

The focused suite proves:

- password login creates a viewer-only thirty-minute signed session;
- review-token login creates a configured-role twelve-hour signed session;
- signed provenance survives cookie issuance and verification;
- password sessions authorize only aggregate metrics and same-origin logout;
- the password page, aggregate API, and fixed adapter call only
  `getAdminAggregateMetrics`; raw dashboard and lead-table mocks throw if
  touched, and missing, extra, malformed, nonfinite, fractional-count, and
  out-of-range Convex DTO fields are rejected;
- the server-rendered password page never calls the raw lead-table query and
  renders no raw sentinel data;
- password rejection as bearer auth;
- missing/malformed HMAC failure without disabling the strong token;
- stale password HMAC and both password/review sessions fail after token
  rotation;
- every pre-existing session and bearer plane fails under any password/bearer
  collision;
- co-rotated token/HMAC succeeds;
- missing, malformed, cross-origin, and non-JSON login rejection;
- spoofed earlier forwarding hops cannot rotate the login bucket while two
  distinct proxy-owned identities retain independent buckets;
- the ninth attempt is rejected;
- whole-production, TypeScript-resolved exact permission and login authority;
- module-private one-time `WeakMap` mint-claim enforcement rejects object spread,
  field mutation, symbol discovery, proxies, structural forgery, and replay;
- managed environment mutation and parity readback.

The exact-head GitHub verification and the final synthetic eight-PR integration
are complete. Final merge-head and deployed-runtime gates remain.

APR rounds 4 and 5 correctly rejected broad dashboard materialization, mutable
or destructured handler blind spots, globally-valid but route-wrong
permissions, forgeable or copyable login identities, incomplete effective-export
and complete-runtime route governance, missing strict runtime DTO validation,
incomplete collision cross-products, unproven live documentation claims, and
missing exact-head/integration admission. The implementation and evidence above
close every source and pre-merge blocker. Round 6 must review this exact
regenerated patch. Live secret and deployment checks remain post-merge gates
and are not waived.

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
