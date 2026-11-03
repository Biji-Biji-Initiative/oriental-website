## Decision

The **runtime least-privilege design materially contains the accepted risk of a potentially known password**. In the reviewed implementation, password authentication produces a signed `method=password`, `role=viewer` session with a fixed thirty-minute TTL; a module-private one-use `WeakMap` supplies the minting claims; and `verifyAdminPermission` independently restricts that credential to `dashboard.aggregate` and `session.logout`. The dedicated Convex query returns a fixed numeric object from at most 100 payload-safe lead rows and 100 payload-safe voice-session rows, while the Next adapter rejects extra, malformed, nonfinite, fractional-count, over-`take`, and impossible-subset values.     

That does **not** restore password secrecy: a holder can log in again, observe aggregate changes over time, and trigger repeated bounded computation. Those are the residual capabilities the owner explicitly accepted. I found no current implementation path by which the password session directly reaches customer records, email addresses, transcripts, voice detail, events, analytics queues, or mutations.

The tree is nevertheless **not releasable**. The authority/export admission tests still have reproducible false-green paths, the live release proof does not exercise all mandatory runtime properties, and the attached integration evidence cannot substantiate several requested integration claims.

## Release-blocking findings

### 1. CommonJS aliasing and lexical shadowing still bypass sole-login authority admission

**Changed path:** `tests/admin-auth-boundary.test.ts:351-372, 936-1013`

`constantStringBindings` builds one file-wide map from textual names and considers only `const` variable declarations. It does not model lexical parameter, import, `let`, or `var` shadowing. Separately, `protectedSymbolAuthority` recognizes CommonJS acquisition only when the call expression’s callee is the literal identifier `require`. 

A repository-local bridge can therefore acquire and invoke both protected exports without being attributed to them:

```ts
const req = require;
const auth = req("../../../../lib/server/admin-auth");

const verified = auth.verifyAdminLoginCredential(credential);
return auth.createAdminLoginSession(verified, Date.now());
```

The syntax pass sees neither a direct `require(...)` nor an ESM import. Because Node’s `require` result is `any`, the checker pass cannot resolve `auth.verifyAdminLoginCredential` or `auth.createAdminLoginSession` to declarations in `admin-auth.ts`.

A second independent false green uses direct `require`, but defeats module resolution through parameter shadowing:

```ts
const authPath = "./safe-module";

function bridge(authPath: string, credential: string) {
  const auth = require(authPath);
  const verified = auth.verifyAdminLoginCredential(credential);
  return auth.createAdminLoginSession(verified, Date.now());
}

bridge("../../../../lib/server/admin-auth", credential);
```

The global string map incorrectly resolves the function-local `authPath` to `"./safe-module"`. Similar ungoverned acquisition remains possible through `module.require` or a `createRequire`/property bridge.

This invalidates the claim that only the login route can verify the known password or mint a session. A future non-login handler could bypass the login route’s same-origin boundary, rate limit, and audit event while the governing suite remained green.

**Required repair:** resolve CommonJS loader identity with the TypeScript checker; track aliases of ambient `require`, `module.require`, and `createRequire`; evaluate specifiers against lexical declaration identity rather than a file-wide name map; and fail closed whenever loader identity, module provenance, or the resulting callable is `any` or unresolved.

### 2. Constant-computed and receiver-aliased Object/Reflect primitives remain false greens

**Changed path:** `tests/admin-auth-boundary.test.ts:406-477, 643-665`

`directAuthMutationPrimitive` accepts only a literal `Object` or `Reflect` receiver. For element access, it calls `constantStringExpression` without the available binding map. The alias pass tracks aliases of individual recognized methods, but not aliases of the `Object` or `Reflect` receivers themselves.  

These mutations are admitted:

```ts
const member = "assign";
Object[member](adminCookieHeader, { signer: sign });

const O = Object;
O.assign(adminCookieHeader, { bearerVerifier: verifyAdminBearerToken });
```

Both mutate an allowed exported function object while preserving the exact export name, local declaration identity, and declaration kind. An importing module can then recover the private signer and forge a valid v3 cookie with an arbitrary method, role, actor, or expiration. The same class includes receiver aliases for `Reflect`, `.call`/`.apply` forms, `Reflect.defineProperty`, and `Object.setPrototypeOf`.

The new hostile tests cover `Object["assign"]`, a direct method alias, and direct destructuring from `Object`, but not a constant-computed member or receiver alias. The round-eight mutation-primitive class is therefore not closed.

**Required repair:** resolve the builtin receiver and method by checker identity, propagate receiver aliases, use the lexical constant evaluator for computed members, cover indirect invocation forms, and treat every mutating Object/Reflect primitive capable of changing an exported object—including prototype mutation—as governed.

### 3. Private signer and claims taint is lost through local or destructured aliases

**Changed path:** `tests/admin-auth-boundary.test.ts:543-575, 610-640`

The private-authority taint loop visits only top-level, non-exported declarations whose binding name is a simple identifier. Array and object binding patterns are skipped, as are declarations local to an allowed exported function. The subsequent check examines only returned expressions, not the declarations that supplied their identifiers.  

For example, this preserves the complete allowed export inventory and is not reported:

```ts
export function clearAdminCookieHeader() {
  const [leakedSigner] = [sign];
  return leakedSigner as unknown as string;
}
```

Strict TypeScript accepts the cast, but the runtime return is the private signing function. The same pattern works with `verifiedAdminLoginClaims`, `verifyAdminBearerToken`, object destructuring, a local array/property container, or a local getter/factory/bound alias.

This defeats the required resistance to array, getter, factory, bind, signer, bearer-verifier, and private-claims augmentation even without adding a new export.

**Required repair:** perform taint propagation by declaration symbol through every binding pattern and every nested function body. Any value flow from `sign`, `verifyAdminBearerToken`, or `verifiedAdminLoginClaims` into an allowed export’s return value, properties, prototype, closure, getter, factory, bound callable, or reachable container must fail.

### 4. The live release proof can report success without proving the mandatory live properties

**Changed paths:**
`tests/e2e/admin-session-review.spec.ts:71-102`
`scripts/verify-admin-release-proof.ts:24-78`

The wrapper itself is correctly fail-closed on missing configuration and rejects a Playwright report with zero expected tests or any skipped, flaky, unexpected, or failed execution. It also emits the normalized canonical origin. 

However, the added password test proves only:

* password login returns 200;
* the aggregate page appears;
* the raw review route returns 403;
* one voice-detail route returns 403;
* one lead mutation returns 403. 

It does **not** live-assert:

* the exact thirty-minute cookie expiration;
* the actual `HttpOnly`, `SameSite=Lax`, and production `Secure` attributes;
* rejection of the reaffirmed password in `Authorization: Bearer`;
* real review-token login retaining the configured role and twelve-hour expiration;
* Redis-backed rate-limit stability when earlier `X-Forwarded-For` hops are spoofed;
* that the limiter did not silently fall back to process-local memory.

The test’s startup calls to local `verifyAdminLoginCredential` validate the checkout’s helper and local environment, not the deployed endpoint’s response cookie or bearer behavior. Yet the required post-merge proof explicitly lists all of the omitted properties. 

Consequently, the wrapper can emit `{"ok":true,"skipped":0,...}` after regressions such as removing `Secure`/`HttpOnly`, accepting the password as bearer, extending password-cookie lifetime, or trusting the wrong forwarding hop.

**Required repair:** inspect the real login response and browser cookie metadata without printing the credential or cookie; assert the cookie’s v3 method, role, and expiration within a tight tolerance; exercise bearer rejection; perform a real review-token login; and run a distributed rate-limit fixture that distinguishes Redis from in-memory fallback.

### 5. The integration support bundle does not prove composition, install, lint, TypeScript, or build

The attached bytes let me independently recompute the synthetic integration **commit** and **tree**:

* commit `94c4457a37820d5cfbac220ac4881c19cc296005`;
* tree `2236e4bf2c93545431c38484ab2326b48cb9dec3`.

I reconstructed the commit object from its tree, parent, identities, timestamps, and message, and rebuilt the tree from all 501 recursive entries. Both hashes match exactly. The ledger itself starts with that commit/tree and then becomes a recursive tree inventory. 

The raw Vitest and audit blobs also confirm:

* 89 result files;
* 2,337 passed tests;
* 0 failed, pending, or todo tests;
* 378 production dependencies;
* 0 findings at every audit severity.  

But no attached raw artifact proves:

* application of all eight stated PR heads;
* merge/cherry-pick order or conflict resolution;
* the frozen pnpm 10.34.5 install on the final integration tree;
* warning-free lint over 295 files on that tree;
* strict application and Convex TypeScript on that tree;
* the Next.js 16.2.12 production build on that tree;
* an immutable integration run/job/check-suite identity;
* an integration-time `git rev-parse HEAD` checkout attestation.

This is material because ten of PR #80’s 43 target blobs differ in the integrated tree, including the security-critical `app/admin/session-review/page.tsx`, `convex/leads.ts`, `lib/server/convex.ts`, and `tests/convex.test.ts`. Overlap is expected in an eight-PR composition, but it requires a reviewable source-to-integration diff or conflict-resolution ledger. Blob names and a passing test JSON cannot establish that all source states were preserved.

The manifest says the support bundle supplies raw integration and command evidence, but the enumerated git artifact contains only commit/tree/path information, while the Vitest and audit files contain only their respective machine results. 

The same distinction applies to source CI: I confirmed the GitHub run’s `head_sha`, event, job/check, suite, and successful steps, but the API envelope does not contain a job-log `git rev-parse HEAD` result proving the checkout itself rather than merely the commit to which the check is attached.

## Confirmed identities and closed controls

The following requested identities are confirmed:

* source run `30373725749`, event `pull_request`, `head_sha=691bb883eaf4cbd30a614779b6b353d5e252ed1e`, completed successfully; 
* job/check `90323907478`, same source SHA, completed successfully; frozen install, lint, TypeScript, tests, secret check, build, and performance steps all report success;  
* check suite `82322165004`, source SHA `691bb883…`, completed successfully; 
* live PR head `87f4bd8d21804b07eaa4bd97175edc3a198db87b`;
* review-head CI run `30374301675` also completed successfully; 
* the source-to-live diff contains only four `.apr/` paths and no non-APR descendant change. 

The following prior blockers are closed in the current implementation:

* exact Convex return shape and independent strict Next DTO validation;
* normalized `take` bounds and parent/subset relationships;
* early password-page branching before raw dashboard/lead-table calls;
* module-private one-use mint provenance;
* current-tree signer and bearer-verifier privacy;
* production-root expansion through checker-reachable repository-local sources;
* effective Next `loadConfig` use and effective `pageExtensions` admission;
* direct parenthesized, asserted, `satisfies`, non-null, static-template, and constant-concatenated module specifiers;
* transparent `Object(value)`, direct `Proxy`, literal-computed Object/Reflect calls, direct method aliases, and the tested destructured target aliases;
* canonical HTTPS root-origin enforcement for the tested nondefault ports, paths, queries, fragments, userinfo, and compatibility hosts;
* hard failure on missing release configuration and aggregate zero-skipped Playwright accounting.

Those closures do not cure the broader false-green variants described above.

## Recomputed attached-artifact hashes

```text
18,468 bytes  6666ee6de2fc437c5aeaece042a7ba80311079b38910d21c1929c5f5f8840ba9  evidence manifest
196,245 bytes af523263ce782b5bc1397dbe78fe2a5a1539952301d726f6b27a42cd3cde4a65  source-only patch
5,567 bytes   4372cab8447159533853106e6eb936346537da816f3ecdbef3c9a019a2ecf4b5  security contract
102,575 bytes c9ae1d8d14ef6c185b8b49483bfa8f7eebf4a1a3df934170fe9b849a947f7116  GitHub evidence bundle
60,070 bytes  11fe423d77e6129708ad702937ee628dc5acdf27193bd9bff8e2c6adb99e2bc5  source-to-live-head diff
1,687 bytes   b5f2cb30fbf5c9531f807fde890daf86c743595c70e5345c4962d441e6bbb603  source git ledger
45,148 bytes  2f6d5c7da56bf97a579fc097363daf1ca0436d668e27b5dbc8de3281c5ec70f8  integration git ledger
865,120 bytes 25c22205432683a6edb662a84fe23017188a46fd7f772c975aef3e4952de66ad  integration Vitest JSON
310 bytes     e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c  integration audit JSON
```

The patch, Vitest, and audit hashes and byte counts match the manifest’s declared values. The 43 source-patch paths also exactly match the source ledger’s changed-path inventory.  

No staging or production gate is waived. After repairing these blockers, re-admission requires a new exact-source GitHub run, a newly evidenced eight-source integration, managed HMAC materialization and parity readback, deployment of the exact merge SHA to canonical staging, a corrected live password proof with zero skips, and guarded promotion and repetition on the identical production SHA. 

VERDICT: DO NOT MERGE
