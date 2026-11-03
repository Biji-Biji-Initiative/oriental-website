# Decision

**Do not merge this tree.** The reduced runtime capability is a material containment of the potentially known password, and the source, integration, and final-head evidence is internally consistent. However, the mandatory authority-admission checker still has reproducible semantic false greens in exactly the area round twelve claimed to close: function-return bridges do not consistently propagate privileged identity, mutable-export identity, actual receiver identity, or dynamic invocation-vector contents.

The reviewed identity is commit `1142708546e31e1f1ed225448ae955e0059e6a11`, tree `0bb7c3de96316c7bd1832c3efc303d8d21a99614`; the 284,304-byte source-only patch recomputes to `1b221e993c5b67d8cb46fd5611d58b63c2faf02a730ee0c9afb18778639b1b3c`, matching the manifest. 

## Password-risk decision

**The runtime design does materially contain the known-password risk, but it does not make the password secret again.**

A verified password login is converted through module-private, one-time `WeakMap` claims into a signed `method=password`, role `viewer`, thirty-minute cookie. The claims are deleted before minting, caller-visible fields are ignored, and password cookies with a non-viewer role are rejected.  Password-session authorization is independently hard-limited to `dashboard.aggregate` and `session.logout`; every other permission returns `forbidden`. 

The password dashboard exits into the dedicated aggregate path before the raw dashboard and lead-table reads. The Convex query reads only `payloadSafe=true` lead and voice-session rows and applies the normalized `take ≤ 100`.   Next then applies a strict object schema: every count is a finite, nonnegative integer bounded by `take`, percentages are bounded to `[0,100]`, and lead/session subsets cannot exceed their corresponding parent populations. 

The password is absent from bearer candidates, and the runtime fails all authentication planes closed when its HMAC proves equality with the review, operations, or privacy bearer token.  Successful-login telemetry is restricted to actor, credential method, role, and expiry, not the submitted credential, password HMAC, token, cookie, or request body. 

The residual exposure is therefore repeatable access to the fixed aggregate values and bounded aggregate computation. Thirty-minute expiry does not prevent a holder of the historical password from authenticating again. That residual risk is materially smaller than raw dashboard access and is within the owner’s expressly stated acceptance.

## Release-blocking finding

### P0 — Function-return identity remains syntax-dependent rather than semantic

I executed a harness containing the exact checker helper bodies extracted from the reviewed patch. The following valid hostile variants produced empty violation arrays.

#### 1. Arrow and method bridges still recover privileged loaders

```ts
const moduleBridge = () => module;
const M = moduleBridge();

const req = Reflect.get(M, "require") as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

Observed result:

```ts
protectedSymbolAuthority(path, source).forbiddenAccesses
// []
```

Equivalent function-expression, object-method, class static method, class getter, class instance method, and nested-arrow variants also returned `[]`.

The reason is explicit in the checker: the semantic privileged-identity fixed point records returned identities only for `ts.isFunctionDeclaration(...)`. It does not create corresponding summaries for arrows, function expressions, methods, getters, setters, or class members.  The committed round-twelve regression covers a declaration-form `function moduleBridge()`, not those semantically equivalent function-like forms. 

This permits a repository-local production source to recover `module.require` and load `admin-auth.ts` without the mandatory authority test reporting the privileged loader path.

#### 2. An actual mutation receiver can be hidden behind a function call

Inside an otherwise allowed exported auth function:

```ts
const result = { values: [] as unknown[] };

function target() {
  return result.values;
}

Array.prototype.push.call(target(), sign);
return result as unknown as string;
```

Observed result:

```ts
authRuntimeExportViolations(modifiedAuthSource)
// []
```

This inserts the private signer into `result.values`, then returns `result` through an allowed export.

The checker recognizes the prototype mutation and the tainted `sign` argument, but it reduces the mutation target through:

```ts
expressionRootName(receiverMutation.target)
```

For `target()`, that root is `null`; no container is tainted.  This false green occurs even when `target` is a function declaration, and it also occurs with arrow and class-method receiver bridges. Thus the failure is not merely the missing arrow summary—it also disproves the claim that prototype call/apply mutation is resolved to the **actual** receiver through function-return bridges.

#### 3. A protected dynamic vector can be hidden behind a function return

```ts
const result: Record<string, unknown> = {};

function args() {
  return [result, "signer", sign];
}

Reflect.apply(Reflect.set, null, args());
return result as unknown as string;
```

Observed result:

```ts
authRuntimeExportViolations(modifiedAuthSource)
// []
```

Arrow and function-expression `args` variants also returned `[]`.

`invocationVectorValues` expands array literals, identifier-backed prior writes, and `.concat(...)`, but for any other call expression it immediately returns an empty vector.  Consequently, `args()` is not connected to either the real target `result` or the inserted protected value `sign`.

This directly refutes the manifest’s broader claim that function-return bridges and mutation-built vectors connect inserted authority to the real target.

#### 4. Allowed exports can still be augmented through class-method returns

```ts
class CookieBridge {
  static getCookie() {
    return adminCookieHeader;
  }
}

Object.assign(CookieBridge.getCookie(), { signer: sign });
```

Observed result:

```ts
authRuntimeExportViolations(modifiedAuthSource)
// []
```

This mutates the actual exported `adminCookieHeader` function object and attaches the private signer. Static getter and instance-method forms are also accepted.

The mutable-export fixed point includes declaration-form return bridges but does not summarize class or object methods. The eventual mutation target contains only `CookieBridge.getCookie()`, not a syntactic occurrence of `adminCookieHeader`, so the checker fails to connect it to the allowed export. The existing hostile regression again covers only `function cookieBridge()`. 

### Safe differential also remains incomplete

A safe reflected lookalike such as:

```ts
class ModuleBridge {
  static get() {
    return { require: () => ({ safe: true }) };
  }
}

const M = ModuleBridge.get();
void Reflect.get(M, "require")();
```

is rejected as a `CommonJS loader reference`. The final visitor treats essentially every identifier named `require` as privileged, irrespective of resolved identity. 

That is a false positive rather than an authority escape, but it also contradicts the requested safe-lookalike differential.

The present runtime source does **not** contain these injected snippets. The blocker is that the mandatory exact-tree admission test would allow the hostile additions while remaining green. Prior rounds and the current review contract make that false-green security gate merge-critical.

## Other controls rechecked

| Control                                 |                    Result | Assessment                                                                                                                                                                  |
| --------------------------------------- | ------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password capability reduction           |                  **Pass** | Materially contains the known-password risk to the fixed aggregate DTO and logout.                                                                                          |
| Aggregate query and DTO bounds          |                  **Pass** | Payload-safe indexed reads, normalized `take`, strict exact shape, finite integer counts, bounded percentages, and parent/subset constraints are present.                   |
| One-time private mint claims            |                  **Pass** | Exact-object `WeakMap` provenance is consumed before minting and is resistant to spread, mutation, proxy, structural forgery, and replay.                                   |
| Password/bearer collision cross-product |                  **Pass** | Review, operations, and privacy bearer candidates are all checked at runtime and production preflight.                                                                      |
| Effective Next configuration            | **Pass for current tree** | The checker uses Next’s production `loadConfig`, validates effective `pageExtensions`, and includes a computed/imported hostile-config regression.                          |
| Current route and export inventory      | **Pass for current tree** | The current exact routes, methods, permissions, supported extensions, and effective exports are pinned.                                                                     |
| Whole-program source closure            |               **Partial** | Repository-local reachable sources and checker-resolved function bodies are included, but semantic loader/export/receiver/vector identity is incomplete as described above. |
| Canonical release origin code           |                  **Pass** | Only the two canonical HTTPS origins with root path, no credentials, query, or fragment are admitted; alternate nondefault ports are rejected.                              |
| Release-proof hard failure              |        **Pass in source** | Nonzero expected count and exactly zero skipped, unexpected, and flaky tests are mandatory, and a nonzero process status fails.                                             |
| Live release proof                      |               **Pending** | It has not been performed and must not be represented as complete.                                                                                                          |

## Artifact recomputation

I reconstructed the raw embedded artifact bytes and recomputed SHA-256 independently:

| Artifact                                 |   Bytes | Recomputed SHA-256                                                 |
| ---------------------------------------- | ------: | ------------------------------------------------------------------ |
| `oriental-admin-password-security.patch` | 284,304 | `1b221e993c5b67d8cb46fd5611d58b63c2faf02a730ee0c9afb18778639b1b3c` |
| `github-evidence.json`                   | 119,631 | `4e592594e50ad945ec7e0f68f25427f9bfad23287598d4d69cc31bd444b5e626` |
| `source-ci.log`                          |  70,900 | `aa26c7ac0fb61cd67490eb0b82d4205981ae8a0a45b43e554adc0fff928e30fd` |
| `integration-ci.log`                     |  76,861 | `bd836fb98915f8cb18129f5f1cf37645f36bf5629866ef92319468270cf0abff` |
| `integration-merge-dag.txt`              |  79,836 | `185d98df892805c9ad867e1925c9a2c90e91b24fa15ec844f81abd34fe5c2859` |
| `source-to-integration-overlap.diff`     |  33,778 | `2103754ca0ec9d2eff0ca69b9aca0cbe8973119b6ddb5ccd22518bea349054fc` |
| `integration-vitest.json`                | 864,666 | `8f72991d7de70283226f199eda414ece2212fc17a8bcd934b7fee6c2f64ecece` |
| `integration-audit.json`                 |     310 | `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c` |
| `final-head-github-evidence.json`        | 184,049 | `1c0c5717e9749b456f7738f65dfa5663099456449d3912e80249019589d80d61` |
| `final-head-ci.log`                      |  71,053 | `7e302e58931f86d8232836f6c38229a2df95a4e9e0cfd7eaabc66d9e8eba19db` |
| `source-to-live-head.diff`               | 113,693 | `f50d6545d92c178707f0c907bffbfed845d2e9f36e0168165a56e9a97cedf795` |

All manifest-declared hashes and byte counts match the attached bytes. The three final-head hashes above are independent calculations over the final capture.

### Source CI

The raw run, job, check, suite, and checkout attestation consistently identify:

* run `30404758773`
* job/check `90427616285`
* suite `82414100760`
* event `pull_request`
* commit `1142708546e31e1f1ed225448ae955e0059e6a11`
* tree `0bb7c3de96316c7bd1832c3efc303d8d21a99614`

The source run passed lint on 284 files without lint warnings, strict application and Convex TypeScript, 85 files and 2,222 tests, the missing-configuration release-proof guard, Next.js 16.2.10 build, performance, and source diff checking. 

### Eight-head integration

The integration evidence consistently identifies run `30405004341`, job/check `90428369693`, suite `82414755723`, event `pull_request`, commit `6c7c831004a8ee9c9d80e11442e45f0699537c22`, and tree `6031abd05700d532352bf18cb698b860a497f875`. 

The DAG contains all eight exact heads as ancestors in the recorded first-parent composition:

* #78 `7657afae19433f276c89967ca9f6c2a94a509fd9`
* #79 `aaeba89264b34a902d4d1595bf4d31907a91b2d4`
* #80 `1142708546e31e1f1ed225448ae955e0059e6a11`
* #81 `297e0b1a47d7d8cf3a005c606146b7de8dd7ff96`
* #82 `d81140cb87ff36a6e4196f230a9b4d7bf9a69806`
* #83 `f9467a918708c9385163516e01f34f4d9bb58d3f`
* #84 `413fdf0eaf758394c68d817aaf588558ead80a57`
* #85 `42bd5f078754ae925d71f7f9cc1e5eb8778a5f20`

The integration used frozen pnpm `10.34.5`; lint checked the raw count of 294 files; strict TypeScript passed; the machine audit reports 378 dependencies and zero findings at every severity; Vitest reports 216 suites, 89 files, and 2,337 passed tests with zero failed, pending, or todo; Next.js 16.2.12 built; and the mobile gate reported LCP 892 ms, CLS 0, 444,011 transferred JavaScript bytes, 1,530,943 decoded bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations. 

The source-to-integration overlap contains eleven paths, but it does not modify `tests/admin-auth-boundary.test.ts` or `lib/server/admin-auth.ts`. The defective semantic checker is therefore unchanged in the green integration tree.

### Final live head

The attached final capture records head `2990c53dc6cff9f8cce60f89179c2db016b0c78f`, final run `30405539161`, job/check `90430020292`, suite `82416204506`, and tree `be78c9276be9bcceb3598b9d5f790e11f2b6951c`; all completed successfully.  

The immutable commit view confirms that `2990c53…` has exactly one parent, `1142708…`, and changes exactly four files, all under `.apr/`: the evidence manifest, source patch, round-twelve review, and APR workflow. There is no non-APR descendant implementation change. The branch history still lists this round-thirteen evidence commit as its latest commit. ([GitHub][1])

This means the final-head evidence is admissible, but it binds the same source checker containing the blocker above.

## Mandatory post-merge gates remain pending

None of the following may be claimed complete from this pre-merge evidence:

1. Derive the reaffirmed password HMAC without logging either input, materialize it into both governed Infisical scopes, and perform complete managed Coolify parity readback.
2. Deploy Convex first and then the exact repaired merge SHA to canonical staging.
3. From a clean cookie jar, run the mandatory release proof with a nonzero expected count and exactly zero skipped, flaky, unexpected, or failed tests.
4. Prove live `method=password`, viewer role, thirty-minute expiry, HTTP-only/SameSite/Secure cookie flags, password-bearer rejection, configured review-token role and twelve-hour expiry.
5. Prove raw review, leads, transcripts, voice details, events, analytics/queues, and every mutation return `403` to the password principal.
6. Prove Redis store identity, shared remaining-count behavior across instances, spoofed-earlier-XFF stability, and actual `429` exhaustion.
7. Prove managed HMAC readback, exact-running-SHA staging, then promote the identical SHA to production and repeat the guarded same-SHA proof while retaining rollback.

The manifest itself correctly describes these as post-merge work rather than completed runtime evidence. 

## Required repair

The checker needs one semantic return-summary mechanism shared across all authority analyses, keyed by resolved declaration/symbol and covering function declarations, function expressions, arrows, object/class methods, getters, and setters. Calls must inherit those return summaries.

That summary must then be used consistently for:

* privileged process/module/global/Object/Reflect and loader identity;
* mutable allowed-export identity;
* private signer/bearer-verifier/claims taint;
* the actual receiver returned by a call;
* values and targets returned as dynamic call/apply/`Reflect.apply` vectors.

The hostile examples above, plus safe twins, must be added as regressions. After repair, regenerate the exact source patch and all source-CI, eight-head integration, final-head, hash, and overlap evidence.

VERDICT: DO NOT MERGE

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/2990c53dc6cff9f8cce60f89179c2db016b0c78f "docs(apr): bind round thirteen security proof · Biji-Biji-Initiative/oriental-website@2990c53 · GitHub"
