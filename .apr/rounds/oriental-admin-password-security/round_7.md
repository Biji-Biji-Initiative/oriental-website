# Oracle Browser Transcript

Conversation: https://chatgpt.com/c/WEB:28c96658-c24e-47c6-942e-8fd1253879a8

## Prompt

Perform an adversarial exact-tree security and release review of implementation
commit 18efa9768bc46df960fe06edafbaa4e6090901dc using the source-only patch and
evidence manifest. The owner requires the reaffirmed password even though
historical repository exposure means it is potentially known. Decide whether
the signed method=password, viewer-only, thirty-minute session materially
contains that risk now that it authorizes only a dedicated fixed aggregate
metrics DTO and logout; all customer records, transcripts, voice detail,
events, analytics/queues, and mutations require managed-token step-up.
Recheck every round-four and round-five blocker: Convex must declare the exact
return validator and Next must independently reject missing, extra, malformed,
nonfinite, fractional-count, and out-of-range DTO fields; password authority
must use uncopyable one-time module-private runtime provenance and reject
spread, mutation, symbol discovery, proxy, structural-forgery, and replay
attempts; the route proof must inventory the complete effective production
graph, effective exports, all supported extensions, Pages handlers, star and
namespace re-exports, default login exports, every CommonJS mechanism, aliases,
bridges, and the full hostile matrix; collision tests must cover every password
HMAC candidate against every bearer and both session methods; documentation
must not claim plaintext absence before runtime proof. Confirm exact-source-head
GitHub CI and integration commit 470dd990f0078ecca55c4475b4be80cf602c784f,
tree 22c331f96cb46187870d572386b1cab5f7d27504, with all 89 files and
2,333 tests. Do not waive exact-SHA staging, live reduced-session proof, or
guarded production verification. End with `VERDICT: MERGE` or
`VERDICT: DO NOT MERGE` on its own final line.

## Answer

## Decision

The authorization design materially contains the historically exposed password
for confidentiality and integrity, but not for secrecy or availability. In the
shown runtime path, the password cannot act as a bearer or signing key; it
produces a signed `method=password`, viewer session whose centralized
permission path allows only aggregate metrics and same-origin logout. Raw
leads, transcripts, voice detail, queues, events, and mutations remain behind
review-token authority.

That containment is not yet admissible, however. One runtime validator remains
weaker than claimed, three static-governance paths can false-green hostile
mutations, the supplied browser proof can silently skip the mandatory password
lane, and the manifest does not independently substantiate the exact GitHub or
integration executions.

## Release blockers

### 1. The Next DTO validator accepts semantically out-of-range counts

`getAdminAggregateMetrics` clamps the backend query to `take <= 100`, with the
API specifically requesting 75 and the page requesting 100. Nevertheless,
every count is validated only up to `Number.MAX_SAFE_INTEGER`:

- `lib/server/convex.ts`, patch lines 1519–1554
- `app/api/admin/metrics/route.ts`, patch lines 522–529
- `app/admin/session-review/page.tsx`, patch lines 122–137

Consequently, a Convex response such as `recentLeads: 76` for
`getAdminAggregateMetrics(75)`, or `reviewedSessions: 101` for the page's
100-row query, is accepted. Values in the quadrillions also pass. Those values
are impossible under the fixed bounded query and are therefore out of range for
this DTO, even though they are JavaScript-safe integers.

The tests verify 101 only for percentage fields and verify fractional values
only for two count fields. They never test `take + 1` for any count:

- `tests/convex.test.ts`, patch lines 3326–3359

This does not satisfy the requested independent rejection of out-of-range DTO
fields.

Required repair: construct the schema from `take` and apply `.max(take)` to
every count. At minimum, also enforce the obvious subset constraints:
lead-derived counts must not exceed `recentLeads`, and voice-derived counts must
not exceed `reviewedSessions`. Add `take + 1` hostile cases for every count key.

### 2. The "whole-production" authority scan omits reachable imported source

The test first filters paths by name and only then uses that list as its
governed iteration set:

- `tests/admin-auth-boundary.test.ts:64–74`, patch lines 1687–1697
- `tests/admin-auth-boundary.test.ts:140–152`, patch lines 1763–1775
- `tests/admin-auth-boundary.test.ts:676–687`, patch lines 2299–2310

It excludes dot-prefixed paths, `test/` or `tests/` directories,
`convex/_generated`, and other path classes. TypeScript will still add an
excluded file to `productionProgram` when an included production module imports
it, but `resolvedProtectedSymbolCalls` iterates only `productionPaths`, not
`productionProgram.getSourceFiles()`.

The call tracer also does not traverse a referenced function declaration's
body; it follows only selected variable/property/binding initializers:

- `tests/admin-auth-boundary.test.ts:621–674`, patch lines 2244–2297

A concrete false-green graph is therefore:

```text
.runtime/admin-mint.ts
  imports createAdminLoginSession
  exports function mint(...) { return createAdminLoginSession(...); }

app/api/public/route.ts
  imports mint from .runtime/admin-mint
  calls mint(...)
```

The hidden bridge is present in the TypeScript program and is
production-reachable, but is not scanned. The public route's call resolves to a
function declaration whose body is not followed. The resulting protected-call
inventory still reports only the canonical login route.

This directly refutes the claimed complete effective production graph, bridge
coverage, and one-call-site authority.

Required repair: establish production roots, build the program, and then govern
every repository-local, non-declaration source returned by
`productionProgram.getSourceFiles()`. Do not discard a source merely because
its pathname resembles a test or hidden directory once it is reachable from a
production root. Add hostile fixtures for imported dot-directory,
test-directory, generated-directory, and outside-root bridges.

### 3. The effective-export proof does not prevent private authority from being attached to an allowed export

`authRuntimeExportViolations` pins only top-level export names and declaration
kinds. The checker comparison likewise inventories only top-level module
exports:

- `tests/admin-auth-boundary.test.ts:222–286`, patch lines 1845–1909
- `tests/admin-auth-boundary.test.ts:900–920`, patch lines 2523–2543

It does not examine properties attached to an allowed exported function. For
example, this hostile mutation adds no module export and does not alter normal
function behavior:

```ts
Object.assign(adminCookieHeader, {
  claims: verifiedAdminLoginClaims,
  mint: createAdminLoginSession,
  signer: sign,
  verifyBearer: verifyAdminBearerToken,
});
```

A consumer can import only the allowed `adminCookieHeader`, cast its additional
properties, seed the supposedly private `WeakMap`, mint a structurally forged
session, or invoke the private signer/bearer verifier.

The current resolved-call analysis does not close this:

```ts
if (ts.isCallExpression(node)) {
  for (const symbol of rootsFromNode(node.expression)) ...
}
```

It analyzes the callee `Object.assign`, not the protected values in its
arguments. A later call through a cast property also has no checker link to the
private declaration. The hostile tests append new top-level exports, which is
much easier to detect, but do not test mutation or augmentation of an already
allowed export.

The current `WeakMap` implementation itself correctly rejects spread, proxy,
mutation, structural forgery, and replay. The blocker is that the proof
advertised as guaranteeing module-private, unexportable provenance would accept
a source mutation that exposes both the map and the minter.

Required repair: treat every allowed runtime export as an object-reachability
boundary. Reject namespace merges, property assignments, `Object.assign`,
`Object.defineProperty`, returned private functions or state, getters, arrays,
and factories that make protected values reachable through an allowed export.
Include the claims `WeakMap` in the protected escape set, not only the signer
and verifier functions.

### 4. Supported route extensions are not derived from the effective Next configuration

The route inventory hard-codes eight extensions:

- `tests/admin-auth-boundary.test.ts:10–21`, patch lines 1633–1644
- `tests/admin-auth-boundary.test.ts:105–138`, patch lines 1728–1761

It attempts to prove that no custom `pageExtensions` exists by searching only
`next.config.*` text for the literal identifier:

- `tests/admin-auth-boundary.test.ts:766–771`, patch lines 2389–2394

This is bypassed by either an imported configuration or a computed key:

```ts
const key = "page" + "Extensions";

export default {
  [key]: ["js", "jsx", "ts", "tsx", "adminroute"],
};
```

A supported `pages/api/admin.adminroute` handler would then be outside
`sourceExtensionList` and outside the canonical route inventory, while the
literal regex still passes.

The direct default, named, star, namespace, and enumerated CommonJS hostile
cases are useful, but extension completeness is still not fail closed.

Required repair: load or otherwise derive the effective Next configuration in
an isolated test process and obtain the actual `pageExtensions` value.
Alternatively, statically reject computed configuration, spreads, and imported
config graphs so the default extension assumption is itself proven. Add
computed-key and imported-config hostile fixtures.

### 5. The supplied browser proof can pass with the mandatory lane skipped

The Playwright suite dynamically skips every admin test when the review token
is absent or the auth configuration is invalid:

- `tests/e2e/admin-session-review.spec.ts:12–17`, patch lines 3385–3390

The password-specific proof separately skips when
`E2E_ADMIN_SHARED_PASSWORD` is absent:

- `tests/e2e/admin-session-review.spec.ts`, patch lines 3416–3422

Thus a configuration collision can make the entire suite green by skipping it,
and a staging run without the password can report success while exercising none
of the aggregate-only lane. That suite cannot be the authoritative exact-SHA
staging proof in its present form.

Required repair: add an explicit release-proof mode in which missing token,
missing password, invalid configuration, or any skipped target test is a hard
failure. Preserve optional skipping only for ordinary developer runs. The
guarded staging command and its machine-readable report must assert zero skipped
password-proof tests.

### 6. Exact-head GitHub CI and the integration commit are asserted, not independently evidenced

The manifest provides only prose conclusions for:

- GitHub verify on `18efa9768bc46df960fe06edafbaa4e6090901dc`
- integration commit `470dd990f0078ecca55c4475b4be80cf602c784f`
- tree `22c331f96cb46187870d572386b1cab5f7d27504`
- 89 test files and 2,333 tests
- pnpm 10.34.5, audit, lint, TypeScript, and build results

See `.apr/evidence/oriental-admin-password-security.md:171–190` and 220–234.

There is no GitHub run/check-suite/job identifier, event and checked-out SHA
record, immutable log or artifact digest, integration commit-object/tree output,
source-head composition listing, or machine-readable test report. The
manifest's own earlier requirement that the live PR head be proven APR-only and
pass final-head CI is also not accompanied by a live head SHA or comparison
artifact (`.apr/evidence/oriental-admin-password-security.md:17–22`).

I therefore cannot confirm the exact GitHub execution or the stated integration
tree/test totals from the supplied materials.

Required evidence: immutable GitHub run and job IDs showing the checked-out
head; `git cat-file`/`git show` proof for the integration commit and tree; an
exact source-head composition manifest; and retained machine-readable
test/audit reports whose counts and hashes substantiate 89 files and 2,333
passing tests.

## Checks that are substantively closed

The shown Convex query does declare a fixed `returns: v.object(...)` validator,
and the Next adapter uses nested `z.strictObject` schemas that reject missing
and extra keys, strings/objects, NaN, infinities, negative counts, and
fractional counts. The remaining DTO defect is the bounded-domain upper range
described above.

The current provenance implementation is sound against the enumerated
caller-level attacks: claims live in a module-private `WeakMap`, are looked up
by exact object identity, are deleted before minting, and visible-field mutation
cannot relabel the stored claims (`lib/server/admin-auth.ts`, patch lines 1240
and 1298–1331). The runtime tests exercise spread, proxy, mutation, symbol
inspection, structural forgery, and replay (`tests/admin-auth.test.ts`, patch
lines 2700–2734).

The password principal is limited twice: its permission map contains only
`dashboard.aggregate` and `session.logout`, and `verifyAdminPermission` has an
explicit password-session restriction before the ordinary role check
(`lib/admin-permissions.ts`, patch lines 1190–1194;
`lib/server/admin-auth.ts`, patch lines 1382–1395). The page also branches to
the aggregate adapter before either broad dashboard query is reached.

The collision cross-product is present. For each of the review, ops, and privacy
bearer candidates, the runtime test checks both login methods, every bearer
request, and both pre-existing session methods (`tests/admin-auth.test.ts`,
patch lines 2776–2821). Production preflight applies the corresponding
three-candidate HMAC check (`scripts/check-secrets.ts`, patch lines 1593–1602).

The documentation no longer claims that runtime plaintext absence has already
been proven. README, technical specification, infrastructure guidance,
`AGENTS.md` guidance, and the launch checklist consistently make
materialization and redacted runtime readback pending.

## Risk disposition

A holder of the potentially known password still receives the exact aggregate
values and can observe changes over time. Thirty-minute expiry does not restore
secrecy because the holder can log in again. A valid session can also repeatedly
invoke the aggregate endpoint during its lifetime; the endpoint itself is not
rate-limited, although each Convex computation is bounded. That leaves
disclosure, inference, and availability/cost exposure. The owner and
specification explicitly accept the aggregate disclosure and bounded compute,
so those are not additional blockers.

The raw-data and mutation containment is materially better than the historical
universal credential, but the release cannot rely on the advertised exact-tree
proofs until the false-green paths and evidence deficiencies above are closed.
Exact-SHA staging, live reduced-session verification, and guarded production
verification remain mandatory and unperformed; none is waived by this review.

VERDICT: DO NOT MERGE
