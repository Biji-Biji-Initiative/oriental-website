# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The source implementation under review is the exact commit
`0a2321f8e003fade6f6a0c28d47d73a3f7b213df` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `861f29a18463f021e2f5c0a38255738e167c7d08`
- Authoritative source-only patch:
  `.apr/evidence/oriental-admin-password-security.patch`
- Patch SHA-256:
  `3947b670c11d2100d8fdb2300197a864de245805f139b0d3fe4bd31598fa2ec6`
- The 6,602-line, 313,649-byte patch contains all forty-five changed non-APR
  source, test, release, UI, environment-example, workflow, and documentation
  files.

The obsolete mail patch that conflicted with the evidence manifest was removed.
The authoritative patch excludes `.apr/`, so saved review rounds cannot change
its bytes or implementation tree. APR must compare the live PR head with the
clean review worktree and verify that every implementation byte is represented
by the patch. GitHub CI passed on the exact source implementation head; the
final evidence-only descendant head is a separate mandatory check.

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

`tests/admin-auth-boundary.test.ts` parses the complete governed production AST
with the TypeScript module resolver rather than searching strings. Its checker
program is built from governed production roots, then expands through
`program.getSourceFiles()` to every reachable repository-local non-declaration
TypeScript or JavaScript source, including imported hidden, test-named,
generated, and vendor paths. It throws if any governed checker source is absent.
Its shared, program-scoped semantic index caches TypeScript symbol/declaration
identity and function-return summaries, including assignment-backed aliases,
class property arrows, destructured object methods, any-typed object properties,
imported helper declarations in other checker-program source files, and
Function.prototype bind/call/apply mediation. The same cached graph is shared by
privileged loader identity, global Object/Reflect mutation identity, private
authority taint, mutable-export identity, actual receiver resolution, and
dynamic vector expansion. Local shadows of protected built-ins remain safe
because their resolved symbols differ. It covers declarations, function
expressions, arrows, class property arrows, object/class methods, getters,
setters, static members, instances, and cross-file imported helpers. It proves:

- effective URL matching over all App and Pages route candidates, including
  `src` roots, route groups, interception segments, flat Pages files, dynamic,
  catch-all, and optional-catch-all patterns, across every supported extension;
- the actual Next production configuration is loaded with Next's `loadConfig`;
  every effective `pageExtensions` entry must be in the governed route scanner,
  and computed/imported hostile configuration proves static regex inspection
  cannot bypass this gate;
- one exact canonical path/method/permission map for all admin route modules;
- complete effective route runtime exports are limited to exact HTTP methods and
  a small explicit Next route-configuration allowlist; every default export,
  default expression/class/function, `export =`, named re-export, star/namespace
  re-export, and CommonJS mechanism fails;
- the complete effective runtime export set of `admin-auth.ts` is pinned by name,
  local declaration identity, and declaration kind; variables, objects, arrays,
  getters, factories, `.bind` results, re-exports, default facades, namespace
  merges, aliases, property assignments, every assignment operator, direct,
  computed, and aliased `Object.assign`, `Object.defineProperty`,
  `Object.defineProperties`, and `Reflect.set` cannot augment an allowed export
  through direct identity, transparent `Object(value)`, `Proxy`, nested or
  assignment destructuring, late-populated property/array containers,
  function-return bridges, indexed/concatenated/spread invocation vectors,
  stored bound mutators, or arbitrary call/apply mediation with the verifier,
  minter, signer, bearer verifier, or private verified-claims `WeakMap`;
- checker-resolved protected calls follow declaration identity through imports,
  variables, properties, arrays, call expressions, and referenced function,
  arrow, method, getter, and setter bodies; imported hidden/test/generated/vendor
  bridges are included and missing checker sources fail closed;
- exactly one production import and checker-resolved call each of
  `verifyAdminLoginCredential` and `createAdminLoginSession`, both in login;
- CommonJS and dynamic-import module specifiers are normalized through
  parentheses, assertions, `satisfies`, non-null forms, static templates,
  unambiguous const bindings, and constant concatenation; privileged process,
  module, global, and Reflect identity propagates through property access,
  reflection results, nested and assignment destructuring, late-populated
  containers, value-returning assignments, and function returns; unresolved or
  shadow-ambiguous expressions fail closed before checker resolution;
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

The mandatory live browser verifier accepts only the exact root origins
`https://staging.oriental.mereka.io` and `https://oriental.mereka.io`.
Alternate ports, paths, queries, fragments, userinfo, HTTP, and compatibility
hosts fail before browser launch. Its machine report emits the full normalized
origin, so a different listener cannot be concealed behind a hostname-only
label.

`docs/09-LAUNCH-CHECKLIST.md` truthfully marks both-scope materialization,
reconciliation, plaintext-alias absence, and live reduced-session proof as
post-merge pending. README and infrastructure guidance state that plaintext
must be absent from source, Infisical, Coolify, and the running container and
require a redacted live readback; they do not claim source review proved current
runtime state.

## Exact implementation verification

Completed against exact implementation commit
`0a2321f8e003fade6f6a0c28d47d73a3f7b213df`, tree
`861f29a18463f021e2f5c0a38255738e167c7d08`:

- `pnpm lint`: pass, 284 branch files in exact CI, no warnings
- strict application and Convex TypeScript: pass
- all 85 branch test files and 2,222 tests: pass
- mandatory admin release proof missing-configuration guard: pass; it exits
  nonzero before browser launch and emits no credential material
- `pnpm build`: pass, including all admin route handlers on Next.js 16.2.10
- source-only `git diff --check`: pass
- exact-head GitHub Actions workflow `CI`, event `pull_request`: success
  - run ID: `30413916916`
  - job/check-run ID: `90456091869`
  - check-suite ID: `82438933127`
  - checked-out head SHA: `0a2321f8e003fade6f6a0c28d47d73a3f7b213df`
  - checked-out tree: `861f29a18463f021e2f5c0a38255738e167c7d08`
  - run URL: `https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30413916916`
- synthetic eight-PR integration commit
  `5839ef6ccd1214b1d5a90e6627e8e097236a4dd4`, tree
  `e637916cea01aa1e0540aed47ebd6144fcb672c6`, based on
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`, composed from exact heads:
  - #78 `7657afae19433f276c89967ca9f6c2a94a509fd9`
  - #79 `aaeba89264b34a902d4d1595bf4d31907a91b2d4`
  - #80 `0a2321f8e003fade6f6a0c28d47d73a3f7b213df` (exact PR head)
  - #81 `297e0b1a47d7d8cf3a005c606146b7de8dd7ff96`
  - #82 `d81140cb87ff36a6e4196f230a9b4d7bf9a69806`
  - #83 `f9467a918708c9385163516e01f34f4d9bb58d3f`
  - #84 `413fdf0eaf758394c68d817aaf588558ead80a57`
  - #85 `42bd5f078754ae925d71f7f9cc1e5eb8778a5f20`
- the integration passed exact-head GitHub Actions `CI`, run
  `30414193707`, job/check `90456956044`, suite `82439679922`, event
  `pull_request`, with checked-out SHA
  `5839ef6ccd1214b1d5a90e6627e8e097236a4dd4` and tree
  `e637916cea01aa1e0540aed47ebd6144fcb672c6`
- the integration passed frozen pnpm 10.34.5 install, warning-free lint on
  294 files in exact CI, strict TypeScript, production audit with zero findings
  across 378 dependencies, all 89 test files and 2,337 tests with zero failed or
  pending, the Next.js 16.2.12 production build, and the mobile performance gate
  with LCP 1,400 ms, CLS 0, 444,008 transferred JavaScript bytes, 1,530,943
  decoded JavaScript bytes, 15 initial JavaScript requests, and zero serious or
  critical accessibility violations
- machine-readable Vitest JSON SHA-256:
  `2fa9f9512039a9cefebe959da1a39c271b059af6cd3faf51f826ba7972a2f0d5`
  (865,284 bytes; 216 suites; 2,337 passed; 0 failed)
- machine-readable production audit JSON SHA-256:
  `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c`
  (310 bytes; 378 dependencies; 0 info/low/moderate/high/critical findings)

Machine summary:

```json
{"audit":{"critical":0,"high":0,"info":0,"low":0,"moderate":0,"totalDependencies":378},"github":{"checkRunId":90456091869,"checkSuiteId":82438933127,"event":"pull_request","headSha":"0a2321f8e003fade6f6a0c28d47d73a3f7b213df","runId":30413916916},"integration":{"checkRunId":90456956044,"checkSuiteId":82439679922,"commit":"5839ef6ccd1214b1d5a90e6627e8e097236a4dd4","runId":30414193707,"tree":"e637916cea01aa1e0540aed47ebd6144fcb672c6"},"tests":{"failed":0,"files":89,"passed":2337,"pending":0}}
```

The round-fifteen reviewer receives the actual immutable support bytes alongside
this manifest and source patch, rather than digest strings alone:

- `github-evidence.json` (68,904 bytes; SHA-256
  `3a70e3353f0e9b0b8f62848dd7d6d94372ea8a51a4365035f9c0184af01f6b55`):
  raw PR #80, source run, job, check-run, check-suite, and commit API responses;
- `integration-github-evidence.json` (217,105 bytes; SHA-256
  `144464e9b4810e3e72244acef45b073a0425c7a9f96ffcd7aa80efb21794a54e`):
  raw closed evidence-only PR #86, integration run, job, check-run, check-suite,
  and commit API responses;
- `source-ci.log` (71,514 bytes; SHA-256
  `ff5f592e43a04865d822d72a0cc798a9d3b098b3d2c07c0c887bbde7f1c75a9c`)
  and `integration-ci.log` (76,974 bytes; SHA-256
  `c6a27429badab7f772c581ff1c543d0ec07790f74b43bee719b7dcaa2e07487a`):
  exact GitHub logs containing checkout SHA/tree attestations and all CI
  command output;
- `integration-merge-dag.txt` (47,648 bytes; SHA-256
  `9debe9f8d9c324c9246b4307189db75bb0c21f92aa8b641d159e75fb10dedab5`):
  whitespace-normalized raw commit/tree graph, first-parent merge identities,
  exact PR ancestors, and integration path ledger;
- `source-to-integration-overlap.diff` (33,276 bytes; SHA-256
  `b530dcb6ad0cb4c39ba20c0f9c6cae6d1595d1f7be0de8343fc203bbd45a5813`):
  the source-to-integration overlapping-path diff for conflict-resolution
  review;
- `integration-vitest.json` (865,284 bytes; SHA-256
  `2fa9f9512039a9cefebe959da1a39c271b059af6cd3faf51f826ba7972a2f0d5`);
- `integration-audit.json` (310 bytes; SHA-256
  `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c`);
- `round_13.md` (17,593 bytes; SHA-256
  `71d8e05782d059a3c18f8681f08f6a328c8f153b08ff15fb1aebeacead30d43c`);
- `round_14.md` (20,130 bytes; SHA-256
  `f4b9287c1a0cc39d59026093d37419952a8c954183822d5852f96ba76bdd67eb`),
  the complete whitespace-normalized terminal round-fourteen response;
- `final-head-github-evidence.json` (138,150 bytes; SHA-256
  `33baa9fe704f986a4955e5a7779293082b48ed790e9984cd711dca0384c5861a`):
  raw PR #80, live-head run, job, check-run, check-suite, and commit API
  responses for exact APR-only head
  `92060bad1edac337393e5cc5bae5ede4c095c043`, tree
  `784207833079bdb1411fef9c6e8b887de9d23c98`;
- `final-head-ci.log` (71,467 bytes; SHA-256
  `9d183e51e865826c1d4f8c4809b4bf694d8b482c9810b0be3648fd6884b7a6ca`):
  raw successful CI run `30414882217`, job/check `90459099573`, suite
  `82441530945`, with the exact checkout SHA and tree above;
- `source-to-live-head.diff` (70,089 bytes; SHA-256
  `bcebb7a47521fd1d182d17a018d8b0de821a59c0bdc578b7b045524119f2eb36`):
  the complete descendant diff from implementation to live PR head; its only
  paths are the APR manifest, immutable source patch, and APR workflow.

The reviewer must recompute hashes from those attached bytes, confirm the
source CI and synthetic integration identities, and use the final PR object
plus the attached source-to-live-head diff to prove that every descendant
change after `0a2321f8e003fade6f6a0c28d47d73a3f7b213df` is APR-only. The exact
APR-only live head passed 85 files and 2,222 tests, warning-free lint, strict
TypeScript, the Next.js 16.2.10 build, and mobile performance in CI.

The focused suite proves:

- password login creates a viewer-only thirty-minute signed session;
- review-token login creates a configured-role twelve-hour signed session;
- signed provenance survives cookie issuance and verification;
- password sessions authorize only aggregate metrics and same-origin logout;
- the password page, aggregate API, and fixed adapter call only
  `getAdminAggregateMetrics`; every count is bounded by the exact normalized
  query `take`, lead and session subset counts cannot exceed their parent
  populations, and raw dashboard and lead-table mocks throw if touched;
  missing, extra, malformed, nonfinite, fractional-count, out-of-range,
  `take + 1`, and impossible-subset Convex DTO fields are rejected;
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

APR rounds 4 and 5 correctly rejected broad dashboard materialization, mutable
or destructured handler blind spots, globally-valid but route-wrong
permissions, forgeable or copyable login identities, incomplete effective-export
and complete-runtime route governance, missing strict runtime DTO validation,
incomplete collision cross-products, unproven live documentation claims, and
missing exact-head/integration admission. Round 6 correctly rejected literal
filesystem-only route discovery, value-alias authority escape, incomplete
default/export-assignment rejection, and one premature live-runtime plaintext
claim. Round 7 correctly rejected unbounded aggregate counts, filesystem-root
rather than whole-program authority admission, allowed-export augmentation,
static Next-config inspection, a skippable password E2E lane, and mutable or
incomplete release evidence. Round 8 correctly rejected computed and aliased
Object/Reflect mutation primitives, transparent and destructured export
identities, parenthesized/asserted/unknown CommonJS module acquisition,
alternate-port canonical proof, and digest-only evidence admission. Round 9
correctly rejected CommonJS loader aliases, `module.require`, `createRequire`,
lexical shadowing, receiver/computed/indirect mutation aliases, incomplete
nested/destructured/private claims taint, incomplete live cookie/bearer/token/
Redis proof, and integration evidence without exact composition and raw CI
proof. Round 10 then reproduced three additional false-green classes:
namespace/default/import-equals and `process.getBuiltinModule` loader
acquisition; global, bound, call/apply, and container mutation receiver aliases;
and private-taint loss through logical/comma expressions plus later receiver
mutation. The repaired implementation closes those exact classes with hostile
regressions and safe differentials. Ambiguous or mutable loader bindings fail
closed; governed mutation targets include global receivers, bound primitives,
call/apply, `Reflect.apply`, definition primitives, and container aliases; typed
private-authority taint follows logical/comma results, nested and destructured
containers, getters, factories, bind results, arrays, Maps, Sets, and later
mutations. Round 11 reproduced the remaining semantically equivalent paths:
destructured/reflected `process.getBuiltinModule` and `module.require` loader
acquisition; aliases/destructuring/reflection of the global `Object`/`Reflect`
receivers; allowed exports inserted later into object properties, arrays, and
dynamic apply vectors; and private authority inserted through
`Array`/`Map`/`Set` prototype call/apply forms or dynamically built definition
vectors. The repaired implementation now propagates privileged loader and
global receiver identity through aliases and reflection, records mutable export
identity through later container insertion, resolves prototype-mediated
receiver mutation to the actual target, and links dynamic argument-vector
containers to inserted targets and protected values. Exact hostile fixtures for
every reproduced snippet fail while safe reflected reads, harmless global
mutation, safe dynamic vectors, and safe prototype mutation remain admitted.
Round 12 independently reproduced three still-equivalent semantic gaps:
destructuring `globalThis.process` directly and recovering
`module` from a container before reflected `require`; nested and assignment
destructuring of global `Object`, plus compound late insertion of an allowed
export; and private authority insertion through double-call/bound prototype
mutation or indexed and concatenated invocation vectors. The repaired checker
now uses fixed-point value-identity propagation rather than another syntax
allowlist. Privileged process/module/global/Object/Reflect identities traverse
property access, reflection, nested and assignment destructuring, arrays/objects,
late writes, all value-returning assignment operators, and function-return
bridges. Mutable export identity follows the same bridges. Receiver mutation
resolves direct, bound, stored-bound, call/apply, double-call, nested-call, and
Reflect.apply forms to the actual receiver. Indexed, push-built, concatenated,
spread, and mutation-built vectors connect real targets to inserted values.
Exact round-12 snippets plus broader hostile equivalents fail, while harmless
reflected lookalikes, global mutations, dynamic vectors, prototype calls, and
stored bound calls remain admitted. Exact-origin enforcement, exact-source
checkout attestation, Linux CI, a rebuilt eight-PR integration, and the
attached raw GitHub, git, Vitest, audit, and overlap evidence bind those
controls to the reviewed bytes. Round 13 independently confirmed the runtime
containment and every artifact hash, then reproduced four merge-blocking
false-green classes: privileged loaders returned by arrows, function expressions,
methods, getters, instances, and nested functions; private authority inserted
into a receiver returned by a call; protected dynamic invocation vectors
returned by a call; and allowed exports returned by class/object members before
mutation. It also found a safe reflected lookalike rejected solely because
`require` was a property name. The repair introduces one TypeScript
symbol/declaration-keyed return-summary graph shared by privileged loader
identity, global Object/Reflect mutation identity, private authority taint,
mutable-export identity, actual receiver resolution, and dynamic vector
expansion. Assignment-backed aliases and shadowed names use resolved symbols.
Exact and broader hostile variants now fail across declaration, arrow,
function-expression, object/class method, static getter, and instance forms;
safe reflected, safe shadowing, safe receiver, and safe vector twins remain
admitted. Exact-origin enforcement, exact-source checkout attestation, Linux
CI, a rebuilt eight-PR integration, and the attached raw GitHub, git, Vitest,
audit, and overlap evidence bind those controls to the reviewed bytes. Round 14
independently reproduced the remaining semantic gaps: class-property arrows,
destructured object methods, bind/call/apply mediation, privileged functions
stored through any-typed properties, and imported helpers whose return summaries
live in another checker-program source file. It also found safe local built-in
shadows falsely rejected. The repair makes the semantic assignment index
program-scoped and cached, resolves imported declarations in their owning source
files, extends return and receiver analysis through all reproduced
invocation/property shapes, and keys protected built-in, mutation, and module
identities by resolved symbols rather than names. Exact hostile and safe
differential fixtures cover each reproduced class, the focused suite is 11/11
green, the full branch is 85 files and 2,222 tests green, exact source CI is
green within its time budget, and the rebuilt eight-head integration is 89
files and 2,337 tests green. Round 15 must review this regenerated exact patch
and attached support bundle. The release verifier is designed to prove cookie
metadata and TTLs, password bearer rejection, review-token role and twelve-hour
TTL, Redis store identity, shared remaining counts, and 429 exhaustion after
merge; none of those live-runtime results is claimed by this pre-merge
evidence. Live secret and deployment checks remain mandatory post-merge gates
and are not waived.

## Mandatory post-merge gates

1. Derive the reaffirmed password HMAC without logging either input.
2. Write it to governed staging and production Infisical scopes.
3. Reconcile and read back the complete managed Coolify environment.
4. Deploy the exact merge SHA to canonical staging.
5. From a clean cookie jar, run the mandatory release-proof mode and require a
   machine report with nonzero expected tests and zero skipped, flaky,
   unexpected, or failed tests, proving:
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
