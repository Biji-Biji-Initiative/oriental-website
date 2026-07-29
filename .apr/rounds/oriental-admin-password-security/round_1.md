## Release-blocking findings

### 1. The review is not bound to an identifiable exact tree

`.apr/evidence/oriental-admin-password-security.md:5-8` says the hermetic worktree must be compared with the live PR head, but it records neither:

* the full 40-character branch-head SHA,
* the live PR-head SHA,
* the equality result,
* nor a clean-worktree/tree-object identity.

Only governance documents and a short implementation excerpt were supplied. The actual `lib/server/admin-auth.ts`, login route, bearer middleware, session signer, reconciliation tooling, UI, API documentation, and tests are not present. Consequently, the evidence does **not** establish branch-wide absence of a plaintext password, hard-coded verifier, or unsalted digest.

This is especially significant because `.apr/evidence/oriental-admin-password-security.md:5-8` acknowledges a previous hard-coded-digest commit. Removing a verifier from the current file does not prove that the commit is absent from the branch ancestry or other merge-reachable objects. It also does not revoke the associated password if that digest was derived from the intended owner password.

Before merge, the evidence must bind all checks to one immutable SHA, scan the complete tree and reachable branch history, and establish that any password represented by the previous verifier will never be materialized after merge.

### 2. The interactive-only credential boundary is not established

The shown implementation exports a generic verifier that accepts either the strong token or the human password:

```ts
export function verifyAdminToken(token: string | null | undefined)
```

and:

```ts
if (!constantTimeEqual(token, expected) && !verifyInteractivePassword(token, expected))
```

`.apr/evidence/oriental-admin-password-security.md:15-30`

That function itself enforces none of the controls that are supposed to confine password use to interactive login: no same-origin check, JSON check, rate-limit decision, or route identity. Those controls are only asserted to exist in the login caller at `.apr/evidence/oriental-admin-password-security.md:55-58`.

The complete call-site inventory is missing. Therefore, the supplied evidence does not prove that:

* every `Authorization: Bearer` path uses only `verifyAdminBearerToken`,
* no admin API or middleware still calls `verifyAdminToken`,
* no automation route can submit the password through a token-shaped parameter,
* and no session or internal helper directly invokes the mixed verifier.

The result also always reports:

```ts
credential: "review_bearer"
```

including after password authentication, at `.apr/evidence/oriental-admin-password-security.md:23-29`. That collapses password and bearer provenance. Unless the omitted authorization code demonstrably ignores this classification, a password-authenticated session can be misrepresented to downstream policy or audit code as having used the high-entropy review bearer.

The robust boundary is a login-specific verifier, private to the interactive authentication path, returning a distinct method such as `interactive_password` or `interactive_review_token`. Authorization-header verification must remain a separate API that cannot evaluate the password HMAC.

### 3. The cryptographic excerpt is reasonable, but the requested cryptographic review is incomplete

The portion actually shown is sound in several respects:

* `"oriental-admin-password:v1\0"` is a fixed, versioned domain separator.
* The verifier is HMAC-SHA256 keyed by `ADMIN_REVIEW_TOKEN`, rather than an unkeyed password hash.
* The expected value must be exactly 64 lowercase hexadecimal characters.
* Missing or malformed HMAC configuration fails closed for the password path.
* A token rotation naturally makes an HMAC produced with the old key fail.

`.apr/evidence/oriental-admin-password-security.md:33-47`

However, this does not complete the requested review:

* The implementation of `constantTimeEqual` is absent. Its handling of unequal-length token inputs and fixed-length HMAC inputs cannot be inspected.
* The session-signing implementation is absent. The assertion that `signingSecret()` reads only `ADMIN_REVIEW_TOKEN` at `.apr/evidence/oriental-admin-password-security.md:50-53` does not show the signed format, domain separation, claim validation, expiry validation, or comparison implementation.
* There is no source proof that old sessions become invalid immediately after token rotation, with no previous-key fallback.
* There is no proof that the HMAC derivation tooling uses exactly the same UTF-8 byte sequence and domain prefix without normalization, newline insertion, shell-history exposure, or argument logging.

Thus the excerpt supports the proposed password-HMAC design, but it does not establish the complete domain-separation, constant-time, or rotation properties requested.

### 4. Managed Infisical-to-Coolify reconciliation is asserted, not reviewed

The evidence claims that `ADMIN_REVIEW_PASSWORD_HMAC` was added to the managed inventory and production validation at `.apr/evidence/oriental-admin-password-security.md:60-72`. `AGENTS.md:178-193` describes complete-scope reconciliation, readback, and governed retirement behavior.

None of the governing implementation is supplied. The review therefore cannot verify that:

* both staging and production own the new key,
* a missing newly introduced value fails closed instead of silently omitting or clearing it,
* reconciliation reads back the materialized Coolify value and scope metadata,
* token and HMAC co-rotation are reconciled as one approved configuration set,
* secret values are excluded from logs, command arguments, diffs, and diagnostics,
* rollback cannot restore a mismatched token/HMAC pair,
* and the new key is not accidentally treated as optional or retired.

Secret materialization correctly remains post-merge, but the **source code that governs that materialization** must still be reviewed and tested before merge.

### 5. Exact-head verification is explicitly unfinished

`.apr/evidence/oriental-admin-password-security.md:76-80` reports focused checks, but no output is bound to an immutable head SHA. More importantly:

* line 81 says exact-head GitHub CI is still required;
* lines 82-84 say the full combined release tree will be tested only after integration because PR #78 supplies portability fixes.

A future combined tree is not evidence for this exact branch head. If PR #78 is required, it must first enter the reviewed base or be incorporated into this branch; then all required checks must run against the resulting immutable head. The merge decision cannot rely on tests intended to occur after the source under review changes.

This directly conflicts with the exact-head acceptance requirements in `.apr/specs/oriental-admin-password-security.md:35-44`.

### 6. The negative-test summary does not prove the requested boundaries

The evidence names password success, bearer rejection, malformed-HMAC rejection, and stale-key cases at `.apr/evidence/oriental-admin-password-security.md:74-84`, but the tests themselves are absent. At minimum, exact-head source evidence must demonstrate:

* the human password is rejected as `Authorization: Bearer` by every relevant admin endpoint;
* all bearer-only automation, privacy, retention, SLA, and eval routes reject it;
* missing, short, long, uppercase, whitespace-padded, and nonhex HMAC values fail closed;
* a missing or malformed password HMAC does not disable the valid review token;
* missing, cross-origin, malformed-origin, and non-JSON login requests fail before authentication;
* the ninth attempt inside the fifteen-minute window is rejected;
* spoofed forwarding headers cannot create arbitrary rate-limit identities;
* an old password HMAC fails after token rotation;
* an old signed session fails after token rotation;
* the newly co-rotated token/HMAC pair succeeds;
* managed-environment inventory and readback tests own the new key.

A prose count of “4 files and 48 tests” is not a substitute for inspecting those assertions and confirming that they execute against the exact head.

## Post-merge gates remain mandatory

The post-merge sequence in `.apr/specs/oriental-admin-password-security.md:46-54` and `.apr/evidence/oriental-admin-password-security.md:86-88` remains appropriate and must not be converted into pre-merge secret materialization:

1. Derive only `ADMIN_REVIEW_PASSWORD_HMAC`, without logging the password or `ADMIN_REVIEW_TOKEN`. Any password represented by the previously committed verifier must be retired rather than reused.
2. Write the HMAC to the governed staging and production Infisical scopes.
3. Reconcile and read back the complete managed Coolify environment.
4. Deploy the exact merge SHA to canonical staging.
5. Prove real-browser password login, password rejection as a bearer, valid review-token behavior, cookie security, exact running SHA, and rate-limit behavior.
6. Promote the same SHA to production control and repeat health, authentication, and managed-environment verification while retaining the previous production SHA as the rollback target.

Those runtime gates cannot repair missing exact-tree source proof. The supplied record supports the basic keyed-HMAC direction, but it does not support the requested branch-wide security confirmations or an exact-head merge authorization.

VERDICT: DO NOT MERGE
