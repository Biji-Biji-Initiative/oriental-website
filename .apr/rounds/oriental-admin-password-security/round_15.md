## Decision

**Do not merge this tree.**

I verified the reviewed source identity as commit `0a2321f8e003fade6f6a0c28d47d73a3f7b213df`, tree `861f29a18463f021e2f5c0a38255738e167c7d08`, based on `e3bb6c333cbf4bf8e52456a1b5144f556f50636a`. The authoritative source-only patch is 313,649 bytes, 6,602 lines, covers 45 non-APR files, and recomputes to SHA-256 `3947b670c11d2100d8fdb2300197a864de245805f139b0d3fe4bd31598fa2ec6`.

The password design **materially contains the potentially known-password risk**. It does not restore password secrecy, but it reduces the password principal to a signed `method=password`, role `viewer`, thirty-minute session that can access only the fixed aggregate DTO and logout. Raw customer records, email addresses, transcripts, voice detail, events, analytics/queues, mutations, evals, maintenance, and privacy operations require managed-token step-up. The residual risk is repeatable access to the permitted aggregate values and bounded aggregate computation after reauthentication, which the owner has explicitly accepted.

However, the mandatory whole-program authority-admission proof remains unsound. The exact round-fourteen snippets now fail, and the exact safe-shadow fixtures now pass, but broader semantically equivalent forms still produce false greens.

## P0 release blocker — the claimed shared semantic graph is still incomplete

### Improvements that are real

The candidate now has a `WeakMap<ts.Program, SemanticAssignmentIndex>` cache containing symbol-keyed assigned values, property values, and indexed source files. When a governed program is supplied, it scans all non-declaration, repository-local program sources and caches their assignment information.

The submitted regressions cover the exact reported class-property arrow, direct object-method destructuring, direct `.bind()`, `.call()`, `.apply()`, direct any-object property, and direct imported-helper cases.   The exact local shadows of `module`, `require`, `process`, and `Reflect`, plus a local `Object.assign` lookalike, are also admitted as intended.

Those improvements do not establish the requested semantic closure.

### Broader hostile equivalents still pass

Using the exact analyzer extracted from the reviewed source patch, the following classes returned empty findings:

| Broader hostile form                                                      | Observed result                    |
| ------------------------------------------------------------------------- | ---------------------------------- |
| Function stored through an alias of an `any`-typed object                 | `forbiddenAccesses = []`           |
| Nested object-method destructuring                                        | `forbiddenAccesses = []`           |
| Assignment destructuring into a previously declared variable              | `forbiddenAccesses = []`           |
| `Function.prototype.call.call(factory, …)`                                | `forbiddenAccesses = []`           |
| `Function.prototype.apply.call(factory, …)`                               | `forbiddenAccesses = []`           |
| `Function.prototype.bind.call(factory, …)()`                              | `forbiddenAccesses = []`           |
| Aliased `Reflect.apply`, such as `const R = Reflect; R.apply(…)`          | `forbiddenAccesses = []`           |
| Destructured `Reflect.apply`                                              | `forbiddenAccesses = []`           |
| Cross-file imported helper followed by any of those mediations            | `forbiddenAccesses = []`           |
| Allowed export recovered through assignment destructuring before mutation | `authRuntimeExportViolations = []` |
| Private authority inserted into a receiver recovered through those forms  | `authRuntimeExportViolations = []` |
| Protected dynamic vector returned through those forms                     | `authRuntimeExportViolations = []` |

A representative loader bypass is:

```ts
const box: any = {};
const alias = box;

alias.get = () => module;

const M = box.get();
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

The direct fixture `moduleBridge.get = () => module; moduleBridge.get()` is caught. The equivalent write through `alias` and read through `box` is not.

Assignment destructuring also remains a false green:

```ts
const bridge = {
  get() {
    return module;
  },
};

let get: () => NodeModule;
({ get } = bridge);

const M = get();
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

And arbitrary call mediation remains unmodelled:

```ts
const bridge = () => module;

const M = Function.prototype.call.call(bridge, null);
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

Equivalent JavaScript executed successfully on Node 22: it recovered `module.require`, loaded a local module, and invoked the protected minter stand-in. These are executable loader paths, not inert AST arrangements.

### The source explains the false greens

Property writes are indexed under the symbol of the **immediate syntactic receiver**. `alias.get = value` is stored under the symbol for `alias`, while `box.get()` is looked up under the distinct symbol for `box`; the property-slot lookup does not canonicalize the receiver through `assignedValues`.

The `BindingElement` branch only recovers an initializer when the binding pattern’s immediate parent is a `VariableDeclaration`. That handles direct `const { get } = bridge`, but not nested destructuring—where the immediate parent is another binding element—or assignment destructuring—where no variable declaration supplies the initializer.

Invocation handling recognizes only direct `.bind`, `.call`, and `.apply` member shapes. The special `Reflect.apply` handling additionally requires the receiver to be a literal identifier whose text is exactly `Reflect`. It does not normalize `Function.prototype.call.call`, `Function.prototype.apply.call`, `Function.prototype.bind.call`, an alias of `Reflect`, or destructured `Reflect.apply`.

Most importantly, the implementation does not literally use one cached, program-scoped graph across all six claimed authority analyses:

* `protectedSymbolAuthority` supplies the governed production program to `semanticFunctionReturns`;
* `authRuntimeExportViolations` creates a standalone source file and calls `semanticFunctionReturns` **without** the governed program, so private taint, mutable-export identity, receiver resolution, vector expansion, and Object/Reflect mutation analysis do not use the program cache.

Thus the manifest’s statement that “the same cached graph is shared” by privileged loader identity, global receiver identity, private taint, mutable exports, actual receiver resolution, and dynamic vectors is not true of this implementation.

### The same gaps permit private-authority escape

The broader shapes also break the auth-module export guard. For example:

```ts
const bridge = {
  get() {
    return adminCookieHeader;
  },
};

let get: () => typeof adminCookieHeader;
({ get } = bridge);

Object.assign(get(), { signer: sign });
```

The actual exported function is augmented with the private signer, but `authRuntimeExportViolations` returns `[]`.

Likewise:

```ts
const result: Record<string, unknown> = {};
const args = () => [result, "signer", sign];

Reflect.apply(
  Reflect.set,
  null,
  Function.prototype.call.call(args, null),
);

return result as unknown as string;
```

At runtime this inserts the private signer into `result`; the checker still reports no violation. Equivalent `apply.call`, `bind.call`, any-object receiver-alias, aliased-`Reflect`, and destructured-`Reflect.apply` versions also pass.

Safe versions using a harmless string remain admitted, which is good. The defect is that the hostile twins are admitted too.

### Security impact

I did not find one of these injected bypasses in the current production source. The blocker is the mandatory release gate’s false-green behavior.

A later repository-local production source could recover `module.require`, dynamically load `admin-auth.ts`, and call the exported credential verifier or session minter outside `POST /api/admin/login`. That bypasses the login route’s same-origin and rate-limit boundary. If such a source has access to the managed review token, it could obtain review-token provenance rather than merely a password-viewer session.

A modification inside `admin-auth.ts` could similarly attach `sign`, `verifyAdminBearerToken`, or the private verified-claims state to an allowed export while the checker certifies the export surface as safe.

Because the explicit release contract requires all broader equivalents to fail, these false greens are merge-blocking even though the current runtime source does not itself contain a malicious bridge.

My independent extraction harness used the container’s TypeScript 5.8.3 because the lockfile compiler package was not locally available. I do not rely on compiler-version behavior for the verdict: the missing receiver canonicalization, limited binding-parent branch, direct-only invocation cases, and non-program-scoped auth-export call are explicit in the reviewed source, and the equivalent JavaScript paths execute at runtime.

## Recheck of the remaining controls

| Control                                    |                      Result | Assessment                                                                                                                 |
| ------------------------------------------ | --------------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Known-password capability reduction        |                    **Pass** | Materially limits the password to aggregate metrics and logout                                                             |
| Password permission ceiling                |                    **Pass** | A password session is explicitly rejected for every permission other than `dashboard.aggregate` and `session.logout`       |
| Aggregate query bounds                     |                    **Pass** | Convex reads at most normalized `take`; Next requires strict shape, finite nonnegative integer counts, and count ≤ `take`  |
| Aggregate subset consistency               |                    **Pass** | Lead subsets cannot exceed `recentLeads`; voice subsets cannot exceed `reviewedSessions`                                   |
| One-time private mint claims               |                    **Pass** | Claims are held in a private `WeakMap` and deleted before validation/mint, preventing replay                               |
| Password/bearer collision cross-product    |                    **Pass** | Review, operations, and privacy bearer candidates are all tested under the password-HMAC domain                            |
| Effective Next configuration               |   **Pass for current tree** | Uses Next’s production `loadConfig` and checks effective extensions, including a computed/imported hostile configuration   |
| Explicit route/method/permission inventory |   **Pass for current tree** | Exact canonical route map is present                                                                                       |
| Route/export closure                       | **Pass for explicit forms** | Default exports, export assignments, re-exports, and CommonJS route forms are rejected                                     |
| Whole-program source discovery             |                    **Pass** | Repository-local program sources are included                                                                              |
| Whole-program semantic authority admission |                    **Fail** | Broader alias, destructuring, mediation, and cross-file paths remain false green                                           |
| Canonical release origin                   |          **Pass in source** | Requires HTTPS, root path, no userinfo/query/fragment, and one of two exact origins                                        |
| Release-proof hard failure                 |          **Pass in source** | Requires nonzero expected tests and exactly zero skipped, unexpected, and flaky tests                                      |
| Telemetry safety                           |                    **Pass** | Successful-login telemetry contains actor, method, expiry, and role, not credentials or cookies                            |
| Live release proof                         |                 **Pending** | Correctly remains a post-merge gate                                                                                        |

## Raw artifact recomputation

The complete attachment itself is 2,152,457 bytes with SHA-256:

```text
033c0b70a3c587ccc89492f92e7cf5bd0bb07cf92ae580d9393b3a8700681647
```

I reconstructed each embedded raw artifact and recomputed its digest independently. Every declared byte count and SHA-256 now matches, including the DAG artifact that failed in the previous round. The manifest’s declared artifact inventory and expected digests are reproduced at lines 269–312.

```text
Artifact                                      Bytes    Recomputed SHA-256                                               Result
source-only patch                           313,649    3947b670c11d2100d8fdb2300197a864de245805f139b0d3fe4bd31598fa2ec6   MATCH
github-evidence.json                         68,904    3a70e3353f0e9b0b8f62848dd7d6d94372ea8a51a4365035f9c0184af01f6b55   MATCH
integration-github-evidence.json            217,105    144464e9b4810e3e72244acef45b073a0425c7a9f96ffcd7aa80efb21794a54e   MATCH
source-ci.log                                71,514    ff5f592e43a04865d822d72a0cc798a9d3b098b3d2c07c0c887bbde7f1c75a9c   MATCH
integration-ci.log                           76,974    c6a27429badab7f772c581ff1c543d0ec07790f74b43bee719b7dcaa2e07487a   MATCH
integration-merge-dag.txt                    47,648    9debe9f8d9c324c9246b4307189db75bb0c21f92aa8b641d159e75fb10dedab5   MATCH
source-to-integration-overlap.diff           33,276    b530dcb6ad0cb4c39ba20c0f9c6cae6d1595d1f7be0de8343fc203bbd45a5813   MATCH
integration-vitest.json                     865,284    2fa9f9512039a9cefebe959da1a39c271b059af6cd3faf51f826ba7972a2f0d5   MATCH
integration-audit.json                          310    e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c   MATCH
round_13.md                                  17,593    71d8e05782d059a3c18f8681f08f6a328c8f153b08ff15fb1aebeacead30d43c   MATCH
round_14.md                                  20,130    f4b9287c1a0cc39d59026093d37419952a8c954183822d5852f96ba76bdd67eb   MATCH
final-head-github-evidence.json             138,150    33baa9fe704f986a4955e5a7779293082b48ed790e9984cd711dca0384c5861a   MATCH
final-head-ci.log                            71,467    9d183e51e865826c1d4f8c4809b4bf694d8b482c9810b0be3648fd6884b7a6ca   MATCH
source-to-live-head.diff                     70,089    bcebb7a47521fd1d182d17a018d8b0de821a59c0bdc578b7b045524119f2eb36   MATCH
```

The one-line Vitest JSON correctly hashes without an added terminal newline. The normalized DAG and round-fourteen response hash exactly as supplied.

## Source CI

The source evidence consistently identifies:

```text
run:       30413916916
job/check: 90456091869
suite:     82438933127
event:     pull_request
SHA:       0a2321f8e003fade6f6a0c28d47d73a3f7b213df
tree:      861f29a18463f021e2f5c0a38255738e167c7d08
```

The raw checkout attestation records the exact requested SHA and tree.

The source run passed:

* warning-free Biome lint over 284 files;
* strict application and Convex TypeScript;
* 85 files and 2,222 tests;
* the missing-configuration hard-fail release-proof guard;
* Next.js 16.2.10 production build;
* mobile performance and source `diff --check`.

The source test summary reports 85 files, 2,222 tests, and 57.24 seconds total.  The semantic boundary suite itself completed its 11 tests in 41.836 seconds.  Thus the cache does keep the observed source CI runtime bounded; it does not provide the required semantic completeness.

## Eight-head integration

The integration checkout is exactly:

```text
run:       30414193707
job/check: 90456956044
suite:     82439679922
event:     pull_request
SHA:       5839ef6ccd1214b1d5a90e6627e8e097236a4dd4
tree:      e637916cea01aa1e0540aed47ebd6144fcb672c6
```

The raw checkout also shows pnpm `10.34.5`.  The public GitHub Actions result independently reports the integration workflow as successful. ([GitHub][1])

The normalized DAG records all eight requested heads as ancestors:

```text
#78  7657afae19433f276c89967ca9f6c2a94a509fd9
#79  aaeba89264b34a902d4d1595bf4d31907a91b2d4
#80  0a2321f8e003fade6f6a0c28d47d73a3f7b213df
#81  297e0b1a47d7d8cf3a005c606146b7de8dd7ff96
#82  d81140cb87ff36a6e4196f230a9b4d7bf9a69806
#83  f9467a918708c9385163516e01f34f4d9bb58d3f
#84  413fdf0eaf758394c68d817aaf588558ead80a57
#85  42bd5f078754ae925d71f7f9cc1e5eb8778a5f20
```



The integration head’s first-parent entry is a merge of the prior integration chain and the exact reviewed source head:

```text
commit 5839ef6ccd1214b1d5a90e6627e8e097236a4dd4
Merge: e78e2e9 0a2321f
```



The raw integration gates confirm:

* pnpm `10.34.5` and `https://registry.npmjs.org/`, followed by frozen-lockfile installation;
* warning-free Biome lint over exactly 294 files;
* strict TypeScript;
* zero audit findings at every severity across 378 production dependencies;
* 89 test files and 2,337 tests passed with no pending tests;
* Next.js 16.2.12 compiled successfully;
* mobile performance passed with LCP 1,400 ms, CLS 0, 444,008 transferred JavaScript bytes, 1,530,943 decoded bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations.

The integration semantic boundary test completed in 60.429 seconds, and the overall 89-file test run completed in 84.60 seconds.  The runtime remains bounded, but the integration runs the same false-green checker and therefore does not cure the release blocker.

## Final live PR descendant

The supplied final evidence identifies:

```text
head:      92060bad1edac337393e5cc5bae5ede4c095c043
tree:      784207833079bdb1411fef9c6e8b887de9d23c98
run:       30414882217
job/check: 90459099573
suite:     82441530945
event:     pull_request
```

The raw final CI checkout attests the exact head and tree.  The run, check, and suite all report completed success on that exact head.    The public workflow page independently reports success. ([GitHub][2])

The descendant diff has exactly three file headers:

```text
.apr/evidence/oriental-admin-password-security.md
.apr/evidence/oriental-admin-password-security.patch
.apr/workflows/oriental-admin-password-security.yaml
```



GitHub independently shows that `92060bad…` has the reviewed implementation commit `0a2321f…` as its sole parent and changes exactly those three `.apr/` files. There is no non-APR descendant implementation change. ([GitHub][3])

The live-head evidence is therefore admissible, but it binds the same implementation containing the semantic-admission blocker.

## Mandatory post-merge gates remain pending

None of the following is proved complete by this pre-merge bundle:

1. **Convex first:** deploy the frozen Convex functions, complete the required lifecycle migration/orphan-sweep verification, and fail closed before any web deployment mutation.
2. Derive the reaffirmed password HMAC without logging either input, write it to both governed Infisical scopes, reconcile the complete Coolify environment, and perform managed parity readback.
3. Deploy the exact repaired merge SHA to canonical staging and run the clean-cookie release proof with nonzero expected tests and exactly zero skipped, flaky, unexpected, or failed tests.
4. Prove live cookie `HttpOnly`, `SameSite`, and production `Secure` flags; signed `method=password`, role `viewer`, thirty-minute expiry; password bearer rejection; configured review-token role and twelve-hour expiry.
5. Prove password-session `403` responses from raw review, customer/lead, transcript/voice, event, analytics/queue, eval, maintenance, privacy, and mutation routes.
6. Prove Redis store identity, shared remaining counts under parallel requests/instances, spoofed-earlier-XFF stability, and actual exhaustion to `429`.
7. Promote the identical SHA to production only after staging passes, then repeat managed-environment readback, authentication, health, exact-running-SHA, and rollback proof.

The manifest correctly describes these as mandatory post-merge gates rather than current live results.

## Required correction

The next candidate needs to:

* canonicalize property receivers through the symbol assignment graph, so writes through one alias are visible through every equivalent receiver;
* recursively model nested binding patterns and assignment destructuring;
* normalize arbitrary `Function.prototype.bind/call/apply` mediation, including call/apply chains;
* resolve aliased and destructured `Reflect.apply` by symbol identity rather than literal spelling;
* use the actual governed, cached program graph in `authRuntimeExportViolations`, not a separate one-file analysis;
* apply those corrections consistently to privileged loaders, global mutation receivers, private taint, mutable exports, actual mutation receivers, and dynamic vectors;
* add every reproduced broader hostile form and safe twin, then regenerate source, integration, final-head, overlap, and raw hash evidence.

VERDICT: DO NOT MERGE

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30414193707 "ci: attest exact eight-PR integration (do not merge) · Biji-Biji-Initiative/oriental-website@5839ef6 · GitHub"
[2]: https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30414882217 "fix(auth): manage interactive admin password · Biji-Biji-Initiative/oriental-website@92060ba · GitHub"
[3]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/92060bad1edac337393e5cc5bae5ede4c095c043 "docs: bind round 15 admin auth evidence · Biji-Biji-Initiative/oriental-website@92060ba · GitHub"
