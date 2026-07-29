## Decision

**Do not merge this tree.** I verified the reviewed source identity as commit `1aad025aedc94c953de6b91344b093ab439e3b36`, tree `a953354e0cc3af5334b9f5a2ea42e623dcdcc48f`. The 300,879-byte source-only patch has SHA-256 `92491e1f8dfdb36b19d97734fc5b578fcddc46a3c24817992b80511209876402` and contains 45 distinct non-APR changed files.

The runtime design **does materially contain the potentially known password**, subject to the owner’s stated acceptance of aggregate disclosure and repeat bounded compute. The password is not a bearer or signing credential; it mints signed `method=password`, role `viewer` sessions for thirty minutes; the password principal is limited to `dashboard.aggregate` and `session.logout`; and the dedicated Convex query returns only a fixed numeric DTO while raw customer records, email addresses, transcripts, voice evidence, events, analytics detail, and queues remain inside Convex or behind managed-token step-up. The thirty-minute expiry does not restore password secrecy or prevent repeated login, so containment comes from reduced authority—not the TTL.

That runtime containment does not cure two release-blocking P1 defects.

## P1 — The round-thirteen semantic repair still has false greens

The exact hostile fixtures added after round thirteen pass in the submitted test suite. The broader semantic class does not.

I extracted the exact analyzer from `tests/admin-auth-boundary.test.ts`, together with the exact reviewed `admin-auth.ts`, and invoked its exported analysis functions directly. These fresh cases all returned an empty violation result:

| Required identity flow           | Fresh hostile shape                                                                         | Analyzer result                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Privileged loader                | Class-property arrow returns `module`                                                       | `forbiddenAccesses = []`                           |
| Privileged loader                | Object method is destructured before invocation                                             | `forbiddenAccesses = []`                           |
| Privileged loader                | Arrow factory invoked through `.bind()`                                                     | `forbiddenAccesses = []`                           |
| Privileged loader                | Factory invoked through `.call()`                                                           | `forbiddenAccesses = []`                           |
| Privileged loader                | Factory assigned to an `any`-typed object property                                          | `forbiddenAccesses = []`                           |
| Whole-program loader             | Imported governed helper returns `module`; caller reflects `require` and loads `admin-auth` | no forbidden access and no resolved protected call |
| Global receiver / mutable export | Class-property arrow returns `globalThis.Object`, then calls `assign` on an allowed export  | `violations = []`                                  |
| Mutable-export identity          | Class-property arrow returns `adminCookieHeader` before mutation                            | `violations = []`                                  |
| Actual receiver / private taint  | Class-property, bound, or `.call()` factory returns the mutation target receiving `sign`    | `violations = []`                                  |
| Dynamic vector                   | Class-property arrow returns `[result, "signer", sign]` for `Reflect.apply(Reflect.set, …)` | `violations = []`                                  |

A representative loader false green is:

```ts
class Bridge {
  get = () => module;
}

const M = new Bridge().get();
const req = Reflect.get(M, "require") as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");
auth.createAdminLoginSession({} as never, 0);
```

This is not a remote syntactic curiosity. It combines an arrow, a class instance, a function-return bridge, reflected loader acquisition, and an outside invocation of the session minter—the exact semantic closure the acceptance contract requires.

The implementation’s return-bearing union includes arrow functions, function declarations and expressions, methods, getters, and setters, but **not `PropertyDeclaration`**. A class-field arrow therefore appears as a property declaration whose initializer is never followed as a callable member.

The assignment summary records only simple identifier variable declarations plus binary assignments. Its declaration-resolution branch handles variable declarations, property assignments, shorthand assignments, and direct expressions, but not class property declarations or binding elements.

Invocation expansion is similarly incomplete: `fromCall` resolves the direct callee and a nested call expression, but does not resolve the original callable through `.bind`, `.call`, `.apply`, or equivalent invocation mediation.

The whole-program claim is also overstated. `semanticFunctionReturns` constructs a new one-file TypeScript program with `noResolve: true` and `noLib: true`. Consequently, an imported helper’s return cannot participate in this supposedly shared return graph. My synthetic program included the route, the helper, and `admin-auth.ts` in `governedProgramPaths`; the imported helper returned `module`, but the route’s reflected `require` and dynamic minter call were admitted.

### Safe shadowing is still resolved by spelling

The claimed safe-shadowing differential is also false. These safe local bindings were rejected as privileged:

```ts
const module = { require: () => ({ safe: true }) };
void Reflect.get(module, "require")();
```

```ts
const Object = {
  assign: (..._args: unknown[]) => ({ safe: true }),
};
Object.assign(adminCookieHeader, { harmless: true });
```

Equivalent local shadows of `require`, `process`, and `Reflect` were also rejected.

That behavior follows directly from the remaining textual identity maps. Privileged identities are seeded in a `Map<string, …>` under the literal names `globalThis`, `module`, `process`, `Reflect`, and `require`; mutation receivers are likewise seeded by the strings `Object` and `Reflect`. These are not declaration identities, so a lexically shadowed local symbol inherits privileged meaning merely from its spelling.

The repair therefore does **not** provide one declaration-keyed graph shared by loader identity, global receiver identity, private taint, mutable exports, receiver resolution, and dynamic vectors. It provides a locally symbol-aware return helper feeding several analyses that still retain textual alias state and incomplete callable forms.

I did not find one of these escape constructs in the reviewed production source itself. The blocker is that the mandatory whole-program admission proof can falsely certify such source. A later route or bridge could dynamically acquire the exported verifier/minter outside `POST /api/admin/login`, bypassing the route’s same-origin and rate-limit boundary, or an auth-module edit could attach `sign`, `verifyAdminBearerToken`, or `verifiedAdminLoginClaims` to an allowed export without the gate detecting it.

## P1 — One immutable support artifact fails its declared digest

The evidence manifest declares `integration-merge-dag.txt` as 21,091 bytes with SHA-256:

```text
b2899e2cb8a3cb8952aba6fa05a778937363d4749f16474cb4907f17c11da377
```



The attached 402-line payload reconstructs to:

```text
21,089 bytes
216634a831de0f6ae997e1df1c6ae217afe55788fc043c67225a1538fe9f2b67
```

No plausible final-newline, CRLF, or UTF-8 BOM normalization recovers the declared digest. A BOM plus omitted final LF produces the stated byte count, but still a different SHA-256.

The payload text lists the expected integration commit/tree, all eight exact heads as ancestors, and the beginning of the first-parent composition.  However, under an exact-byte admission contract, internally plausible text is not a substitute for a matching immutable artifact. I therefore cannot confirm the all-eight-head first-parent composition with the required raw-byte binding.

This would remain an evidence blocker even without the semantic false greens.

## Runtime controls rechecked

The source runtime controls themselves were not independently refuted:

| Control                          | Review result                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password principal               | Forces `principal=password`, role `viewer`, signed method `password`, and a thirty-minute session                                                                                                               |
| Permission ceiling               | Explicitly rejects every password-session permission except aggregate dashboard and logout                                                                                                                      |
| Review-token session             | Signs method `review`, preserves the configured interactive role, and uses the twelve-hour TTL                                                                                                                  |
| Bearer boundary                  | The password is never considered by ordinary bearer verification; only review, ops, and privacy bearer credentials are candidates                                                                               |
| Aggregate query                  | Reads at most the normalized `take` of payload-safe lead and voice rows and returns a declared fixed Convex object                                                                                              |
| Next DTO validation              | Strict object, finite integer nonnegative counts, each count no greater than `take`, percentages within 0–100, lead subsets no greater than `recentLeads`, and voice subsets no greater than `reviewedSessions` |
| Page/API separation              | Password page and metrics route use the aggregate adapter rather than raw dashboard, lead-table, transcript, event, analytics, or queue materialization                                                         |
| One-time mint claims             | Exact-object module-private `WeakMap`, deletion before mint, and no trust in caller-visible fields                                                                                                              |
| Collision handling               | Password equality with review, ops, or privacy bearer credentials fails login, signing, session verification, and bearer planes closed                                                                          |
| Canonical target                 | Only the two exact HTTPS root origins are accepted; ports, paths, queries, fragments, userinfo, HTTP, and compatibility hosts fail                                                                              |
| Release verifier source contract | Requires all credential inputs and a browser, parses JSON output, requires nonzero expected tests, and rejects nonzero skipped, flaky, or unexpected counts                                                     |
| Telemetry                        | Successful login records only bounded actor, method, role, and expiry metadata—not credentials, HMACs, cookies, or request bodies                                                                               |

The fixed Convex return validator is present, and the independent Next schema enforces both count bounds and child-over-parent relationships.

The one-time claims and private bearer design are coherent in the reviewed source.  Collision detection derives each managed bearer candidate under the password-HMAC domain and fails every auth plane closed when a collision exists.  Successful-login telemetry is restricted to the intended bounded provenance fields.

The live release verifier’s source does hard-fail on missing inputs or invalid/nonzero Playwright reporting, and release mode disables the ordinary optional-test skips rather than silently accepting them.

## Artifact recomputation

I reconstructed the embedded artifact bytes and recomputed SHA-256 as follows:

```text
artifact                                           bytes      recomputed SHA-256
attachments-bundle(19).txt                         2,151,646  39f18350a421eb5f4d9738bb902062fdc07fe2a75900d90148d02c51225c7907
oriental-admin-password-security.md                   25,857  4d8d7aba6b3bb060e540e511ea14f8841a883a834e5b6183fac3b381c29ecce1
oriental-admin-password-security.patch               300,879  92491e1f8dfdb36b19d97734fc5b578fcddc46a3c24817992b80511209876402  MATCH
oriental-admin-password-security spec                  5,567  4372cab8447159533853106e6eb936346537da816f3ecdbef3c9a019a2ecf4b5
github-evidence.json                                  105,523  a5a22552df45ea9222e4b131a938945a81cff3bbc63ac69e33ba48b8c030eb31  MATCH
integration-github-evidence.json                      221,969  b0f335652a1e53e8733bb8ce63e5874b74c45e33cf3de4201b89644f0eba371a  MATCH
source-ci.log                                          71,109  92b22018b1aeb305637543686600c8188ff44b8236aa031feaf4516a5a931b00  MATCH
integration-ci.log                                     76,693  0da530f7323670039f6d9db295de78a56b0d312bc61e3a075f798f122468dcc6  MATCH
integration-merge-dag.txt                              21,089  216634a831de0f6ae997e1df1c6ae217afe55788fc043c67225a1538fe9f2b67  MISMATCH
source-to-integration-overlap.diff                     33,778  9588042fb0e8da5abec737526158cb10c4413614ce67d7051a560997051bb59f  MATCH
integration-vitest.json                               865,255  f78ac0705b3cd9bd9b1ca322ee2e334b5bce95449b33e8aa0fbffc35e1acc8b0  MATCH
integration-audit.json                                    310  e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c  MATCH
round_13.md                                            17,593  71d8e05782d059a3c18f8681f08f6a328c8f153b08ff15fb1aebeacead30d43c  MATCH
final-head-github-evidence.json                       149,144  bb48898bbedfefba8209fc1c01dd91c4f69463843fa90b75ac1232f26d39d5dc
final-head-ci.log                                      71,320  54fc9c1d565f88f6e61a5a432dfe7ece0856807a42d45bc756a54bd3548b8438
source-to-live-head.diff                               81,712  61cc67064e58d7ed3192fae1518c73371c772efed030467c243f294cd390ce3d
```

For the one-line Vitest JSON, the enclosing bundle contributes one separator LF after the JSON. Excluding that framing LF yields the declared 865,255-byte raw artifact and matching digest. Including it gives 865,256 bytes and SHA-256 `6ae1785e7c3f27f7784b0084d8faab1f6899d017d7db8dafe55041dbdb5d32a6`. The JSON parses successfully either way and reports 89 result files, 2,337 passed tests, and zero failed, pending, or todo tests.

No comparable framing treatment repairs the integration DAG.

## Source, integration, and final-head CI

### Source CI

Run `30408868377`, job/check `90440375331`, suite `82425246372`, event `pull_request`, checked out exactly:

```text
1aad025aedc94c953de6b91344b093ab439e3b36
tree a953354e0cc3af5334b9f5a2ea42e623dcdcc48f
```



The raw source log confirms clean Biome lint over 284 files, strict `next typegen && tsc --noEmit`, 85 test files and 2,222 passed tests, and the Next.js 16.2.10 production build.

The GitHub setup layer emitted a `url.parse()` deprecation warning, so “warning-free” is accurate for the raw lint result, not for every line of the entire CI log.

### Eight-head integration CI

Run `30408993940`, job/check `90440734343`, suite `82425570064`, event `pull_request`, checked out exactly:

```text
e78e2e9aa5cc468fa7ed8d88913bc34b2748cc05
tree af7948abcb35ad9b18cbdb19a456c467245e6f32
```

The raw log also confirms pnpm `10.34.5`.

The integration gates themselves are reproduced:

* frozen pnpm `10.34.5`, explicit npm registry, and frozen-lockfile install;
* clean lint over exactly 294 files;
* strict TypeScript;
* zero info, low, moderate, high, or critical production audit findings across 378 dependencies;
* 89 test files and 2,337 tests passed;
* Next.js 16.2.12 compiled and entered/completed its TypeScript phase;
* mobile performance: LCP 1,292 ms, CLS 0, 444,011 transferred JavaScript bytes, 1,530,943 decoded bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations.

The integration-overlap diff does not alter `admin-auth.ts`, `admin-route.ts`, the login or metrics routes, the boundary checker, or the admin release-proof implementation. I found no password-security conflict introduced by the overlapping integration paths.

The embedded DAG text identifies the eight requested PR heads and shows `e78e2e9…` directly merging `1aad025…` into the prior integration chain. Because that artifact’s hash fails, however, I do not elevate its textual assertions to exact immutable composition proof.

### Captured final descendant

The supplied final evidence captures head:

```text
bc56fd8b6c4df4f85e19a54c64a4e879e8521a46
tree 23898f1d69a5d3f29fb37d9dbd866392ae813463
```

Final run `30409464424`, job/check `90442153538`, suite `82426795280`, event `pull_request`, completed successfully on that exact checkout.

The source-to-live diff contains exactly four descendant paths, all under `.apr/`: the evidence manifest, source patch, recovered round-thirteen response, and APR workflow.  GitHub’s exact commit page independently shows `bc56fd8` with one parent, `1aad025`, and only those four `.apr` files. ([GitHub][1])

Thus, **the supplied captured descendant contains no non-APR source change**. That does not remedy the semantic false greens already present in the reviewed implementation commit.

## Mandatory post-merge gates remain pending

None of these may be reported as complete from this pre-merge bundle:

1. Perform the Convex-first release and required migration/orphan-sweep verification before any web deployment.
2. Derive the reaffirmed password HMAC without logging either input.
3. Write it to both governed staging and production Infisical scopes.
4. Reconcile and read back the complete managed Coolify environment, including exact password-HMAC parity and plaintext-alias absence.
5. Deploy the exact merge SHA—not an evidence descendant—to canonical staging.
6. Run the clean-cookie admin release proof with nonzero expected tests and exactly zero skipped, flaky, unexpected, or failed tests.
7. Prove live cookie `HttpOnly`, `SameSite`, and production `Secure` flags; signed `method=password`, role `viewer`, thirty-minute expiry; password bearer rejection; review-token configured role and twelve-hour expiry.
8. Prove password-session `403` responses from every raw review, customer, lead, transcript/voice, event, analytics/queue, and mutation route.
9. Prove Redis store identity, shared monotonic remaining counts across parallel requests, spoof-resistant proxy ownership, and exhaustion to `429`.
10. Promote the identical SHA to production only after staging passes, then repeat managed-environment readback, authentication, health, exact-running-SHA, and rollback proof.

The manifest itself correctly labels these as post-merge work and expressly says the live cookie, TTL, bearer, Redis, and exhaustion results have not yet been proved.

VERDICT: DO NOT MERGE

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/bc56fd8b6c4df4f85e19a54c64a4e879e8521a46 "https://github.com/Biji-Biji-Initiative/oriental-website/commit/bc56fd8b6c4df4f85e19a54c64a4e879e8521a46"
