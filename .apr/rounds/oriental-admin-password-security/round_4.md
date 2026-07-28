## Decision

The architecture is directionally defensible **only if the reaffirmed password is treated as a potentially public, low-trust capability**, not as meaningful authentication. Signing `method=password`, forcing `viewer`, and limiting each cookie to thirty minutes can contain confidentiality and integrity risk when the password path is structurally incapable of reaching anything except an aggregate-only data service and logout.

The current tree does not establish that boundary. It has three source-level false-green paths, a data-minimization violation, overstated negative-test evidence, and missing mandatory admission runs.

## Release blockers

### 1. Password requests still materialize the broad, PII-bearing dashboard result

The password-rendered page calls `getAdminReviewDashboard(100)` and then projects `aggregate.data.metrics`:

* `app/admin/session-review/page.tsx`, patch lines 106–121.

The same file establishes that this result type also contains `leads`, `voiceSessions`, and `leadEvents`:

* `app/admin/session-review/page.tsx`, patch lines 96–101.

The aggregate API repeats the same pattern with `getAdminReviewDashboard(75)`:

* `app/api/admin/metrics/route.ts`, patch lines 501–504.

The new test makes the limitation explicit: it mocks `getAdminReviewDashboard` returning a `rawSentinel`, then proves only that the sentinel is not rendered and that the separate `getAdminLeadTable` function is not called:

* `tests/admin-password-dashboard.test.tsx`, patch lines 2134–2140 and 2149–2157.

That is response filtering, not a closed data-access boundary. A request authenticated by the potentially known password still causes the broad dashboard object—including data that requires managed-token step-up—to be returned into the Next.js process. Accidental serialization, tracing, exception capture, or a later projection error could expose it.

Replace this with a dedicated `getAdminAggregateMetrics` path whose Convex-to-Next return type is a fixed aggregate DTO and cannot contain leads, email addresses, voice-session detail, events, analytics buckets, or queues. The database-side aggregate query may inspect records internally, but the raw object must never cross into the password-authorized web execution path. Tests should make `getAdminReviewDashboard` and all raw-table functions throw if invoked during password-page or metrics requests.

### 2. The structural route analyzer admits unwrapped HTTP handlers

`analyzeProtectedRoute` examines exported variable declarations but never requires the declaration list to be `const` and never checks later assignments:

* `tests/admin-auth-boundary.test.ts`, patch lines 1463–1491.

This passes with no analyzer errors:

```ts
import { withAdminPermission as guard } from "@/lib/server/admin-route";

export let GET = guard("dashboard.read", async () => new Response("protected"));
GET = async () => new Response("unguarded");
```

The analyzer also skips every exported declaration whose binding name is not a simple identifier. Therefore a module containing one valid wrapped method can add an unwrapped destructured method without detection:

```ts
export const POST = guard("dashboard.read", async () => new Response());

const handlers = { GET: async () => new Response("unguarded") };
export const { GET } = handlers;
```

The login-route exception is independently incomplete. `exportedHttpHandlers` recognizes only exported function declarations:

* `tests/admin-auth-boundary.test.ts`, patch lines 1417–1425.

The login assertion then requires that limited result to equal `["POST"]`:

* `tests/admin-auth-boundary.test.ts`, patch lines 1595–1597.

Consequently, the login module could add an unprotected `export const GET`, `DELETE`, or `OPTIONS`, and the test would still report only the existing function-declaration `POST`.

The analyzer must:

* Require `NodeFlags.Const`.
* Reject every HTTP binding found recursively in object or array binding patterns.
* Enumerate assignments and reject mutation of exported HTTP bindings.
* Apply one exhaustive HTTP-export enumerator to the login route and require exactly one `POST` and no other method in any export form.
* Add hostile fixtures for `let` reassignment, destructuring, extra login const exports, object-form CommonJS exports, and every supported extension.

The twelve visible route modules themselves use directly wrapped `const` handlers, but the required structural governance control is not fail closed.

### 3. The analyzer does not bind each route and method to its exact permission

The test builds a global set of valid permission names and accepts any literal belonging to that set:

* `tests/admin-auth-boundary.test.ts`, patch lines 1373–1375 and 1481–1485.

It does not pin a route/method-to-permission mapping. This would pass:

```ts
export const DELETE = withAdminPermission(
  "dashboard.aggregate",
  async request => deletePersonalData(request),
);
```

That is especially dangerous here because `verifyAdminPermission` expressly allows password sessions whenever the declared permission is `dashboard.aggregate` or `session.logout`:

* `lib/server/admin-auth.ts`, patch lines 1157–1164.

Thus a single incorrect but globally valid literal on archive, bulk assignment, privacy deletion, retention, SLA, evaluation, or follow-up would grant the potentially known password mutation authority while the AST gate remained green.

The canonical inventory must map every exact path and HTTP method to its one permitted literal—for example, privacy `DELETE → privacy.delete`, metrics `GET → dashboard.aggregate`, and logout `POST → session.logout`—and reject missing, duplicate, additional, or changed mappings.

The current visible route assignments appear semantically correct; the admission proof does not preserve them.

### 4. Session minting depends on a forgeable object and a bypassable call-site scan

`createAdminLoginSession` is exported and accepts a structurally typed object. At runtime it does not verify `identity.ok`, does not possess an unforgeable verifier result, and for `review_bearer` accepts any valid actor and any valid admin role:

* `lib/server/admin-auth.ts`, patch lines 1074–1106.

An internal caller can therefore mint a signed twelve-hour administrator cookie without presenting the review token by fabricating the object. The only intended protection is the AST assertion that the login route is the sole production caller.

That assertion is not exhaustive:

* The runtime scan covers only `app`, `components`, and `lib`: `tests/admin-auth-boundary.test.ts`, patch lines 1368–1372.
* Import recognition requires the exact string `@/lib/server/admin-auth`: patch lines 1387–1403 and 1522–1565.
* A relative named import of the same module is invisible.
* `require`, computed dynamic imports, alternative resolvable specifiers, and runtime files outside those three directories are not closed.

For example, this additional production call is not attributed to the protected symbol by the current analyzer:

```ts
import { createAdminLoginSession } from "../../../../lib/server/admin-auth";

createAdminLoginSession(
  {
    actor: "Injected administrator",
    credential: "review_bearer",
    principal: "interactive",
    role: "admin",
  } as never,
  Date.now(),
);
```

Use a runtime-unforgeable proof, such as a module-private `Symbol` attached only by successful credential verification and checked by the mint function, or combine verification and session issuance behind one login-only operation. Separately, resolve imports to canonical files with the TypeScript program/module resolver and scan the complete production runtime graph, including relative imports, CommonJS access, dynamic imports, re-exports, root-level Next entrypoints, and any Pages Router or `src` runtime surfaces that exist.

### 5. The negative tests do not prove several claims made by the manifest

The evidence overstates the hostile and rotation coverage:

* The all-bearer collision test checks login and one bearer request but not a pre-existing signed session cookie under collision configuration: `tests/admin-auth.test.ts`, patch lines 1800–1819.
* The rotation test obtains `oldCookie` from `loginSession()` whose default credential is the review token, so it proves review-session invalidation, not password-session invalidation: helper at lines 1665–1668 and test at lines 1821–1838.
* The rate-limit test proves spoofed earlier XFF entries cannot rotate the bucket, but it removed the independent-identity success assertion. A rate limiter accidentally using one global constant bucket would satisfy the new test: `tests/admin-login-route.test.ts`, patch lines 1972–1989.
* The hostile AST fixtures omit the passing false-green forms above, relative mint imports, and valid-but-wrong permission literals: `tests/admin-auth-boundary.test.ts`, patch lines 1599–1617.

Add explicit negative tests for both password and review cookies after token rotation; an already-issued cookie under each password/bearer collision; two genuinely distinct trusted client identities; invalid Authorization plus a valid cookie to prove bearer failure cannot fall back; exact permission-map substitutions; and all structural bypasses described above.

### 6. Mandatory exact-head and combined-tree admission is absent

The manifest itself records that the full standalone run is not the required green combined result: fifteen failures remain until PR #78 is integrated and tested:

* `.apr/evidence/oriental-admin-password-security.md`, lines 155–158.

It also explicitly says the final synthetic integration and exact-head GitHub CI have not been rerun and are mandatory pre-merge gates:

* `.apr/evidence/oriental-admin-password-security.md`, lines 180–181.

There is also no supplied closure showing that the live PR head differs from the clean implementation tree only under `.apr/`, as required by lines 20–25.

These are unconditional admission blockers. Focused Vitest, lint, typecheck, build, and diff-check success cannot substitute for the exact combined tree or exact final head.

## Documentation and release-state defect

The launch checklist correctly marks both-scope materialization, Coolify reconciliation, and live reduced-session proof as pending:

* `docs/09-LAUNCH-CHECKLIST.md`, patch lines 883–889.

However, other documents use present-tense operational assertions that the plaintext is absent from current runtime or Coolify configuration:

* `README.md`, patch lines 64–69.
* `docs/11-INFRASTRUCTURE.md`, patch lines 908–912.

A source-only patch can establish absence from the reviewed tree, not from a live Coolify environment. Until a redacted complete environment readback proves both the new HMAC and the absence of historical plaintext aliases, those statements should be normative—“must be absent”—rather than claims about current runtime state.

## Rechecks that hold in the supplied source

The core cryptographic separation is correctly implemented:

* Password verifier domain and session-signing domain are distinct.
* The review token remains the only HMAC key.
* Method, role, actor, expiry, and version are signed.
* Password sessions are forced to role `viewer` and thirty minutes.
* Review sessions retain the configured role and twelve hours.
* Unknown methods, malformed actors, malformed HMAC strings, expired cookies, and password cookies with non-viewer roles are rejected.
* Missing or malformed password HMAC disables password login and password-session acceptance while preserving a distinct review token.
* Review-token rotation invalidates signatures and makes the old password HMAC unusable.
* The bearer verifier considers only the review, ops, and privacy tokens.
* Runtime configuration collision is checked before login, cookie, and bearer authentication, so a password equal to any managed bearer fails closed.
* Production preflight requires the HMAC, enforces lowercase 64-hex syntax, and rejects password equality with every bearer without printing credential material.
* The HMAC is included in the central managed-environment inventory and parity machinery.

The visible handler conversions also place authentication before callback body parsing, I/O, logging, and mutation.

## Risk conclusion

The HMAC, same-origin check, login rate limit, and thirty-minute cookie **do not make a historically exposed password secret again**:

* Same-origin enforcement is a browser-CSRF control; a direct client can provide its own Origin header.
* Rate limiting is principally a guessing control; a party that already knows the password succeeds on its first attempt.
* Thirty-minute expiry limits one cookie’s lifetime, but the known password can mint another cookie indefinitely.
* Rotating the review token and recomputing the HMAC does not revoke knowledge of the unchanged password.

Therefore the only meaningful containment is the exact capability boundary. Once the password path uses a dedicated aggregate-only return type, route permissions are pinned exactly, session minting has runtime provenance, and the hostile gates are genuinely closed, the owner’s choice can be treated as an explicit acceptance of aggregate operational disclosure with no PII or mutation authority. The current implementation has not yet reached that state.

Exact-head CI and combined integration must pass before merge. After merge, neither source approval nor staging success may waive exact-merge-SHA staging deployment, live password-session method/role/expiry inspection, raw-route and mutation `403` proof, password-as-bearer rejection, Redis/XFF behavior, managed-environment readback, identical-SHA production promotion, cookie-attribute verification, running-SHA verification, and retained rollback.

VERDICT: DO NOT MERGE
