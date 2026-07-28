## Release-blocking findings

### 1. The supplied artifacts do not identify one exact implementation tree

The evidence manifest identifies implementation commit `f21791098715a4c28db2695227784c78b8f4afad` and tree `f6c13072aadbcbb4c4e0b0ffcc4439c3389ac151` (`.apr/evidence/oriental-admin-password-security.md:5-14`). The purported authoritative mail patch instead begins:

```text
From f217910401994d3d01fdaec956c0bc7a25efadde
```

at `.apr/evidence/0001-fix-auth-manage-interactive-password.patch:1`.

Those are different commits. No supplied proof establishes that the second commit has the same parent, diff, or resulting tree as the requested implementation commit.

There is also conflicting content for `.apr/evidence/oriental-admin-password-security.md`:

* The mail patch creates an 88-line version containing an obsolete `verifyAdminToken()` example that accepts the password and labels every success `review_bearer` (`0001-fix-auth-manage-interactive-password.patch:53-68`).
* The separately supplied 171-line manifest describes the newer `verifyAdminLoginCredential()` implementation and distinct `interactive_password` result.

The focused-test totals also conflict: 48 tests in the mail-patch version versus 57 in the separate manifest.

For an exact-tree admission review, this is fail-closed. Regenerate the complete mail patch directly from `f21791098715a4c28db2695227784c78b8f4afad`, verify its parent and resulting tree, update the in-tree evidence to match the code, and hash that regenerated artifact.

### 2. A potentially known password still has unrestricted session-minting authority

The bearer boundary itself is preserved, but the claimed containment of session authority is not.

`verifyAdminLoginCredential()` gives both the strong review token and the convenience password the same configured actor, role, principal, and twelve-hour expiry (`lib/server/admin-auth.ts`, mail-patch lines 524-544; new source approximately lines 31-47). The login endpoint then turns either credential into the same signed session.

The API contract explicitly says that this cookie authenticates both the UI and ordinary `/api/admin/*` routes (`docs/06-API-CONTRACTS.md:447-453`). The documented session format contains expiry, role, actor, and signature, but not the authentication method (`.apr/evidence/oriental-admin-password-security.md:72-75`). Consequently, the transient `interactive_password` provenance does not survive session issuance and cannot support reduced permissions, shorter lifetime, step-up authorization, or reliable downstream attribution.

The listed controls do not contain use of an already-known password:

* Same-origin JSON enforcement is a CSRF control. A direct HTTP client can supply the expected `Origin` and `Content-Type`.
* Eight attempts per IP slow guessing. A party that already knows the password needs one request.
* Bearer rejection prevents using the password directly in `Authorization`, but the caller can first exchange it for the cookie that authorizes the same APIs.
* Domain-separated HMACs protect the stored verifier and prevent key-purpose confusion. They do not increase the authentication strength of a known online credential.

Thus the implementation keeps the bearer token and session-signing key cryptographically independent from the password, but it lowers **session-issuance assurance** to the potentially exposed password. The owner’s acceptance can document that residual risk; it cannot accurately characterize same-origin checks and rate limiting as containing it.

Retaining the required password safely needs an independent boundary before full session issuance—for example, an identity-aware proxy or VPN, a second independent factor, or a password-issued session with materially reduced permissions and lifetime plus strong-token/SSO step-up for sensitive operations. The authentication method should also be signed into the session and recorded in security audit events.

### 3. The login-only governance test has straightforward false-green paths

The new governance assertion is lexical:

```ts
expect(source, routePath).toContain("verifyAdminPermission");
expect(source, routePath).not.toContain("verifyAdminLoginCredential");
```

at `tests/release-governance.test.ts`, mail-patch lines 882-894, approximately source lines 41-53.

It does not prove the claimed boundary:

* A comment, dead branch, or unused import containing `verifyAdminPermission` passes.
* It does not prove authorization occurs before route effects.
* It does not reject a route that performs another authentication path alongside the expected string.
* It searches only `app/api/admin/**/route.ts`, not server actions, route files with another extension, shared production helpers, or other call sites.
* It does not assert the claimed inventory count of exactly twelve handlers.
* It does not prove that `verifyAdminLoginCredential` has exactly one production import or invocation.

Because login-only use is the principal compensating boundary for a potentially known credential, a string-presence test is insufficient. Centralize admin handlers behind one authorization wrapper, or use an AST-based whole-production-tree check that verifies exact imports and invocations, asserts the governed handler inventory, and rejects alternate authorization implementations.

### 4. Mandatory pre-merge exact-head validation has not been completed

The manifest records local lint, type checking, and a focused suite, but it also says:

* the combined release tree validation occurred before this hardened implementation was integrated; and
* the combined tree must be rebuilt and exact-head GitHub CI remains mandatory.

That admission is explicit at `.apr/evidence/oriental-admin-password-security.md:148-158`.

Therefore the earlier 2,208-test result and production build do not validate this implementation commit or the final PR head. This is a pre-merge gate, unlike staging and production secret materialization. Merge requires:

1. Full test and production-build validation with this implementation integrated.
2. GitHub CI success on the final exact PR head.
3. Proof that any descendant of the implementation commit changes only `.apr/`.
4. Equality between the remote PR head, reviewed worktree, and regenerated exact-tree evidence.

### 5. Release documentation already marks an impossible post-merge condition complete

`docs/09-LAUNCH-CHECKLIST.md:43-49` retains a checked `[x]` item asserting that `ADMIN_REVIEW_PASSWORD_HMAC` is present in `/deploy/oriental-website`.

The evidence and release contract correctly state that staging and production HMAC materialization can occur only after merge. The checklist therefore records a mandatory future operation as already satisfied. That is a concrete false-green release path.

The item must remain unchecked or explicitly marked “post-merge pending” until both managed scopes have been written, reconciled, and read back.

Several operational documents also say the plaintext password is “never committed.” Given the owner-confirmed repository history, that wording is false. It should say that the plaintext is absent from the current tree and runtime configuration, while the historical value is treated as exposed. The distinction is central to the accepted-risk record.

## Controls that are sound in the reviewed diff

The code-level cryptographic and bearer separation is otherwise well designed:

* `verifyAdminBearerToken` remains separate and considers only `ADMIN_REVIEW_TOKEN`, `OPS_AUTOMATION_TOKEN`, and `PRIVACY_ADMIN_TOKEN`.
* Password and session HMAC operations use different NUL-terminated domains.
* The password-HMAC value is validated as exactly 64 lowercase hexadecimal characters without trimming or quote normalization.
* Malformed HMAC configuration fails closed for password login while leaving the strong review token usable.
* Rotating `ADMIN_REVIEW_TOKEN` invalidates both existing sessions and the previous password HMAC.
* The new HMAC is included in production secret checking, the managed environment inventory, mutation planning, and parity readback.
* The patch contains no apparent owner-selected plaintext password; the password strings in tests are fixtures.

These properties protect bearer credentials, signing keys, and configuration integrity. They do not cure the weaker session-minting path or the incomplete exact-tree proof.

## Post-merge gates that must remain mandatory

After the source and pre-merge blockers are resolved, release still requires the stated gates:

1. Derive and materialize the HMAC without logging either input, reconcile the complete staging environment, and prove exact readback.
2. Deploy the exact merge SHA to canonical staging.
3. From a fresh client with no pre-existing admin cookie, prove password login, valid review-token login, and password rejection as a bearer.
4. Verify the actual cookie attributes and running SHA.
5. Prove Redis-backed rate limiting through the real Traefik forwarding chain, including stable buckets under spoofed earlier XFF hops and distinct buckets for distinct proxy-observed clients.
6. Promote the identical SHA to production, repeat authentication and managed-environment verification, and retain the previous production SHA as rollback authority.

Those post-merge checks cannot repair an unverified source identity, missing final-head CI, a false-green governance assertion, or a potentially known credential minting an undifferentiated privileged session.

VERDICT: DO NOT MERGE
