# Oriental interactive admin password exact-tree evidence

## Immutable implementation identity

The source implementation under review is the exact commit
`691bb883eaf4cbd30a614779b6b353d5e252ed1e` on base
`e3bb6c333cbf4bf8e52456a1b5144f556f50636a`.

- Implementation tree: `f2314903806becc2c5485d4a2b9bba742c4fb88d`
- Authoritative source-only patch:
  `.apr/evidence/oriental-admin-password-security.patch`
- Patch SHA-256:
  `af523263ce782b5bc1397dbe78fe2a5a1539952301d726f6b27a42cd3cde4a65`
- The 4,384-line patch contains all forty-three changed non-APR source, test,
  release, UI, environment-example, and documentation files.

The obsolete mail patch that conflicted with the evidence manifest was removed.
The authoritative patch excludes `.apr/`, so saved review rounds cannot change
its bytes or implementation tree. APR must compare the live PR head with the
clean review worktree and verify that every implementation byte is represented
by the patch. GitHub CI passed on the final exact PR head.

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
It proves:

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
  through direct identity, transparent `Object(value)`, `Proxy`, destructuring,
  property/array containers, or assignment aliases with the verifier, minter,
  signer, bearer verifier, or private verified-claims `WeakMap`;
- checker-resolved protected calls follow declaration identity through imports,
  variables, properties, arrays, call expressions, and referenced function,
  arrow, method, getter, and setter bodies; imported hidden/test/generated/vendor
  bridges are included and missing checker sources fail closed;
- exactly one production import and checker-resolved call each of
  `verifyAdminLoginCredential` and `createAdminLoginSession`, both in login;
- CommonJS and dynamic-import module specifiers are normalized through
  parentheses, assertions, `satisfies`, non-null forms, static templates,
  unambiguous const bindings, and constant concatenation; unresolved or
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
`691bb883eaf4cbd30a614779b6b353d5e252ed1e`, tree
`f2314903806becc2c5485d4a2b9bba742c4fb88d`:

- `pnpm lint`: pass, 285 branch files, no warnings
- strict application and Convex TypeScript: pass
- all 85 branch test files and 2,222 tests: pass
- mandatory admin release proof missing-configuration guard: pass; it exits
  nonzero before browser launch and emits no credential material
- `pnpm build`: pass, including all admin route handlers
- source-only `git diff --check`: pass
- exact-head GitHub Actions workflow `CI`, event `pull_request`: success
  - run ID: `30373725749`
  - job/check-run ID: `90323907478`
  - check-suite ID: `82322165004`
  - checked-out head SHA: `691bb883eaf4cbd30a614779b6b353d5e252ed1e`
  - run URL: `https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30373725749`
- synthetic eight-PR integration commit
  `94c4457a37820d5cfbac220ac4881c19cc296005`, tree
  `2236e4bf2c93545431c38484ab2326b48cb9dec3`, based on
  `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`, composed from exact heads:
  - #78 `7657afae19433f276c89967ca9f6c2a94a509fd9`
  - #79 `e89f7ab802eaf120af1cf40d241af9a7af1ae112`
  - #80 `691bb883eaf4cbd30a614779b6b353d5e252ed1e` (source state; prior
    descendants between the earlier source commit and this commit are APR-only)
  - #81 `297e0b1a47d7d8cf3a005c606146b7de8dd7ff96`
  - #82 `73b01486f17008eb02a78e9a2dafe647c8306eff`
  - #83 `6803403342e25384c4d4b18bf36af575c39a559f`
  - #84 `413fdf0eaf758394c68d817aaf588558ead80a57`
  - #85 `37dd569ad08c160a492e17d7512dcaad418091f6`
- the integration passed frozen pnpm 10.34.5 install, warning-free lint on
  295 files, strict TypeScript, production audit with zero findings across 378
  dependencies, all 89 test files and 2,337 tests with zero failed or pending,
  and the Next.js 16.2.12 production build
- machine-readable Vitest JSON SHA-256:
  `25c22205432683a6edb662a84fe23017188a46fd7f772c975aef3e4952de66ad`
  (865,120 bytes; 89 files; 2,337 passed; 0 failed; 0 pending)
- machine-readable production audit JSON SHA-256:
  `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c`
  (310 bytes; 378 dependencies; 0 info/low/moderate/high/critical findings)

Machine summary:

```json
{"audit":{"critical":0,"high":0,"info":0,"low":0,"moderate":0,"totalDependencies":378},"github":{"checkRunId":90323907478,"checkSuiteId":82322165004,"event":"pull_request","headSha":"691bb883eaf4cbd30a614779b6b353d5e252ed1e","runId":30373725749},"integration":{"commit":"94c4457a37820d5cfbac220ac4881c19cc296005","tree":"2236e4bf2c93545431c38484ab2326b48cb9dec3"},"tests":{"failed":0,"files":89,"passed":2337,"pending":0}}
```

The round-nine reviewer receives the actual immutable support bytes alongside
this manifest and source patch, rather than digest strings alone:

- `github-pr80-review-head.json`: live PR object captured after the final
  review-only head is pushed;
- `github-run-30373725749.json`, `github-jobs-30373725749.json`,
  `github-check-runs-691bb88.json`, and
  `github-check-suite-82322165004.json`: raw GitHub API responses;
- `source-git-ledger.txt` and `integration-git-ledger.txt`: raw commit, tree,
  path, and non-APR diff-check ledgers;
- `integration-vitest.json` and `integration-audit.json`: the exact blobs whose
  SHA-256 values and byte counts appear above.

The reviewer must recompute hashes from those attached bytes, confirm the
source CI and synthetic integration identities, and use the final PR object
plus an attached source-to-live-head diff to prove that every descendant change
after `691bb883eaf4cbd30a614779b6b353d5e252ed1e` is APR-only.

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

The exact-head GitHub verification and the final synthetic eight-PR integration
are complete. Final merge-head and deployed-runtime gates remain.

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
alternate-port canonical proof, and digest-only evidence admission. The
repaired implementation closes each path with hostile regression coverage,
exact-origin enforcement, Linux CI, a rebuilt eight-PR integration, and the
actual immutable GitHub, git, Vitest, and audit support bytes. Round 9 must
review this regenerated exact patch and attached support bundle. Live secret
and deployment checks remain post-merge gates and are not waived.

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
