# Decision

**Do not merge commit `5f47c982b1b26a4d3966d6337ff74cf7e88307b4`, tree `206423b67ccb4446a8f6956851348eba9e2feddb`.**

The runtime design **does materially contain the potentially known password** to the owner-accepted residual exposure: repeatable access to a bounded, PII-free aggregate DTO and logout. The password is not restored to secrecy, but it cannot act as a bearer credential, signing key, raw-data principal, or mutation principal.

Artifact integrity, source CI, eight-head integration CI, all eight individual exact-head checks, and the final evidence-only live head are consistent and successful. However, one release-blocking P0 remains in the mandatory whole-program authority-admission checker: **a receiver alias obtained through object or array destructuring is recorded in `assignedMemberPaths` but is not canonicalized into `equivalentValueSymbols` before property writes and reads are joined**. That leaves a reproducible privileged-loader false green.

The reviewed identity and authoritative 335,865-byte source-only patch otherwise match the manifest exactly.

## P0 — Destructured receiver aliases still bypass privileged-loader admission

I executed the exact analyzer helper bodies from the attached patch against this hostile source:

```ts
const box: any = {};
const holder = { box };
const { box: alias } = holder;

alias.get = () => module;

const M = box.get();
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

**Observed result:**

```text
forbiddenAccesses = []
```

The safe twin, changing only the assigned function to return a harmless lookalike, also returns `[]`:

```ts
alias.get = () => ({
  require: () => ({ safe: true }),
});
```

Therefore, the required hostile/safe differential is absent: the safe case is correctly admitted, but the hostile case is also admitted.

I reproduced the same false green with:

* nested object binding;
* assignment destructuring;
* array binding, including nested arrays;
* array assignment destructuring;
* writing through the original receiver and reading through the destructured alias;
* writing through the destructured alias and reading through the original;
* functions extracted from array members;
* a cross-file imported helper exporting the original receiver and a holder that contains it.

A direct CommonJS execution confirmed that the two identifiers identify the same receiver and that the recovered `module.require` successfully loads `node:path`. This is therefore not merely an AST spelling discrepancy.

### Why the repair misses it

The repair correctly records nested binding and assignment paths, including shorthand-assignment symbols and numeric array-member paths, in `assignedMemberPaths`.

But receiver canonicalization does not consume that map. `equivalentValueSymbols` follows only `assignedValues`; `propertySlot`, property-write recording, and property-value lookup then rely on that incomplete result.

The separate `memberReferences` path follows checker properties and previously indexed property writes, but does not directly project an object-literal shorthand value or an array-literal element into the canonical receiver graph.

That explains the exact differential:

* `const alias = box` works because `assignedValues[alias]` contains `box`.
* `const { box: alias } = holder` does not work because the equivalent-receiver calculation never traverses `assignedMemberPaths[alias] → holder.box → box`.
* `[alias] = holders` has the analogous missing projection through member `"0"`.

The committed round-fifteen test does contain the direct alias, nested function destructuring, assignment destructuring, `Function.prototype.call.call`/`apply.call`/`bind.call`, aliased `Reflect.apply`, and destructured `Reflect.apply` hostile/safe pairs. Those literal cases pass.   The imported-helper mediation cases also pass.  What is missing is their security-relevant composition: **destructure the receiver itself, write a property through that alias, then read through another equivalent receiver**.

I did not find this hostile construct in the reviewed production sources. The blocker is that the release gate claims fail-closed whole-program authority admission but demonstrably accepts a repository-local production source that can recover a privileged loader and invoke protected auth functionality outside the login route.

### Smallest adequate repair

The next implementation should:

1. Extend the shared canonical-value resolver so `assignedMemberPaths` participates in receiver equivalence, not only function-return lookup. Object shorthand members must resolve to their value symbols, and array member paths must resolve to their actual element expressions.
2. Feed that same canonical result into `propertySlot`, `valuesForReceiverMember`, actual mutation receivers, privileged-loader identity, mutable-export identity, private-authority taint, and invocation-vector expansion.
3. Add exact hostile and safe twins for object, nested object, array, nested array, and assignment-destructured receiver aliases, in both write/read directions and in same-file and imported-helper forms.
4. Regenerate the source patch, source CI, eight-head integration, final-head evidence, and all artifact hashes.

## Round-fifteen recheck

| Required area                                                                                           | Result        |
| ------------------------------------------------------------------------------------------------------- | ------------- |
| Direct property write through one ordinary assignment alias and read through another                    | Pass          |
| Nested destructuring of protected functions/members                                                     | Pass          |
| Assignment destructuring of protected functions/members                                                 | Pass          |
| `Function.prototype.call.call` mediation                                                                | Pass          |
| `Function.prototype.apply.call` mediation                                                               | Pass          |
| `Function.prototype.bind.call` mediation                                                                | Pass          |
| Aliased `Reflect.apply`                                                                                 | Pass          |
| Destructured `Reflect.apply`                                                                            | Pass          |
| Cross-file imported-helper paths followed by those forms                                                | Pass          |
| Safe local Function/Reflect lookalikes                                                                  | Pass          |
| `authRuntimeExportViolations` using the governed override program                                       | Pass          |
| **Receiver obtained by nested/assignment/array destructuring, with property write/read across aliases** | **Fail — P0** |

The specific “wrong program” repair is valid. `authRuntimeExportViolations` now obtains the auth source from either the complete production program or the production-configured override program and passes that same governed program to semantic analysis.

The cached language service uses the parsed production compiler configuration, resolves real transitive files through the production program or filesystem, increments the auth-source version on every override, and returns the updated language-service program. I independently confirmed that successive overrides produced distinct updated `Program` objects rather than stale reuse.

Production admission itself still starts with the complete governed production roots under the production compiler options and derives governed paths from that program.  No timeout increase, test skip, or coverage relaxation was introduced; the exact source and integration runs executed all 11 auth-boundary tests within the existing suite budget.

## Password-risk decision

**The password capability is materially contained, but the password remains potentially known and indefinitely reusable for reauthentication.**

A successful password login is converted through module-private, one-time `WeakMap` claims into a signed `method=password`, role `viewer`, thirty-minute cookie. The mint reads claims associated with the exact verifier-returned object, deletes them before minting, and ignores caller-visible fields. The signed method, role, actor, and expiry survive issuance; password cookies with a non-viewer role are rejected.

Password-session authorization is independently restricted to `dashboard.aggregate` and `session.logout`; every other permission returns `forbidden`, irrespective of the broader ordinary viewer-role permission list.

The aggregate query:

* validates an exact fixed Convex return object;
* reads only `payloadSafe=true` lead and voice-session rows;
* normalizes its `take` to `1..100`;
* returns counts and percentages, not records, emails, transcripts, voice detail, events, analytics buckets, or queues.

Next independently applies strict objects, finite nonnegative integer counts bounded by the normalized `take`, percentages in `[0,100]`, and parent/subset constraints for lead and voice-session populations.

The password is absent from bearer candidates. Runtime configuration also computes the password HMAC for the review, operations, and privacy bearer candidates and fails closed if any collide.  Successful-login telemetry contains only actor, credential method, role, and expiry—not the submitted credential, password HMAC, bearer token, cookie, or request body.

The remaining exposure is:

* disclosure of the permitted aggregate values and changes over time;
* repeatable bounded Convex computation during each session;
* the ability to log in again after thirty minutes.

The thirty-minute TTL limits individual-cookie lifetime; it does not restore password secrecy or revoke a person who knows it. That residual exposure is materially smaller than the historical raw-dashboard capability and falls within the owner’s stated acceptance.

## Other security and release controls

The following independently rechecked controls pass:

* **Route inventory and Next configuration:** the production program loads the effective Next configuration, governs effective `pageExtensions`, discovers matching App and Pages routes including `src`, groups, interception segments, and dynamic/catch-all forms, and pins each route to one exact method/permission map.
* **Route/export closure:** non-login admin handlers must be directly wrapped exported constants; default exports, export assignments, re-exports, CommonJS handlers, extra HTTP methods, and unexpected runtime values fail.
* **Auth export closure:** allowed `admin-auth.ts` runtime exports are pinned by exported name, declaration identity, and declaration kind; the private signer and bearer verifier are not effective exports.
* **One-time provenance:** spread, caller-visible mutation, structural forgery, proxying, symbol discovery, and replay cannot create valid mint claims.
* **Canonical release origin:** only the two exact canonical HTTPS root origins are admitted; userinfo, paths, queries, fragments, HTTP, compatibility hosts, and noncanonical ports fail before browser launch.
* **Hard-fail release E2E:** target, token, HMAC, password, and browser are mandatory; the wrapper rejects nonzero exit, malformed JSON, zero expected tests, or any skipped, flaky, or unexpected result.

These controls do not cure the P0 semantic admission false green.

## Artifact recomputation

All 12 requested artifacts match their manifest byte counts and SHA-256 values exactly:

| Artifact                                 |   Bytes | SHA-256                                                            |
| ---------------------------------------- | ------: | ------------------------------------------------------------------ |
| `oriental-admin-password-security.patch` | 335,865 | `49e6f1e4be2e4a3f37a91693af1f81aff711cdbf370e45c16b13071ff95080ee` |
| `github-evidence.json`                   |  70,747 | `b39dfe32381ee86132e2fea05db7bb82f347b30c68fc6b5945e8ce0e4a3e6701` |
| `integration-github-evidence.json`       |  68,757 | `6401b5594ed40968f32c7043212aaa5ce8b8338f7da3207c83ef072e7543c318` |
| `source-ci.log`                          |  71,533 | `2ea74ab9b3c3df172896d4664074d42c8049da4830076b4cdc5d687b2491f8ac` |
| `integration-ci.log`                     |  77,075 | `8b441d122f8e7bc98c79c79c24fc0bd05c142fbe2d484d411e9929a4603f5230` |
| `integration-merge-dag.txt`              |  50,852 | `4e44e2b60471cf57ebb7ba0ccb850d50b73a5a1ef4cbc163cc3af165f7cb8433` |
| `source-to-integration-overlap.diff`     |  33,276 | `b530dcb6ad0cb4c39ba20c0f9c6cae6d1595d1f7be0de8343fc203bbd45a5813` |
| `integration-vitest.json`                | 865,270 | `88dd1fc957985b95814153b6ae416870f34bbbedd174780cda275b944f421bf9` |
| `integration-audit.json`                 |     310 | `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c` |
| `round_13.md`                            |  17,593 | `71d8e05782d059a3c18f8681f08f6a328c8f153b08ff15fb1aebeacead30d43c` |
| `round_14.md`                            |  20,130 | `f4b9287c1a0cc39d59026093d37419952a8c954183822d5852f96ba76bdd67eb` |
| `round_15.md`                            |  22,528 | `c05dc3242c67eed9e6e97b71ba88d2f8deaed4fd38ab0b9ebd49e238e59a3d3c` |

The expected support-artifact values are stated in the manifest and agree byte-for-byte with the attached files.

I also independently recomputed the three final-head artifacts:

| Artifact                          |   Bytes | SHA-256                                                            |
| --------------------------------- | ------: | ------------------------------------------------------------------ |
| `final-head-github-evidence.json` | 139,845 | `ea4ddb806fb8c645642ec91983efe11ceec7d4528facb5e39d2857d0f664ed7b` |
| `final-head-ci.log`               |  71,531 | `2b52e772a13129593451b90c3a93dc100696a4d30615c96360bca9bf6d17e4a3` |
| `source-to-live-head.diff`        |  71,855 | `58dc2483cf9074c7334daa28710ab1eaa01de762dd98fb151fe6859445e3481b` |

## Exact CI and integration evidence

### Source implementation

The attached GitHub objects and raw CI log agree on:

* run `30419184268`;
* job/check `90472191528`;
* suite `82453420863`;
* event `pull_request`;
* head `5f47c982b1b26a4d3966d6337ff74cf7e88307b4`;
* checkout tree `206423b67ccb4446a8f6956851348eba9e2feddb`;
* completed conclusion `success`.

The source run completed warning-free lint on 284 files, strict application and Convex TypeScript, 85 test files and 2,222 tests, the Next.js 16.2.10 build, and mobile performance.  The exact implementation commit’s current GitHub check is also successful. ([GitHub][1])

### Synthetic eight-head integration

The attached integration objects and raw log agree on:

* commit `20cfb03cbca5735379322306a80e2304b6504554`;
* tree `4cb6f387cf6cd714f3df5d51cc6a3c1944636131`;
* run `30419337986`;
* job/check `90472658723`;
* suite `82453851243`;
* event `pull_request`;
* conclusion `success`.

The integration completed:

* frozen pnpm **10.34.5** installation;
* warning-free lint on **294 files**;
* strict TypeScript;
* zero audit findings across **378 dependencies**;
* **89 test files and 2,337 passed tests**, with zero failed or pending;
* Next.js **16.2.12** production build;
* LCP **1,392 ms**;
* CLS **0**;
* **444,009** transferred JavaScript bytes;
* **1,530,943** decoded JavaScript bytes;
* **15** initial JavaScript requests;
* zero serious or critical accessibility violations.

The DAG contains all eight requested exact heads as ancestors of that successful integration.  I also independently checked the current GitHub check page for each exact head; all eight report a successful `CI / verify` pull-request check. ([GitHub][2])

For precision, pnpm 10.34.5 is the frozen synthetic-integration toolchain. The reviewed source and its final evidence-only descendant ran the source branch’s pnpm 10.33.0 workflow; this is visible in their raw logs and should not be conflated with the composed integration run.

### Current final live PR head

As checked on **July 29, 2026**, PR #80 remains open with 40 commits, and its latest commit is the attached evidence-only head `7c97ab54c18d3d7521c9c2fd671f2c4aef9a3644`. ([GitHub][3])

The attached final evidence and raw log bind:

* head `7c97ab54c18d3d7521c9c2fd671f2c4aef9a3644`;
* tree `d68b90aa92489ba4fcce5486ef274d36a365085d`;
* run `30419862761`;
* job/check `90474251746`;
* suite `82455306124`;
* event `pull_request`;
* successful conclusion.

The checkout log prints that exact SHA and tree.  The current public run is likewise successful. ([GitHub][4])

The final commit has exactly one parent—the reviewed implementation commit—and changes exactly three files, all below `.apr/`: the evidence manifest, source-only patch, and APR workflow. Therefore, the attached source-to-live-head diff contains no non-APR descendant implementation change. ([GitHub][5])

## Mandatory post-merge gates remain pending

None of the following is completed by this pre-merge evidence:

1. Derive the password HMAC without logging either credential and materialize it in both governed Infisical scopes.
2. Reconcile and read back the complete managed Coolify environment, proving HMAC presence and plaintext-password absence.
3. Complete the Convex-first release sequence, then deploy the exact merge SHA to canonical staging.
4. From a clean cookie jar, require nonzero expected tests and zero skipped, flaky, unexpected, or failed tests proving password method/viewer/30-minute claims, aggregate-only access, raw/PII/transcript/voice/mutation `403`s, password bearer rejection, strong-token role retention, production cookie attributes, Redis store identity, shared remaining counts, and shared exhaustion.
5. Promote the identical SHA to production under the guarded release path and repeat managed-environment, authentication, health, exact-running-SHA, and rollback proof.

The launch evidence explicitly identifies these live secret, Redis, cookie, authorization, staging, and production checks as post-merge gates rather than completed source evidence.

Successful CI and exact artifact provenance do not override the reproduced authority-admission false green.

VERDICT: DO NOT MERGE

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/5f47c982b1b26a4d3966d6337ff74cf7e88307b4/checks "perf: reuse governed admin auth program · Biji-Biji-Initiative/oriental-website@5f47c98 · GitHub"
[2]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/7657afae19433f276c89967ca9f6c2a94a509fd9/checks "fix(voice): radial nebula fade + local test/dev-script portability · Biji-Biji-Initiative/oriental-website@7657afa · GitHub"
[3]: https://github.com/Biji-Biji-Initiative/oriental-website/pull/80/commits/7c97ab54c18d3d7521c9c2fd671f2c4aef9a3644 "fix(auth): manage interactive admin password by lifeofgurpreet · Pull Request #80 · Biji-Biji-Initiative/oriental-website · GitHub"
[4]: https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30419862761 "fix(auth): manage interactive admin password · Biji-Biji-Initiative/oriental-website@7c97ab5 · GitHub"
[5]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/7c97ab54c18d3d7521c9c2fd671f2c4aef9a3644 "docs: bind round 16 admin auth evidence · Biji-Biji-Initiative/oriental-website@7c97ab5 · GitHub"
