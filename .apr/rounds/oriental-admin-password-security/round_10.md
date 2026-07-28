Decision

Do not merge. I bound the review to implementation commit 550da92f77be2c500bafde7619d98b451046a69a, tree 836e22cc877c975772beca9d9e3e4a87fe34b9b2, and the 4,903-line source-only patch whose recomputed SHA-256 is f4cd4a1889d8ca84327f7c8e994d5b895dea4030a5904eeedec4d08709ba5051.

attachments-bundle

The current runtime design does materially contain the known-password risk: the password does not become a bearer or signing key; it produces a signed method=password, viewer-only, thirty-minute cookie; and that principal is limited to a bounded, fixed aggregate DTO plus logout. It does not restore password secrecy, stop re-login, or prevent repeated aggregate polling and time-series inference. Those residual aggregate and bounded-compute risks are explicitly accepted by the owner, while raw records, PII, transcripts, mutations, and stronger authority are not.

attachments-bundle(15)

However, the mandatory round-nine whole-program admission control is unsound. I reproduced three distinct false-negative classes against the exact extracted checker. These are release blockers because the contract requires the hostile forms to fail closed, even though I found no malicious instance of them in the current production source.

Release-blocking findings
1. Namespace createRequire bypasses the login-only authority proof

Path: tests/admin-auth-boundary.test.ts:1127-1140, 1197-1204, 1264-1273, 1418-1447

The checker records createRequire only when it appears in a named import from node:module or module; its isCreateRequireCall recognizer then accepts only a call whose callee is an identifier in that named-import alias set. Namespace acquisition is not classified as a loader. The supplied regression coverage tests only the named-import form.

attachments-bundle(15)



attachments-bundle(15)

This valid TypeScript fixture is admitted:

TypeScript
import * as nodeModule from "node:module";

const req = nodeModule.createRequire(import.meta.url);
const auth = req("../../../../lib/server/admin-auth");

auth.createAdminLoginSession({} as never, 0);

Running the exact extracted helper produced:

JSON
{"calls":[],"forbiddenAccesses":[],"imports":[]}

The same false-negative occurs with a default-imported node:module object and with process.getBuiltinModule("module").createRequire(...).

This is material. A repository-local production module outside the login route can acquire the exported verifier and minter, implement an alternate authentication path without the governed login route’s same-origin and rate-limit boundary, and still satisfy the asserted admission test. The checker-resolved call pass is not a backstop because the return value of a CommonJS require call is typed as any; the protected property therefore has no resolvable declaration identity.

Direct require, loader aliases, module.require, destructured module.require, and named-imported createRequire fixtures are caught. Parenthesized, asserted, satisfies, non-null, static-template, constant-binding, and constant-concatenation processing also remains functional. The failure is specifically that the loader acquisition identity is incomplete.

2. Object mutation can be hidden behind global receivers, .bind, and nested call indirection

Path: tests/admin-auth-boundary.test.ts:427-528, 810-844

directAuthMutationPrimitive requires the Object or Reflect receiver to be a bare identifier. primitiveFor follows only identifiers and one level of .call or .apply; it does not follow .bind, globalThis.Object, or nested Function.prototype.call.call. The final scan has a special case only for a call whose root is directly Reflect.

attachments-bundle(15)



attachments-bundle(15)

Each of the following type-checks and mutates the exported function object with the private signer, but authRuntimeExportViolations(...) returned []:

TypeScript
globalThis.Object.assign(adminCookieHeader, { signer: sign });
TypeScript
Object.assign.bind(null)(
  adminCookieHeader,
  { signer: sign },
);
TypeScript
Function.prototype.call.call(
  Object.assign,
  null,
  adminCookieHeader,
  { signer: sign },
);

The direct control fixture:

TypeScript
Object.assign(adminCookieHeader, { signer: sign });

was correctly rejected, confirming that these are differential false negatives rather than a broken extraction.

The consequence is a direct private-authority escape. A future change inside admin-auth.ts could attach sign or verifyAdminBearerToken to an allowed exported function while leaving the effective module export names unchanged. An importer could then recover the private authority through that exported function object. Existing fixtures cover direct/computed aliases and direct Reflect.apply, but not these semantically equivalent call forms.

attachments-bundle(15)

3. Private-authority taint is lost through binary expressions and later container mutation

Path: tests/admin-auth-boundary.test.ts:534-641, 684-740, 785-800

The taint evaluator explicitly returns null for every BinaryExpression and TemplateExpression. Consequently, JavaScript operators that return one of their operands—such as &&, ||, and comma—can return private authority without taint. The mutation propagation also uses the first tainted argument as the supposed target root, rather than the call receiver; for result.values.push(sign), it attempts to taint sign, not result.

attachments-bundle(15)



attachments-bundle(15)

This exported-function replacement returned no violation:

TypeScript
export function clearAdminCookieHeader() {
  return (Date.now() > 0 && sign) as unknown as string;
}

So did a later array mutation followed by returning the container:

TypeScript
export function clearAdminCookieHeader() {
  const result = { values: [] as unknown[] };
  result.values.push(sign);
  return result as unknown as string;
}

The same gap persists through destructured array aliases and through pushing sign.bind(null). Direct return sign, direct array/object literals containing sign, directly returned getters, factories, and bound values are rejected; the missing part is later mutation and operator-result flow. The supplied hostile bodies exercise only direct construction and direct return paths.

attachments-bundle(15)

This disproves the manifest’s claim that typed private-authority taint closes nested/destructured containers, arrays, getters, factories, bind results, and later mutations.

Security-boundary recheck
Control	Result	Review conclusion
Known-password least privilege	Pass for current source	method=password, forced viewer role, thirty-minute expiry, aggregate DTO and logout only
Password as bearer/signing key	Pass	Password is excluded from bearer verification; ADMIN_REVIEW_TOKEN remains the signing key
Aggregate DTO and bounds	Pass	Strict outer and inner objects, finite/integer/nonnegative counts, count ≤ normalized take, percentages in [0,100], and subset ≤ parent checks
One-time mint provenance	Pass in runtime code	Module-private WeakMap, exact-object lookup, delete-before-mint, and canonical claims rather than caller-visible fields
Collision cross-products and rotation	Pass	Review, ops, and privacy bearer collisions fail all auth planes closed; token rotation invalidates both session methods and the old password HMAC
Effective Next configuration	Pass for current tree	Actual production loadConfig output governs supported pageExtensions; hostile computed/imported config is exercised
Current route and export inventory	Pass for current tree	No extra current admin route or runtime export was found
CommonJS/dynamic authority closure	Fail	Namespace/default createRequire acquisition escapes
Object/Reflect mutation closure	Fail	Global receiver, bound primitive, and nested call indirection escape
Typed private-authority taint	Fail	Binary result and later container-mutation flows escape
Exact canonical release origin	Pass as source mechanism	Only the two canonical HTTPS root origins are admitted; ports, paths, userinfo, queries, fragments, and compatibility hosts are rejected
Release E2E hard failure	Pass as source mechanism	Missing environment, browser failure, nonzero exit, invalid JSON, zero expected tests, skips, unexpected, or flaky tests all fail
Telemetry minimization	Pass	Only bounded actor, credential provenance, role, and expiry metadata are emitted; no submitted credential, HMAC, token, cookie, or body
Live runtime proof	Pending	Correctly retained as a mandatory post-merge gate

The strict aggregate adapter clamps the request to at most 100 and independently validates every count and subset relationship before returning data to Next.

attachments-bundle(15)

 The runtime login/mint implementation uses one-use private claims and enforces password versus review provenance and TTLs in the signed cookie.

attachments-bundle(15)

 Password-cookie permission is explicitly restricted before the ordinary role check, and the collision configuration disables login, cookies, and bearer paths without exposing credential material.

attachments-bundle(15)



attachments-bundle(15)

Raw-artifact hash recomputation

The manifest supplied expected sizes and digests for the source patch and seven support artifacts and required recomputation rather than digest-only admission.

attachments-bundle(15)

 I reconstructed the embedded payload bytes and obtained:

Artifact	Bytes	Recomputed SHA-256	Status
Outer attachments-bundle(15).txt	1,739,468	ca9b749646c41136991230484a30dd0c0bc2a27f21140565e4852d44016010e0	Computed
.apr/evidence/oriental-admin-password-security.md	20,556	30e4b2a97b974e44ae67a1f541d1d4c47a73301e73232730e24660fae3dd1248	Computed; no self-digest declared
.apr/evidence/oriental-admin-password-security.patch	222,398	f4cd4a1889d8ca84327f7c8e994d5b895dea4030a5904eeedec4d08709ba5051	Matches
.apr/specs/oriental-admin-password-security.md	5,567	4372cab8447159533853106e6eb936346537da816f3ecdbef3c9a019a2ecf4b5	Computed
github-evidence.json	55,760	787b897dec0623b8b870537af989a8fd838166bac22cb2b2a9effd2f739a0d91	Matches
source-ci.log	71,549	b377da7df42c6db3638366b002e700c137b11136360fd7175a3d5374a958cf53	Matches
integration-ci.log	76,576	0736894d1c93c7587e372abe0e4fa0dbf5dee0a3617bf4eeb600c1d82336f70d	Matches
integration-merge-dag.txt	60,027	5cc7ca47ce9a4e97ff52001ab10d61f50245498096560357c7ae7b877826dea6	Matches
source-to-integration-overlap.diff	33,276	b530dcb6ad0cb4c39ba20c0f9c6cae6d1595d1f7be0de8343fc203bbd45a5813	Matches
integration-vitest.json	865,288	e96d208ba78f9a91295ac35767a7a375c352f1028c510f04dc31afac08c527a6	Matches
integration-audit.json	310	e6b1e426bee90fc309ed49cf51fff66f7d2218cca7fcb42e88b1b312521a615c	Matches
final-head-github-evidence.json	59,877	6035a00aadd9e181cd779eb871116ca9d2eaa3c9a79c8b52eeee7f9a52c50e38	Computed; no manifest digest declared
final-head-ci.log	71,227	46ac9258839a1fa1da64f642c4bdcec87d694a764c834ade69a60f7c192bffd1	Computed; no manifest digest declared
source-to-live-head.diff	106,217	3e118d953ab2a5af0e68875e8c853914576d82917fe7d8f79c6dcc5d136be1ce	Computed; no manifest digest declared

integration-vitest.json has no terminal newline. Its declared 865,288-byte digest matches the JSON payload without the enclosing text fence’s presentation newline.

All four JSON evidence files parsed successfully. The Vitest result contains 89 test files and 2,337 passed assertions with zero failed or pending; the audit JSON reports 378 production dependencies and zero findings at every severity.

Exact CI and composition evidence
Source CI

The raw GitHub evidence confirms:

Run 30380126522

Job/check 90345634811

Check suite 82340970175

Event pull_request

Conclusion success

Head SHA 550da92f77be2c500bafde7619d98b451046a69a

Tree 836e22cc877c975772beca9d9e3e4a87fe34b9b2

The run, event, suite, head, and conclusion agree across the PR, run, job, check-run, and suite responses.

attachments-bundle(15)



attachments-bundle(15)

 The raw log independently printed the exact checkout SHA and tree.

attachments-bundle(15)

The source run used pnpm 10.33.0, as defined by that exact source workflow. I do not conflate this with the later integration pin.

Eight-head integration CI

The raw evidence confirms:

Integration commit 217cb9eb11423e550de5c85d168f78e759e60310

Tree 207018627ce96529f59de10161b597b5647c9fae

Run 30380150560

Job/check 90345713930

Suite 82341039430

Event pull_request

Conclusion success

attachments-bundle(15)



attachments-bundle(15)



attachments-bundle(15)

All eight requested heads are recorded as ancestors of the integration commit:

#78 7657afae19433f276c89967ca9f6c2a94a509fd9

#79 aaeba89264b34a902d4d1595bf4d31907a91b2d4

#80 550da92f77be2c500bafde7619d98b451046a69a

#81 297e0b1a47d7d8cf3a005c606146b7de8dd7ff96

#82 d81140cb87ff36a6e4196f230a9b4d7bf9a69806

#83 f9467a918708c9385163516e01f34f4d9bb58d3f

#84 413fdf0eaf758394c68d817aaf588558ead80a57

#85 42bd5f078754ae925d71f7f9cc1e5eb8778a5f20

attachments-bundle(15)

The parent ledger shows the expected first-parent sequence, ending with source head 550da92f77be2c500bafde7619d98b451046a69a as the integration commit’s second parent. The additional f515499… entry is an ancestor on the source branch, not a foreign ninth integration head.

attachments-bundle(15)

The integration run additionally proves:

Frozen pnpm 10.34.5 installation and explicit registry/version output.

attachments-bundle(15)

Lint checked 294 files with no lint diagnostics; strict type checking ran next typegen && tsc --noEmit.

attachments-bundle(15)

Production audit: zero info, low, moderate, high, or critical findings across 378 dependencies.

attachments-bundle(15)

89 files and 2,337 tests passed.

attachments-bundle(15)

Next.js 16.2.12 build completed, including strict TypeScript.

attachments-bundle(15)

Mobile performance passed with LCP 800 ms, CLS 0, 444,009 transferred JavaScript bytes, 15 initial JavaScript requests, and zero serious or critical accessibility violations.

attachments-bundle(15)

The lint step is warning-free. The complete integration log is not literally warning-free: pnpm setup recorded a Node deprecation warning and one registry retry, installation reported intentionally ignored dependency build scripts, and Next reported its normal missing-build-cache/telemetry notices. None caused a failed gate, but they should not be relabelled as absent.

The source-to-integration overlap touches eleven paths, but no hunk changes lib/server/admin-auth.ts, lib/server/admin-route.ts, tests/admin-auth-boundary.test.ts, the login route, the metrics route, or the aggregate DTO validator. The overlapping Convex changes are SLA/voice-related additions and do not repair or weaken the three checker defects above.

Final live PR-head snapshot

The attached final evidence snapshot identifies PR #80’s head as:

Commit 1849330038180a36564a5003c6a1d41f6f72702a

Tree bf89e558b60f0879e4e56d3aa4fa558c954ccd66

Run 30380937564

Job/check 90348332898

Suite 82343386822

Event pull_request

Conclusion success

PR state mergeable and clean, but not merged

attachments-bundle(15)



attachments-bundle(15)

 The raw final log independently attests the exact final SHA and tree.

attachments-bundle(15)

source-to-live-head.diff contains exactly four changed paths, all APR-only:

.apr/evidence/oriental-admin-password-security.md

.apr/evidence/oriental-admin-password-security.patch

.apr/rounds/oriental-admin-password-security/round_9.md

.apr/workflows/oriental-admin-password-security.yaml

attachments-bundle(15)



attachments-bundle(15)



attachments-bundle(15)



attachments-bundle(15)

Therefore, as captured by the attached July 28, 2026 evidence, there is no non-APR descendant source change after the implementation commit. The three blockers are already present in implementation tree 836e22…; they were not introduced by final evidence commits.

Mandatory runtime gates remain pending

The source verifier correctly admits only the two canonical HTTPS root origins and hard-fails on missing credentials, invalid JSON output, runner failure, zero expected tests, skipped tests, unexpected failures, or flaky results.

attachments-bundle(15)

 The E2E source contains assertions for review/password cookie methods and TTLs, password bearer rejection, raw-route and mutation 403s, Redis-backed shared remaining counts, and exhaustion to 429.

attachments-bundle(15)

Those are source mechanisms, not completed deployment evidence. The following remain mandatory after a corrected implementation is merged:

Derive the reaffirmed password HMAC without logging either input.

Materialize it in both governed Infisical scopes and perform exact Coolify/runtime readback.

Complete the Convex-first release sequence.

Deploy the exact merge SHA to canonical staging.

Run the clean-cookie-jar release proof with nonzero expected tests and exactly zero skipped, flaky, unexpected, or failed tests.

Prove live HttpOnly, SameSite, and Secure cookie flags; password/viewer/thirty-minute claims; configured review role/twelve-hour claims; password bearer rejection; raw customer, event, transcript/voice, analytics/queue, and mutation 403s; Redis store identity, shared remaining counts, and exhaustion.

Promote the identical SHA to production and prove the exact running SHA, managed environment, authentication behavior, health, and rollback state.

The manifest also marks these as post-merge rather than completed source-review facts.

attachments-bundle(15)

Required correction before a new review

The checker must be repaired without weakening the route inventory, assertions, or hostile fixtures:

Resolve node:module/module loader authority by symbol identity for named, namespace, default, import-equals, dynamic, and process.getBuiltinModule acquisition, then follow the resulting loader through properties, containers, assignments, .bind, .call, and .apply.

Normalize mutation primitives semantically through globalThis, receiver aliases, bound functions, nested call/apply forms, Reflect.apply, prototype changes, and all definition primitives. Determine the real mutation target according to the invoked primitive’s argument convention.

Make private-authority taint flow through operand-returning binary expressions and through receiver-side mutations of arrays, objects, maps, sets, getters, setters, factories, and bound values.

Add the exact bypasses above as hostile regression fixtures and require differential controls showing direct and indirect forms both fail.

Produce a new implementation commit/tree and regenerate source CI, eight-head integration, raw hashes, final PR evidence, and the source-to-live diff. The existing green runs cannot admit the corrected tree because they did not execute these hostile cases.

VERDICT: DO NOT MERGE
