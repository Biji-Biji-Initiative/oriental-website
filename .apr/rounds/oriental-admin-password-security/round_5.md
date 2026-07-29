## Overall assessment

The proposed authority split is **defensible in principle**: a potentially known password can be retained as a low-authority convenience credential when the server cryptographically records `method=password`, forces `role=viewer`, limits the session to thirty minutes, and authorizes only aggregate operational metrics plus logout. In the current ordinary execution path, the password does not directly grant customer-data access or mutations.

The exact tree nevertheless fails several explicit round-four requirements. The most serious failures are the forgeable session-mint provenance, the non-validating aggregate DTO boundary, and false-green AST governance.

## Release blockers

### 1. The session-mint proof is copyable and forgeable, not runtime-unforgeable

**Affected source:** `lib/server/admin-auth.ts`, patch lines 1176, 1191–1195, 1203–1227, and 1232–1259.
**Insufficient test:** `tests/admin-auth.test.ts`, patch lines 2199–2213.

`verifiedAdminLoginProof` is a module-private `Symbol`, but the proof is placed directly on the object returned to the caller:

```ts
[verifiedAdminLoginProof]: true
```

That symbol property is enumerable. Object spread copies enumerable symbol properties. Therefore, after a valid password verification, a caller can relabel the verified password result as a review-token result:

```ts
const verified = verifyAdminLoginCredential(password);
if (!verified.ok) throw new Error("unexpected");

const forged = {
  ...verified,
  credential: "review_bearer",
  role: "admin",
};

createAdminLoginSession(forged as never, Date.now());
```

The copied proof passes `identity[verifiedAdminLoginProof] === true`. Because the forged credential is now `review_bearer`, the password-specific viewer check is skipped. The mint function consequently creates a twelve-hour, `method=review`, `role=admin` session.

A caller can also discover the symbol with `Object.getOwnPropertySymbols`, or satisfy an unknown symbol read using a `Proxy`. A module-private symbol name is therefore not a runtime security brand.

The current login route does not perform this relabeling, so this is not a demonstrated remote exploit through the supplied route. It is still an explicit contract violation, and the hostile test gives false confidence because it tests only a plain object with no copied proof.

**Required remediation:** bind the verified claims to the exact returned object using a module-private `WeakMap` or `WeakSet`, and have the mint function retrieve canonical claims from that private store rather than trusting caller-visible fields. Prefer one-time consumption. An even stronger design keeps minting private and exposes one combined verify-and-mint operation. Add hostile tests for spread-copying, mutation of the original result, symbol extraction, and a `Proxy`.

---

### 2. The aggregate boundary is key-projected, but it is not a fixed runtime numeric DTO

**Affected source:**

* `convex/leads.ts`, patch lines 821–841 and 905–928.
* `lib/server/convex.ts`, patch lines 1447–1482.
* `app/api/admin/metrics/route.ts`, patch lines 522–529.
* `tests/convex.test.ts`, patch lines 2758–2791.

The Next adapter explicitly selects known property names, which correctly strips extra top-level fields. It does **not**, however, validate the runtime type of any selected property.

For example, a mismatched or accidentally widened Convex deployment could return:

```ts
{
  metrics: {
    recentLeads: { email: "must-not-cross@example.com" },
    // other expected keys
  }
}
```

`getAdminAggregateMetrics` would copy that object into `data.metrics.recentLeads`, and `/api/admin/metrics` would serialize it. The same applies to `generatedAt` and every other allowed key.

The TypeScript type does not pin the contract independently:

```ts
export type AdminAggregateMetricsData =
  Extract<Awaited<ReturnType<typeof getAdminAggregateMetrics>>, { ok: true }>["data"];
```

It is derived from the implementation itself. If the implementation widens, the type widens with it. The Convex query also supplies no explicit runtime return validator. The test proves only that additional keys are stripped; it does not inject objects, strings, missing values, `NaN`, infinities, or out-of-range rates into allowed fields.

There is a second contract discrepancy. The evidence says the password path cannot “materialize” customer records, but `adminAggregateMetrics` loads full `Doc<"leads">[]` and `Doc<"voiceSessions">[]` objects through two `.take(take)` calls before calculating totals. Raw rows do not cross the Convex-to-Next boundary, which is valuable, but they are materialized inside the password-triggered Convex execution. Under the literal specification, that is not the claimed no-materialization design.

**Required remediation:**

* Add an explicit Convex return validator, or equivalent strict runtime assertion, for `generatedAt` and every numeric metric.
* Add a strict Next-side runtime schema. Counts should be finite nonnegative safe integers; percentages should be finite and constrained to `0–100`; unknown keys should be rejected or stripped.
* Add hostile tests that substitute raw objects into each allowed key, omit required fields, and return invalid numbers.
* Either compute from pre-aggregated counters so raw documents are not materialized on this path, or narrow the approved contract and evidence to the accurate boundary: raw records are processed only inside trusted Convex execution and never returned to Next or the password principal.

---

### 3. The exact route map has concrete false-green re-export, login, and CommonJS forms

**Affected test:** `tests/admin-auth-boundary.test.ts`, especially patch lines 1642–1745, 1831–1841, 1992–2045.

The current route implementations use the expected direct wrapper and literal permissions. The governance analyzer does not, however, reject every required hostile form.

#### Star re-exports are invisible

`exportedHttpBindings` handles only export declarations with a `NamedExports` clause:

```ts
if (
  ts.isExportDeclaration(statement) &&
  statement.exportClause &&
  ts.isNamedExports(statement.exportClause)
)
```

A route containing one valid handler plus:

```ts
export * from "./unguarded-handlers";
```

can re-export an unguarded `POST`, `DELETE`, `HEAD`, or other handler without being counted. The protected-route analyzer and the login analyzer would both accept the canonical visible handler and miss the additional re-export. This directly violates the requirement to reject re-exported handlers.

#### A default-exported login `POST` is accepted

`analyzeLoginRoute` checks that the discovered declaration is a function named `POST`, but it does not reject the `DefaultKeyword`. Consequently:

```ts
export default async function POST() {
  return new Response();
}
```

satisfies the analyzer even though it does not provide the required canonical named `POST` export.

#### CommonJS coverage is syntax-specific rather than fail-closed

The analyzer recognizes direct `=` assignments and one precise `Object.assign` shape. It misses forms such as:

```ts
Object.defineProperty(module.exports, "DELETE", { value: handler });
exports.HEAD ??= handler;
module["exports"].POST ||= handler;
Reflect.set(exports, "OPTIONS", handler);
```

A file can retain one valid wrapped ESM handler while adding one of these invisible extra handlers.

The hostile fixture matrix also runs the negative forms only through a generic `.ts` fixture. The per-extension loop tests only the accepted form, not the required rejected forms.

**Required remediation:** use the TypeScript checker’s actual module export symbol table to enumerate effective exports, including star and namespace re-exports. Conservatively reject every export declaration in route modules other than the exact permitted direct declarations. Reject all CommonJS export mechanisms rather than attempting to enumerate a few spellings. Require the login handler to be a non-default named function declaration. Run the full hostile matrix against every supported extension.

---

### 4. The claimed complete-runtime authority scan is a directory allowlist, not a complete resolved runtime graph

**Affected test:** `tests/admin-auth-boundary.test.ts`, patch lines 1579–1588, 1593–1613, 1855–1953, and 2048–2062.

`productionPaths` is assembled from a fixed directory list:

```ts
{app,components,convex,lib,pages,scripts,src}/**/*
```

plus root-level files. The parsed `tsconfig` is used only for individual module resolution. Its complete file list is not used, and no dependency graph is traversed.

A production module under an unlisted directory such as `runtime-helpers/auth-bridge.ts` can be imported by `app`, import or re-export `createAdminLoginSession`, and invoke it. The scanned `app` file resolves only to the bridge, not directly to `admin-auth.ts`; the bridge itself is absent from `productionPaths`. The asserted one-import/one-call authority remains green.

The route inventory similarly covers only `app/api/admin/**/route.*`. A legacy `pages/api/admin/...` entrypoint is not part of the canonical method/permission map, even though `pages` is acknowledged as production source. Such a handler would not need to touch the protected login symbols to expose raw data.

The privacy proof for `verifyAdminBearerToken` is also incomplete. It checks only whether the function declaration itself has an `export` modifier. This would miss:

```ts
export { verifyAdminBearerToken };
```

The private session signer is not checked against the module’s effective exports at all.

This weakness is especially significant because `viewer` is **not intrinsically aggregate-only**. In `lib/admin-permissions.ts`, viewer retains `dashboard.read`, `leads.read`, and `voice.read`; the aggregate-only restriction exists as an extra credential conditional inside `verifyAdminPermission`. Any ungoverned authorization path that checks only the viewer role or session validity can bypass the intended step-up boundary.

**Required remediation:**

* Build a real TypeScript `Program` and traverse all non-test runtime files reachable from Next, Convex, and production script entrypoints.
* Include all active App Router and Pages Router handler surfaces in the canonical route inventory.
* Compare actual resolved symbols and references, not only direct identifier call syntax.
* Inspect the effective export table of `admin-auth.ts` to prove the bearer verifier and signer are absent, including named export lists and CommonJS forms.
* Consider representing password sessions as a distinct principal whose permission table intrinsically contains only `dashboard.aggregate` and `session.logout`, instead of relying on an exception layered over a broadly capable viewer role.
* Add a hostile fixture containing an imported module under an otherwise unlisted top-level directory.

---

### 5. The technical specification claims an unproven live runtime fact

**Affected documentation:** `docs/02-TECHNICAL-SPEC.md`, patch lines 954–969.

The document says the plaintext password:

> “is absent from the current tree and runtime configuration”

The launch checklist and release evidence correctly leave runtime materialization, reconciliation, plaintext-alias absence, and live readback pending. The technical specification therefore contradicts the release state and violates the explicit requirement not to claim unproven live facts.

**Required remediation:** change this to a normative and pending statement, for example: plaintext must be absent from runtime configuration, and that absence remains unverified until the governed staging and production readback is completed.

---

### 6. The collision test does not explicitly prove every bearer plane fails under every collision

**Affected test:** `tests/admin-auth.test.ts`, patch lines 2255–2285.

For each password/bearer collision, the test requests only the bearer that is also the collision candidate. It does not prove the cross-product:

* review-token collision × review, ops, and privacy bearer requests;
* ops-token collision × review, ops, and privacy bearer requests;
* privacy-token collision × review, ops, and privacy bearer requests.

It also does not assert that ordinary review-token login fails under an ops- or privacy-password collision. The current implementation uses one global `passwordBearerCollision` flag and appears correct, but a later regression that left non-colliding bearer planes active could pass this test despite its title claiming every auth plane fails.

**Required remediation:** nest the collision candidate loop and the requested bearer loop, and assert review-token login, all three bearer principals, both pre-existing session methods, and password login return `unconfigured` for every collision candidate.

The other requested negative tests are explicit:

* token rotation rejects the stale password HMAC and both session methods, then permits deliberate co-rotation;
* invalid `Authorization` prevents fallback to a valid cookie;
* spoofed earlier forwarding hops do not change the rate-limit identity, while distinct proxy-owned identities remain independent.

## Confirmed source closures

The two broad-dashboard blockers are closed in the current implementation:

* `app/admin/session-review/page.tsx` branches on `password_session` and returns the aggregate dashboard before the broad dashboard and lead-table `Promise.all`.
* `app/api/admin/metrics/route.ts` invokes only `getAdminAggregateMetrics`.
* `lib/server/convex.ts` calls only `api.leads.adminAggregateMetrics` and explicitly omits additional top-level fields.
* `tests/admin-password-dashboard.test.tsx` makes broad dashboard and lead-table mocks throw if reached and verifies that raw review returns `403`.

The normal cookie path also signs version, expiry, actor, role, and method; forces password sessions to viewer; assigns the thirty-minute TTL; rejects password use as bearer authentication; and uses the review token, not the password or password HMAC, as the session-signing key.

These closures do not cure the provenance and governance defects above.

## CI, integration, and release evidence

The supplied manifest consistently records:

* GitHub `verify` success on exact implementation SHA `36d7a40ebfb81d8a1018ba69de10bae410f253ba`.
* Synthetic integration commit `22d9d905bab9ac93095c1e24ac6c062ae9cf97da`.
* Lint on 292 files, strict TypeScript, zero production-audit findings, all 89 test files and 2,278 tests, and the Next.js 16.2.12 production build.

There is no conflicting SHA or test count in the supplied evidence. Those successful runs demonstrate build and test execution, but the false-green controls identified above mean they do not establish the required security properties.

Any correction changes the implementation SHA, so both exact-head GitHub CI and the combined eight-PR integration must be rerun. Exact merge-SHA deployment to canonical staging, live reduced-session proof, password-as-bearer rejection, the complete raw-route `403` matrix, Redis/proxy identity verification, and guarded identical-SHA production promotion remain mandatory. None is satisfied by the source evidence alone.

## Risk decision

The design **materially reduces confidentiality and integrity risk** only if the aggregate metrics are deliberately treated as public-equivalent operational information to anyone who may know the historical password. The password cannot be made secret again merely by storing a keyed HMAC. Thirty-minute expiry also does not prevent continued access because a holder can simply authenticate again.

Even after the source blockers are fixed, the owner is accepting exposure of the permitted aggregate values and their changes over time. The aggregate endpoint is dynamic and has no demonstrated post-login request rate limit or cache, so a known-password holder can also repeatedly trigger the bounded Convex scans. That residual confidentiality, inference, availability, and cost exposure should be explicit in the production acceptance.

For this exact tree, the aggregate response path is narrower than the former dashboard, but the required security proof is not sound enough to admit release.

VERDICT: DO NOT MERGE


22m10s · gpt-5.6-sol[browser] · ↑48.51k ↓4.06k ↻0 Δ52.57k
files=3
Saved assistant output to /home/ubuntu/work/oriental-pr80-apr-round5-20260728/.apr/rounds/oriental-admin-password-security/round_5.md

22m10s · gpt-5.6-sol[browser] · ↑48.51k ↓4.06k ↻0 Δ52.57k | files=3 | slug=apr-oriental-admin-password-security-5
