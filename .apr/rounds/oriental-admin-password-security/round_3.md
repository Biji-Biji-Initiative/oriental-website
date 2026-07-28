## Release decision

The implementation should **not merge at this exact head**. The v3 cookie construction, HMAC domain separation, and managed-environment wiring are substantially improved, but the supplied proof has concrete false-green paths, bearer separation is not configuration-invariant, and the mandatory exact-head CI and combined integration gates are explicitly still pending.

There is also a fundamental residual-risk issue: the potentially known password is meaningfully contained against mutation and privileged operations, but **not against confidentiality loss**. It grants renewable access to the complete lead and voice review plane.

## Release-blocking findings

### 1. The whole-production AST test is materially false-green

The new AST test does not prove the ownership claims made in the evidence manifest.

Route discovery is limited to:

* `app/api/admin/**/route.ts`
* five HTTP method names: `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`
* top-level exported `FunctionDeclaration` handlers

See `tests/admin-auth-boundary.test.ts:7-16,68-76` and patch lines 523-532 and 584-591.

It therefore ignores, among other forms:

* alternate route extensions;
* `HEAD` and `OPTIONS`;
* `export const POST = async ...`;
* exported aliases or re-exports;
* an additional unguarded variable-based handler in a module that also contains one guarded function declaration.

For example, this module can satisfy the test through `GET` while the unguarded `POST` is never examined:

```ts
export async function GET(request: Request) {
  const auth = verifyAdminPermission(request, "dashboard.read");
  if (!auth.ok) return failure(auth);
  return readDashboard();
}

export const POST = async () => {
  await performSensitiveMutation();
};
```

The authorization-order test is also syntactic rather than control-flow aware. It only requires the textual position of a call named `verifyAdminPermission` to precede the first textual `await`. See `tests/admin-auth-boundary.test.ts:46-66,96-132`, patch lines 562-582 and 612-647.

The following forms can pass:

* the authorization call is inside a never-called nested function;
* the authorization result is ignored;
* the authorization occurs only in one branch;
* a Promise-returning side effect is started before authorization but awaited afterward;
* a synchronous effect occurs before authorization;
* the call is made with the wrong request or wrong permission.

The import/call ownership test does not resolve TypeScript symbols. It searches identifier spelling and direct named imports. Namespace imports, property-access calls, local shadowing, wrapper re-exports, or dynamic imports can evade it. A local function named `verifyAdminLoginCredential` can also supply the counted call while the imported production verifier remains unused. See `tests/admin-auth-boundary.test.ts:28-56,79-94`, patch lines 544-571 and 595-610.

The bearer-privacy assertion only checks whether the function declaration itself carries an `export` modifier. It does not reject a later `export { verifyAdminBearerToken }`, an exported alias, or indirect property-based calls. See `tests/admin-auth-boundary.test.ts:134-148`, patch lines 650-663.

Finally, `expect(adminRoutePaths).toHaveLength(12)` is a count, not an exact path inventory. Removing one governed route and adding an unrelated replacement preserves the count.

**Required remediation:** use an explicit canonical route-path inventory covering every configured route extension; enumerate all HTTP exports through TypeScript symbols, including variable declarations, aliases, `HEAD`, and `OPTIONS`; and make authorization structural rather than positional—for example, require every export to be constructed through a single `withAdminPermission(permission, handler)` wrapper that performs the check before invoking the handler. Add hostile fixtures for each bypass above and prove that each fixture makes the governance test fail.

### 2. Signed provenance is correct on the current login path but is not an enforced minting invariant

`createAdminSessionCookie` remains exported, accepts a broad object with any `AdminCredential`, and has a default identity that produces a twelve-hour `method=review` session without requiring a verified login result:

`lib/server/admin-auth.ts`, patch lines 377-388.

The mapping is also non-exhaustive:

```ts
const passwordSession = identity.credential === "interactive_password";
```

Every other credential value is treated as `review`. Consequently, passing an already verified `password_session` state to this helper would convert it into a twelve-hour signed `method=review` cookie. Passing no identity also produces a review cookie.

The current login route safely passes the successful `verifyAdminLoginCredential` result, but the whole-production test does not own calls to this signing function. It only owns calls to the login verifier. The evidence therefore does not establish that login is the only session-minting authority.

**Required remediation:** remove the default argument, narrow the accepted type to exactly the two successful login results—`interactive_password` and `review_bearer`—and use an exhaustive switch. Prefer keeping the signing primitive private to the login/session module. The AST contract must assert the exact authorized production call site for session minting as well as credential verification.

### 3. Password rejection as bearer authentication is not configuration-invariant

The implementation rejects the supplied test password as a bearer only because the fixture password differs from all three bearer values.

A valid production configuration can still violate the security contract:

* Let `P` be the human password.
* Let `T` be `ADMIN_REVIEW_TOKEN`.
* Store `HMAC_T("oriental-admin-password:v1\0" || P)` as required.
* Configure `P` equal to `T`, `OPS_AUTOMATION_TOKEN`, or `PRIVACY_ADMIN_TOKEN`.

All current production validations can pass:

* the HMAC has the correct 64-character lowercase format;
* the three bearer credentials can remain pairwise distinct and at least 32 characters;
* no validation compares the password HMAC with the HMAC of each bearer candidate.

See `lib/server/admin-auth.ts`, patch lines 348-359 and 464-473; `scripts/check-secrets.ts`, patch lines 490-498.

The consequences are direct:

* If `P === ADMIN_REVIEW_TOKEN`, entering the owner password is classified as `review_bearer`, yielding the configured role and twelve-hour session rather than `method=password`, viewer, thirty minutes.
* If `P === OPS_AUTOMATION_TOKEN`, the historically exposed password works as the ops bearer.
* If `P === PRIVACY_ADMIN_TOKEN`, it works as the privacy bearer.

The negative test at `tests/admin-auth.test.ts`, patch lines 774-801, uses deliberately distinct values and never exercises these collisions.

This makes the documentation’s absolute “never accepted as bearer auth” statement stronger than the source-enforced invariant.

**Required remediation:** production validation—and preferably runtime central configuration validation—must compute the password-domain HMAC for each of the three bearer values under `ADMIN_REVIEW_TOKEN` and reject the environment if any result equals `ADMIN_REVIEW_PASSWORD_HMAC`. Add negative tests for all three collision cases and prove that authentication fails closed rather than silently upgrading the password’s authority.

### 4. The potentially known password remains a renewable sensitive-data credential

The controls materially reduce **integrity and privileged-operation risk**:

* password provenance is signed;
* role is forced to viewer;
* mutation permissions are denied;
* ops and privacy operations use separate bearers;
* token rotation invalidates sessions.

They do **not** materially contain the confidentiality risk created by a password that historical repository readers may already know.

The password session can read `dashboard`, `leads`, and `voice` data. The same documentation describes the surface as exposing the complete CRM table, organization portfolio, lead information, Voice QA material, and transcripts. See `README.md`, patch lines 64-83, and the evidence manifest lines 33-46.

The thirty-minute duration is not a thirty-minute access window. It is indefinitely renewable:

1. A holder of the known password logs in successfully on the first attempt.
2. The eight-attempt rate limit is irrelevant to a correct credential.
3. When the cookie expires, the holder logs in again.
4. Different source identities can obtain concurrent sessions.

Same-origin JSON enforcement is a CSRF control; it is not an independent authentication factor for a client that already knows the password. HTTP-only, SameSite, and Secure attributes protect an issued browser cookie but do not constrain someone who can mint their own cookie through login.

Nor does blocking a dedicated export operation prevent exfiltration. Anything returned through `leads.read` or `voice.read` can be copied or programmatically collected by the reader.

The owner’s insistence on retaining the password is clear, but the evidence does not state that the owner is accepting disclosure of all lead and voice data to anyone with historical repository access. Calling the current design “contained” is therefore too broad. It contains write and operational authority, not the principal confidentiality risk.

**Required remediation while retaining the password:** restrict password sessions to a redacted, aggregate-only dashboard permission. Raw lead records, contact details, transcripts, and voice evidence should require strong-token step-up or another independently controlled factor. Alternatively, the release risk acceptance must explicitly state that all data visible to `viewer` is considered disclosable to holders of the historically exposed password; the current material does not make that acceptance.

### 5. Mandatory pre-merge evidence is absent

The manifest explicitly says:

* the final synthetic integration must be rerun after implementation commit `62122a9bf51d920232ceb84a57512b8bd572b35a`;
* GitHub CI must pass on the final exact PR head;
* both are mandatory pre-merge gates.

See `.apr/evidence/oriental-admin-password-security.md:152-153`.

The listed evidence includes lint, typecheck, focused Vitest, and `git diff --check`, but no completed combined integration result and no exact-final-head GitHub CI result. It also says APR must verify that any descendant of the implementation commit touches only `.apr/` and that the live PR head matches the clean implementation worktree. That verification is not supplied as completed evidence.

These gates cannot be inferred from focused local tests and cannot be deferred to staging.

## Controls that survive adversarial source review

Subject to the blockers above, several implementation elements are technically sound:

* The session HMAC and password-verifier HMAC use distinct, NUL-terminated domains.
* The v3 cookie signature covers version, expiry, role, canonical actor, and method.
* A signed `method=password` cookie with a non-viewer role is rejected.
* The password HMAC parser strictly rejects malformed, uppercase, padded, quoted, or wrong-length forms.
* The password itself and stored HMAC are not used as the session-signing key.
* Rotating `ADMIN_REVIEW_TOKEN` invalidates old v3 sessions and makes the old password HMAC unusable until deliberately co-rotated.
* `ADMIN_REVIEW_PASSWORD_HMAC` was added to production preflight, the managed runtime key inventory, reconciliation planning, and parity readback.
* Documentation now accurately acknowledges historical exposure instead of claiming the password was never committed.
* The launch checklist correctly leaves materialization and runtime proof pending rather than claiming them complete.

## Gate disposition

| Gate                                                    | Current evidence                | Disposition                                                                        |
| ------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| Implementation identity and source-only patch           | Commit/tree/hash asserted       | Live PR-head/APR-only descendant comparison still required                         |
| Lint, typecheck, focused tests, diff check              | Passed on implementation commit | Insufficient alone                                                                 |
| Combined synthetic integration                          | Explicitly pending              | **Pre-merge blocker**                                                              |
| Exact-final-head GitHub CI                              | Explicitly pending              | **Pre-merge blocker**                                                              |
| Both-scope Infisical materialization and Coolify parity | Pending                         | Mandatory managed-release gate                                                     |
| Exact merge-SHA canonical staging                       | Pending                         | Mandatory before production                                                        |
| Live clean-cookie password/review provenance proof      | Pending                         | Must include role, method, effective expiry, mutation denial, and bearer rejection |
| Redis/proxy-identity rate-limit proof                   | Pending                         | Must be performed on canonical staging                                             |
| Identical-SHA guarded production verification           | Pending                         | Mandatory only after successful staging proof; rollback must remain available      |

The exact-SHA staging, reduced-session browser proof, Infisical-to-Coolify readback, and guarded production verification remain mandatory. They cannot repair the source-level AST and credential-separation defects, and they must not be represented as complete before execution.

VERDICT: DO NOT MERGE
