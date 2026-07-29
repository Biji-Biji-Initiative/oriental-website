# Decision

**Do not merge commit `4e61d8de8caf00520d72a0bcbf14c015b4e40a85`, tree `8c8c5571f5753c032735dff1d78b3e28417e45d0`.**

The signed `method=password`, viewer-only, thirty-minute capability **does materially contain the potentially known password** to the owner-accepted residual exposure: repeatable access to a bounded, PII-free aggregate metrics DTO and logout. It does not restore the password’s secrecy, and a holder can reauthenticate after expiry, but the password cannot act as a bearer credential, signing key, raw-data principal, analytics/queue principal, or mutation principal.

The source patch, artifact digests, exact source CI, eight-head integration CI, individual PR-head checks, and final evidence-only live head are internally consistent and successful. The reviewed 352,960-byte source-only patch recomputes to the declared SHA-256 and represents the stated implementation identity.

However, the mandatory whole-program authority-admission proof still has a reproducible P0 false green. The round-sixteen repair joins destructured receiver identities when the holder is a literal or ordinary symbol, but **not when the destructuring root is a call expression returning that holder**. Combining the round-sixteen receiver alias with the already-governed function-return, Function/Reflect mediation, dynamic-vector, and cross-file paths bypasses the checker.

## P0 — A holder returned by a call disconnects its destructured receiver

I extracted and executed the exact analyzer from the attached patch against this production-shaped hostile source:

```ts
const box: any = {};
const getHolder = () => ({ box });
const { box: alias } = getHolder();

alias.get = () => module;

const M = box.get();
const req = Reflect.get(M, "require").bind(M) as NodeRequire;
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);
```

The exact result was:

```text
imports = []
calls = []
forbiddenAccesses = []
```

Changing only the assigned value to a harmless lookalike also returned an empty violation set:

```ts
alias.get = () => ({
  require: () => ({ safe: true }),
});
```

Thus the required differential is absent:

* hostile source: admitted;
* safe twin: admitted.

Reversing the data flow is also falsely admitted:

```ts
box.get = () => module;
const M = alias.get();
```

A direct runtime proof confirmed that this is not merely an AST resemblance:

```json
{"sameReceiver":true,"loadedBuiltin":true}
```

The destructured alias is the original receiver, and the recovered `module.require` successfully loaded a Node built-in.

### Reproduction matrix

The literal cases introduced for round sixteen work correctly. I reran 19 direct hostile/safe pairs covering object, nested-object, assignment, array, nested-array, array-assignment and array-extracted function forms in both directions, plus `call.call`, `apply.call`, `bind.call`, aliased `Reflect.apply`, and destructured `Reflect.apply`. Every hostile direct case produced six violations and every safe twin produced zero.

The failure appears when those same dimensions are composed with a holder-returning call:

| Composition                                                                          | Hostile result | Safe result |
| ------------------------------------------------------------------------------------ | -------------: | ----------: |
| Same-file `getHolder()`; both directions                                             |   0 violations |           0 |
| `Function.prototype.call.call(getHolder, …)`; both directions                        |              0 |           0 |
| `Function.prototype.apply.call(getHolder, …)`; both directions                       |              0 |           0 |
| `Function.prototype.bind.call(getHolder, …)()`; both directions                      |              0 |           0 |
| Aliased `Reflect.apply`; both directions                                             |              0 |           0 |
| Destructured `Reflect.apply`; both directions                                        |              0 |           0 |
| Array holder returned by call, with extracted assigned function; both directions     |              0 |           0 |
| Cross-file imported `getHolder`, all six invocation forms and both directions        |              0 |           0 |
| Auth-export/private-taint/dynamic-vector variants, all six forms and both directions |           `[]` |        `[]` |

The committed tests prove the direct literal receiver cases, direct Function/Reflect forms, and their safe twins.   They also prove direct cross-file imported receivers and holders.  The missing case is the security-relevant composition: an imported or local function returns the holder, that result is destructured, and a property is written and read through the two equivalent receivers.

### The gap reaches more than loader admission

I injected this shape into the exact `authRuntimeExportViolations` differential:

```ts
const result: Record<string, unknown> = {};
const box: any = {};
const getHolder = () => ({ box });
const { box: alias } = getHolder();

alias.get = () => [result, "signer", sign];
const args = box.get();

Reflect.apply(Reflect.set, null, args);
return result as unknown as string;
```

The hostile form returned `[]`. The safe twin replacing `sign` with a harmless string also returned `[]`.

The direct-literal holder equivalent correctly reports:

```text
allowed auth export clearAdminCookieHeader cannot return private authority or claims state
```

Therefore, this is not confined to CommonJS syntax. It propagates into:

* allowed-export mutation and return analysis;
* private-authority taint;
* actual mutation-receiver resolution;
* dynamic invocation vectors;
* Function/Reflect-mediated calls;
* imported-helper return paths.

The committed auth differential suite contains the literal receiver forms and direct Function/Reflect mediation.  The call-returned-holder composition is absent.

### Root cause

The new shared graph correctly adds:

* declaration initializers and assigned values;
* object-literal shorthand values;
* numeric array elements;
* `assignedMemberPaths`;
* checker-resolved properties;
* later property writes.

It also correctly consumes `assignedMemberPaths` while finding equivalent symbols.

But `memberPathValueSymbols` first examines only direct object- or array-literal members and then calls `symbolAt(expression)`. A call expression is neither a direct literal nor an expression shape for which `symbolAt` returns a value symbol, so it falls through with an empty set. `equivalentValueSymbols` has the same symbol-only terminal behavior.

Property slots, property-write indexing, and property-value reads all consume that incomplete equivalent-symbol result.  Consequently:

1. `alias.get = …` is indexed only under `alias`;
2. `box.get()` reads only from `box`;
3. the graph never learns that `getHolder().box`, `alias`, and `box` are the same receiver.

The code does maintain a separate semantic function-return graph, including a separate destructuring path for resolving function-like values.  But that return graph is not consumed by the canonical receiver projection at the point where property writes are indexed. This is exactly the syntax-dependent split the review requirement says to reject.

Corroborating probes also falsely admitted:

* a holder returned by an object method;
* an array holder returned by a helper function;
* a spread-built array holder;
* destructuring through a constant computed property name.

The call-returned holder alone is sufficient to block release.

### Smallest adequate repair

The repair must be in the shared value graph, not as another loader-specific call-expression special case:

1. Make member-path projection traverse semantic return values of an expression before property-write indexing, including ordinary calls, mediated Function calls, `Reflect.apply`, and imported declarations.
2. Represent those return edges in the same canonical receiver graph consumed by property slots, return summaries, mutable-export identity, private taint, actual receivers, and dynamic vectors.
3. Preserve cycle guards across symbol, expression, return, and member-path traversal.
4. Add hostile/safe twins for direct call, `call.call`, `apply.call`, `bind.call`, aliased/destructured `Reflect.apply`, and imported helpers, in both write/read directions and for object and array holders.
5. Add equivalent auth-source differentials demonstrating private `sign`/claims taint and dynamic-vector mutation.
6. Regenerate the exact patch, source CI, eight-head integration, final-head evidence, and all digests.

## Password-risk decision

The runtime capability remains a material reduction from the historically exposed universal password.

The password:

* is accepted only by the same-origin, rate-limited login;
* mints a signed `method=password`, role `viewer` cookie for thirty minutes;
* is authorized only for `dashboard.aggregate` and `session.logout`;
* is rejected by every bearer path;
* never signs a session and is not the session-signing key;
* cannot read raw leads, email addresses, transcripts, voice evidence, analytics buckets, event data, queues, or customer records;
* cannot mutate, assign, archive, follow up, run evaluations, execute retention/SLA work, or delete privacy data.

The session mint consumes module-private `WeakMap` claims from the exact verifier-returned object, deletes those claims before minting, and forces the password role and method rather than trusting caller-visible fields.  Cookie verification signs and validates method, role, actor, expiry, and version, and password sessions are independently forbidden from every permission except aggregate metrics and logout.

The aggregate adapter normalizes the query take to at most 100 and applies a strict Next-side schema:

* exact top-level and metrics objects;
* finite, nonnegative integer counts;
* every count bounded by the normalized take;
* percentages in `[0,100]`;
* lead subsets bounded by `recentLeads`;
* voice subsets bounded by `reviewedSessions`.

The residual exposure is still real: a person who knows the historical password can reauthenticate after each thirty-minute expiry and observe aggregate values and their changes over time. The TTL limits cookie lifetime, not password reuse. That residual exposure is materially smaller than raw dashboard or mutation authority and is within the owner’s stated acceptance. The P0 blocker is the unsound release admission proof, not the intended password capability itself.

## Other required controls

| Control                                                                     | Result        |
| --------------------------------------------------------------------------- | ------------- |
| Complete governed production program                                        | Pass          |
| Auth override uses production compiler configuration and transitive imports | Pass          |
| One governed language-service program per override                          | Pass          |
| Auth-source-scoped assignment index shared by auth analyses                 | Pass          |
| Standalone no-resolve program remains removed                               | Pass          |
| Existing timeout retained; no skipped coverage                              | Pass          |
| Direct round-16 hostile/safe receiver forms                                 | Pass          |
| Round-15 Function/Reflect direct mediation                                  | Pass          |
| Aggregate DTO and subset bounds                                             | Pass          |
| Effective Next `loadConfig`/`pageExtensions` governance                     | Pass          |
| Route and runtime-export closure                                            | Pass          |
| One-time private mint claims                                                | Pass          |
| Password/bearer collision cross-products                                    | Pass          |
| Canonical HTTPS root-origin rejection                                       | Pass          |
| Hard-fail E2E and zero-skipped reporting                                    | Pass          |
| Bounded login telemetry                                                     | Pass          |
| **Whole-program authority admission under composed semantic paths**         | **Fail — P0** |

The production program is still rooted in the parsed TypeScript configuration plus all governed production source extensions and is created under the production compiler options.

The cached auth-source language service uses the production compiler configuration, takes non-overridden snapshots from the real production program or filesystem, and increments the auth source version for each override.  `authRuntimeExportViolations` now obtains its source from that governed program and passes the same program into the auth-source-scoped semantic analysis.  This correctly closes the round-fifteen wrong-program defect, but does not close the new call-root member projection gap.

The release origin guard admits only the two exact canonical HTTPS root origins.  The release wrapper requires all secrets and browser configuration, valid JSON output, a nonzero expected-test count, and exactly zero skipped, flaky, or unexpected tests.

## Artifact recomputation

All 13 requested files match the manifest exactly:

| Artifact                                 |   Bytes | SHA-256                                                            |
| ---------------------------------------- | ------: | ------------------------------------------------------------------ |
| `oriental-admin-password-security.patch` | 352,960 | `33e18c3401f210aef0501f58b818d5c2396ef9ac7a9b1241379844e7e95c5042` |
| `github-evidence.json`                   |  92,323 | `d7ec26cd24401449de92ba6c9a517c7853daa7c3099b56c8bfd21abfc2d18dba` |
| `integration-github-evidence.json`       | 186,434 | `b037c3efc192017d9988a63637ff478f5cea7ed218febe12fc4c4e4281851576` |
| `source-ci.log`                          |  71,534 | `9df33d595f3f90e5df0439d379f2d24386665b4091442f0e45f782a2dd3a49e2` |
| `integration-ci.log`                     |  76,886 | `be26c201246426f34719d3b2bf99b867f88d916c868959e21919f340b000fac9` |
| `integration-merge-dag.txt`              |  48,146 | `fd9aef01a2cf765577e0dc2b2c2804d7860b2c1eb5056ac85c02c0daaf6bcc00` |
| `source-to-integration-overlap.diff`     |  33,276 | `b530dcb6ad0cb4c39ba20c0f9c6cae6d1595d1f7be0de8343fc203bbd45a5813` |
| `integration-vitest.json`                | 865,335 | `79de8713efc71652bfbf12bbf011acbfd77d293b1860f2214efdf826d93598c0` |
| `integration-audit.json`                 |     310 | `e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c` |
| `round_13.md`                            |  17,593 | `71d8e05782d059a3c18f8681f08f6a328c8f153b08ff15fb1aebeacead30d43c` |
| `round_14.md`                            |  20,130 | `f4b9287c1a0cc39d59026093d37419952a8c954183822d5852f96ba76bdd67eb` |
| `round_15.md`                            |  22,528 | `c05dc3242c67eed9e6e97b71ba88d2f8deaed4fd38ab0b9ebd49e238e59a3d3c` |
| `round_16.md`                            |  19,684 | `e14414002d6d9b0421ee925a37d0ded41277ae99ab0ac390b64bc4ea30c43a45` |

The manifest’s support-artifact ledger agrees with those recomputed bytes and digests.

I also independently recomputed the three final-head artifacts:

| Artifact                          |   Bytes | SHA-256                                                            |
| --------------------------------- | ------: | ------------------------------------------------------------------ |
| `final-head-github-evidence.json` | 120,324 | `9b18230385bdca297b5311bb8fc2f4b1b86125cef24fe3050d9b46a3cf9dae6f` |
| `final-head-ci.log`               |  71,115 | `712b66d31cd360991ba7299b5150f530933bf7aeced28dfe87b2a3c84a62c3a6` |
| `source-to-live-head.diff`        |  52,763 | `4ff65c81aac5e460e61eecc506f44190ef5bc9072f53fd727923c3c225833a94` |

The one-line `integration-vitest.json` intentionally has no terminal newline; its raw byte count and digest above are exact.

## Exact source CI

The attached source GitHub objects and raw log agree on:

* run `30424510554`;
* job/check `90487908020`;
* suite `82467831487`;
* event `pull_request`;
* SHA `4e61d8de8caf00520d72a0bcbf14c015b4e40a85`;
* tree `8c8c5571f5753c032735dff1d78b3e28417e45d0`;
* conclusion `success`.

The source run completed warning-free lint on 284 branch files, strict application and Convex TypeScript, 85 test files and 2,222 tests, the mandatory missing-configuration release-proof guard, the Next.js 16.2.10 build, and mobile performance.

For precision, the source branch workflow used pnpm **10.33.0**. The frozen pnpm **10.34.5** claim applies to the synthetic integration run below; the two should not be conflated.

## Exact eight-head integration

The attached integration evidence agrees on:

* run `30424542369`;
* job/check `90488000700`;
* suite `82467915381`;
* event `pull_request`;
* commit `f32e396c08dd909534cbf08894308e4672ee070b`;
* tree `93e6a4e898865ace935b596405260471d7690ea8`;
* conclusion `success`.

The integration contains the exact heads of PRs #78 through #85, including reviewed head `4e61d8de8caf00520d72a0bcbf14c015b4e40a85`, and completed:

* frozen pnpm **10.34.5**;
* warning-free lint on **294 files**;
* strict TypeScript;
* zero audit findings across **378 dependencies**;
* **89 test files and 2,337 passed tests**, with zero failed or pending;
* Next.js **16.2.12** production build;
* mobile LCP **1,344 ms**;
* CLS **0**;
* **444,011** transferred JavaScript bytes;
* **1,530,943** decoded JavaScript bytes;
* **15** initial JavaScript requests;
* zero serious or critical accessibility violations.

I independently rechecked the public exact-head check pages for all eight constituent heads; each reports a successful pull-request `CI / verify` job. ([GitHub][1])

## Final live PR head

At the time of this review on **July 29, 2026**, PR #80 is open with 43 commits. Its latest implementation/evidence pair is `4e61d8d` followed by `a7d4723`. ([GitHub][2])

The attached final-head evidence binds:

* live head `a7d472379d854fd98ea268fd4da6638c6458a69c`;
* tree `b50138d25caa983b5691fe30cf194d9dd9d11b5a`;
* run `30425042719`;
* job/check `90489559746`;
* suite `82469266097`;
* event `pull_request`;
* conclusion `success`.

The public GitHub run also reports success. ([GitHub][3]) The final commit has exactly one parent—the reviewed implementation commit—and changes exactly three files, all below `.apr/`: the evidence manifest, source-only patch, and APR workflow. ([GitHub][4]) The attached `source-to-live-head.diff` likewise contains no non-APR descendant implementation change.

The final-head CI completed mobile performance with LCP 952 ms, CLS 0, 436,200 transferred JavaScript bytes, 1,506,994 decoded JavaScript bytes, 14 initial JavaScript requests, and zero serious or critical accessibility violations.

## Mandatory post-merge gates remain pending

The pre-merge evidence does **not** establish any of the following:

1. Managed derivation, staging/production Infisical write, reconciliation, and redacted readback of `ADMIN_REVIEW_PASSWORD_HMAC`.
2. Exact-merge-SHA deployment to canonical staging after the required Convex-first release ordering.
3. Clean-cookie live proof of password method, viewer role, thirty-minute TTL, aggregate-only access, and `403` responses from raw lead, review, transcript/voice, analytics/queue, and mutation routes.
4. Password rejection as bearer and strong review-token role/TTL behavior in the live environment.
5. Redis store identity, shared remaining-count behavior, and shared ninth-attempt exhaustion.
6. Guarded promotion of the identical tested SHA to production, followed by repeated managed-environment, authentication, health, exact-running-SHA, and rollback proof.

The evidence explicitly marks those secret, live-authentication, Redis, staging, and production checks as mandatory post-merge gates rather than completed results.

Successful CI, correct artifact provenance, and a materially contained password capability do not override the reproduced semantic false green in the mandatory authority-admission gate.

VERDICT: DO NOT MERGE

[1]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/7657afae19433f276c89967ca9f6c2a94a509fd9/checks?utm_source=chatgpt.com "fix(voice): radial nebula fade + local test/dev-script portability · Biji-Biji-Initiative/oriental-website@7657afa · GitHub"
[2]: https://github.com/Biji-Biji-Initiative/oriental-website/pull/80 "fix(auth): manage interactive admin password by lifeofgurpreet · Pull Request #80 · Biji-Biji-Initiative/oriental-website · GitHub"
[3]: https://github.com/Biji-Biji-Initiative/oriental-website/actions/runs/30425042719 "fix(auth): manage interactive admin password · Biji-Biji-Initiative/oriental-website@a7d4723 · GitHub"
[4]: https://github.com/Biji-Biji-Initiative/oriental-website/commit/a7d472379d854fd98ea268fd4da6638c6458a69c "docs: bind round 17 admin auth evidence · Biji-Biji-Initiative/oriental-website@a7d4723 · GitHub"
