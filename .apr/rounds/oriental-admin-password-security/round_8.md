# Review result

**Do not merge this candidate.**

The runtime design **materially contains the risk of the historically exposed password**, but the release-assurance layer does not close the round-seven contract. The source limits a password-authenticated principal to a signed `method=password`, role `viewer`, thirty-minute session with only `dashboard.aggregate` and same-origin `session.logout`; raw customer data and operational authority require managed-token step-up. That is a meaningful reduction from “potentially known password grants admin access” to “potentially known password reveals bounded aggregate trends and can trigger bounded aggregate computation.” The owner’s contract explicitly accepts that residual exposure. 

I found three concrete false-green paths in the new security/release gates, and the live-head and machine-artifact evidence could not be independently established.

## Release-blocking findings

### 1. The allowed-export hardening accepts a real private-signer augmentation

**Path:** `tests/admin-auth-boundary.test.ts`, particularly `authRuntimeExportViolations()`.

The alias analysis tracks only identifier variable declarations and plain assignments. The mutation analysis recognizes only dot-form calls whose callee is a `PropertyAccessExpression`, specifically direct `Object.assign`, `Object.defineProperty`, `Object.defineProperties`, and `Reflect.set`.  

This runtime-equivalent mutation is not detected:

```ts
Object["assign"](adminCookieHeader, {
  signer: sign,
  bearerVerifier: verifyAdminBearerToken,
  claims: verifiedAdminLoginClaims,
  signerArray: [sign],
  signerGetter: {
    get value() {
      return sign;
    },
  },
  signerFactory: () => sign,
  boundSigner: sign.bind(null),
});
```

I injected that suffix into the exact `authRuntimeExportViolations()` implementation. It returned an empty violation array. The callee is an `ElementAccessExpression`, not the one accepted `PropertyAccessExpression` shape.

The same blind spot is reachable through, among others:

```ts
Object.assign(Object(adminCookieHeader), { signer: sign });

const { value: cookieAlias } = { value: adminCookieHeader };
Object.assign(cookieAlias, { signer: sign });

Reflect["set"](adminCookieHeader, "signer", sign);
```

`Object(adminCookieHeader)` returns the same function object, and destructured bindings are skipped because the alias collector requires `ts.isIdentifier(node.name)`. Direct dot-form examples and simple aliases are tested, but none of these identity-preserving variants are. 

This is not merely an information leak. `adminCookieHeader` is an exported function object. A downstream importer would receive the same mutated identity. Access to the private `sign` closure would permit construction of accepted `v3` review/admin session cookies under the real session key; the session payload and signature are formed inside `createAdminLoginSession`, while the private signer uses that same configured key and domain.  

Therefore the required namespace/alias/property/Object/Reflect/array/getter/factory/bind/signer/bearer-verifier/private-claims augmentation resistance is **not proven**. The evidence statement that all such forms are closed is false. 

**Required repair:** make the rule identity-based rather than syntax-spelling-based. At minimum, resolve mutation primitives by checker symbol, unwrap computed properties and aliases, propagate exported-object identity through destructuring, properties, arrays, proxies and transparent coercions, and add the hostile examples above. A runtime defense such as freezing every exported function object would be useful defense in depth but would not replace the source gate.

---

### 2. Sole-login authority can escape through a parenthesized or asserted `require`

**Path:** `tests/admin-auth-boundary.test.ts`, `protectedSymbolAuthority()` and `resolvedProtectedSymbolCalls()`.

The syntactic authority scanner recognizes CommonJS and dynamic acquisition only when the module argument is directly a `StringLiteral`. It does not unwrap parentheses, assertions or other constant module-specifier expressions. 

This bridge is runtime-equivalent to the tested direct `require` but passes the exact scanner:

```ts
const auth = require(("../../../../lib/server/admin-auth"));

const verified = auth.verifyAdminLoginCredential(credential);
auth.createAdminLoginSession(verified, Date.now());
```

A TypeScript form has the same outcome after type erasure:

```ts
const auth = require("../../../../lib/server/admin-auth" as string);
```

My exact helper-level probe produced:

```text
direct string-literal require: forbidden access detected
parenthesized require:         no imports, calls, or forbidden access
type-asserted require:         no imports, calls, or forbidden access
```

The checker-based second plane does not recover the calls because the result of untyped `require` is not a symbol-resolved import from `admin-auth.ts`; property calls are therefore rooted in `any`, not in the protected declarations.

The new program construction does correctly expand from production roots to repository-local reachable sources, including hidden, test-named, generated and vendor bridges, and it follows ordinary referenced function bodies.   But expanding the file inventory does not help when the protected module acquisition inside an included file is invisible.

A non-login route or bridge could therefore invoke the credential verifier and one-time mint itself, bypassing the login route’s same-origin entry contract, rate limiter and login telemetry. That directly violates the requirement that login have the only verifier and mint authority.

**Required repair:** normalize and constant-evaluate module specifiers before resolution, including parentheses, `as`/type assertions, `satisfies`, non-null expressions, no-substitution templates and constant concatenations. CommonJS and dynamic module acquisition should fail closed when the expression cannot be conclusively shown not to resolve to the auth module. Add checker-resistant `require` fixtures, not only ordinary ES-import bridges.

---

### 3. The mandatory live release proof accepts a noncanonical listener and conceals it in its report

**Path:** `scripts/verify-admin-release-proof.ts`.

The script checks only:

* HTTPS;
* absent URL username/password;
* `baseUrl.hostname` membership in the two-host allowlist.

It neither rejects a nondefault port nor compares the full origin. Its machine report also emits only `baseUrl.hostname`, discarding the port.  

Consequently, this passes the canonical-host gate:

```text
PLAYWRIGHT_BASE_URL=https://staging.oriental.mereka.io:8443
```

The success report still says:

```json
{"target":"staging.oriental.mereka.io"}
```

That can attest a different listener on the same hostname rather than the canonical staging service. The same defect applies to production. It defeats the requested exact canonical staging and guarded production proof even if every browser assertion succeeds.

The release-governance test merely searches the script text for the two hostnames and the skipped/unexpected/flaky checks; it has no hostile alternate-port test. 

**Required repair:** compare `baseUrl.origin` with exact allowed origins, reject nonempty/nondefault ports, require the expected root URL shape, and emit the full normalized origin in the machine report. Add staging and production alternate-port negative tests.

## Round-seven recheck

| Requirement                                                                                         |                                 Result | Analysis                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------- | -------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every aggregate count bounded by normalized query `take`                                            |                               **PASS** | Convex normalizes to `1..100` and applies `.take(take)` independently to leads and voice sessions.                                                                                                                                                     |
| Obvious subset counts cannot exceed parent populations                                              |                               **PASS** | Next validates every count as finite, integral, nonnegative and at most `take`; lead subsets are constrained by `recentLeads` and voice subsets by `reviewedSessions`.  Tests exercise every count at `take + 1` and impossible lead/session subsets.  |
| Dedicated fixed aggregate DTO; no raw records cross to password principal                           |           **PASS in the exact source** | The password page returns before calling the raw review dashboard or lead table, and the metrics route calls only the aggregate adapter.                                                                                                               |
| Expand authority from production roots through repository-local program sources and function bodies |                               **FAIL** | Program expansion is present, but parenthesized/asserted CommonJS acquisition escapes both authority planes.                                                                                                                                           |
| Allowed auth exports resist all required augmentation forms                                         |                               **FAIL** | Computed Object/Reflect calls, transparent object coercion and destructured identity aliases expose the private signer while returning no violation.                                                                                                   |
| Supported route extensions come from effective Next `loadConfig`                                    |                               **PASS** | The test calls Next’s production `loadConfig`, validates the effective `pageExtensions`, and includes a computed/imported hostile configuration.                                                                                                       |
| Password release E2E hard-fails instead of skipping                                                 |           **PASS for test accounting** | Release mode requires all credentials, forces `E2E_ADMIN_RELEASE_PROOF=1`, requires process success, nonzero expected tests and exactly zero skipped, unexpected and flaky results.  The remaining skips are conditional on release mode being off.    |
| Password release E2E proves the canonical deployment                                                |                               **FAIL** | Alternate ports pass and are omitted from the machine report.                                                                                                                                                                                          |
| Managed HMAC inventory and readback                                                                 | **PASS in source; live proof pending** | `ADMIN_REVIEW_PASSWORD_HMAC` is governed by the managed environment and parity test, including mismatched readback rejection.                                                                                                                          |
| Immutable run/integration/test/audit evidence                                                       |                     **FAIL admission** | The manifest records the requested identities, but the underlying immutable responses, git objects and hashed JSON blobs were not included and could not be independently retrieved.                                                                   |
| Live PR head equals implementation or APR-only descendant                                           |                    **NOT ESTABLISHED** | The available evidence does not prove the current PR head at review time. Under the requested fail-closed rule, this blocks merge.                                                                                                                     |

## Known-password containment decision

Subject to the intended invariants, the design is a meaningful containment:

* Password login produces a one-time WeakMap-backed verified identity, and visible-field mutation, copying, proxies and replay do not alter its canonical password/viewer claims.
* The signed cookie includes the credential method, role, actor and expiry.
* Password sessions are independently forced to the `password` principal and `viewer` role.
* The password principal’s permission set is exactly aggregate read and logout. 
* The page’s password branch returns only the fixed aggregate dashboard before any raw dashboard/table reads. 
* Raw review, lead, voice, privacy, evaluation and operations permissions are unavailable to that principal.
* The password and its stored HMAC are not bearer credentials or session-signing keys.

The residual risk remains material but bounded: anyone knowing the password can reauthenticate after expiration, observe aggregate changes over time, and repeatedly cause bounded Convex computation subject to the login rate limiter. Thirty-minute expiry limits individual cookie lifetime; it does not restore password secrecy or revoke the ability to log in again. The evidence manifest accurately acknowledges that residual exposure. 

I found no direct raw-record or mutation authority granted to the password principal in the exact 42-file patch. The rejection is because the controls intended to guarantee that fact across the effective tree and final release can currently return false green.

## Identity and evidence ledger

I independently recomputed the attached source-only patch SHA-256 as:

```text
c02fd1ef0ebaa4c23b7546341f9ccabe24d108495640b9ba6862d7796ce5fafa
```

It has exactly **4,209 lines and 42 changed paths**, matching the manifest. The manifest identifies implementation commit `4dd1eb1bcfcc3240cefdf577c618e2c9fdbf1bd9`, base `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`, and implementation tree `1c8a1734addd1987753718f44185c951d19e1b00`. 

The manifest records, but the supplied evidence does not independently prove:

* GitHub Actions run `30365410287`
* job/check run `90295268846`
* check suite `82296707933`
* event `pull_request`
* checked-out SHA `4dd1eb1bcfcc3240cefdf577c618e2c9fdbf1bd9`
* integration commit `ed34b5e8c1639af5b97bb834de417b5d03c1acc6`
* integration tree `861800a67e9af8b49a76480ba2cebb812680346a`
* frozen pnpm `10.34.5` installation
* warning-free lint over 294 files
* strict TypeScript
* zero production-audit findings across 378 dependencies
* 89 test files and 2,336 passing tests, with zero failed or pending
* Next.js `16.2.12` production build. 

The eight manifest-listed heads are:

```text
#78  7657afae19433f276c89967ca9f6c2a94a509fd9
#79  e89f7ab802eaf120af1cf40d241af9a7af1ae112
#80  4dd1eb1bcfcc3240cefdf577c618e2c9fdbf1bd9
#81  297e0b1a47d7d8cf3a005c606146b7de8dd7ff96
#82  73b01486f17008eb02a78e9a2dafe647c8306eff
#83  6803403342e25384c4d4b18bf36af575c39a559f
#84  413fdf0eaf758394c68d817aaf588558ead80a57
#85  37dd569ad08c160a492e17d7512dcaad418091f6
```

Those values are internally consistent with the manifest’s machine summary, but no git object database or independently generated composition transcript was supplied. 

### SHA-256 verification status

The manifest gives:

```text
Vitest JSON:
11b1170251095f15d9521b4c93d15a3d50eae6dd85c2bfc94cd24f7de3cb1f25
864,872 bytes; 89 files; 2,336 passed; 0 failed; 0 pending

Production audit JSON:
e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c
310 bytes; 378 dependencies; zero findings
```

The strings are valid lowercase SHA-256 representations and their stated counts agree with the machine summary. They are **not cryptographically verified**, because neither underlying JSON blob was attached or otherwise retrievable. A digest in a mutable Markdown manifest without its referenced bytes is not sufficient to recompute the digest. 

### Live GitHub and PR-head status

I could not independently retrieve the current PR object, workflow run, job/check run or check suite with the available access. GitHub documents that the relevant PR, Actions and Checks endpoints require repository read permissions except when the requested resources are public. ([GitHub Docs][1])

Accordingly:

* I cannot confirm that the live PR head still equals `4dd1eb1bcfcc3240cefdf577c618e2c9fdbf1bd9`.
* I cannot determine whether a descendant contains only APR evidence changes or includes non-APR source changes.
* I cannot independently bind run `30365410287`, job `90295268846`, suite `82296707933`, event `pull_request` and checked-out SHA to an immutable GitHub response.
* Under the user’s explicit instruction to reject any non-APR descendant and fail closed on exact-head identity, this is an admission failure rather than a waivable uncertainty.

## Non-waived release requirements

Even after repairing the three blockers and regenerating exact-head evidence, release still requires:

1. Managed password-HMAC materialization into both governed scopes.
2. Exact post-write Coolify/runtime readback.
3. Deployment of the exact merge SHA to canonical staging.
4. A clean-cookie live password report with nonzero expected tests and zero skipped, flaky, unexpected or failed tests.
5. Live proof of password/viewer/thirty-minute provenance, aggregate-only access, raw-route and mutation `403`s, password bearer rejection, and strong review-token step-up.
6. Promotion of the identical SHA to production.
7. Guarded production authentication, environment, health and exact-running-SHA verification with rollback retained. 

VERDICT: DO NOT MERGE

[1]: https://docs.github.com/en/rest/pulls/pulls?utm_source=chatgpt.com "REST API endpoints for pull requests - GitHub Docs"
