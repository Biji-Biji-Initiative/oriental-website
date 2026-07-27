# Oriental interactive admin password implementation evidence

## Exact source head

APR must compare `git rev-parse HEAD` in its clean hermetic worktree with the
live PR head before review. The previous hard-coded-digest commit was replaced
before merge. The current tree contains no plaintext production password and
no hard-coded password verifier.

## Runtime implementation

`lib/server/admin-auth.ts` keeps the strong token as the required root
credential:

```ts
export function verifyAdminToken(token: string | null | undefined): AdminAuthState {
  const expected = readEnv("ADMIN_REVIEW_TOKEN");
  if (!expected) return { ok: false, reason: "unconfigured" };
  if (!token) return { ok: false, reason: "missing" };
  if (!constantTimeEqual(token, expected) && !verifyInteractivePassword(token, expected)) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    ...configuredAdminIdentity(),
    credential: "review_bearer",
    expiresAt: Date.now() + sessionTtlMs,
    principal: "interactive",
  };
}
```

The alternative password path uses a fixed domain separator and a
secret-managed HMAC:

```ts
const adminPasswordHmacDomain = "oriental-admin-password:v1\0";

function verifyInteractivePassword(password: string, signingKey: string) {
  const expectedHmac = readEnv("ADMIN_REVIEW_PASSWORD_HMAC");
  if (!expectedHmac || !/^[a-f0-9]{64}$/.test(expectedHmac)) return false;
  const actualHmac = createHmac("sha256", signingKey)
    .update(adminPasswordHmacDomain)
    .update(password)
    .digest("hex");
  return constantTimeEqual(actualHmac, expectedHmac);
}
```

`verifyAdminBearerToken` remains separate and lists only
`ADMIN_REVIEW_TOKEN`, `OPS_AUTOMATION_TOKEN`, and `PRIVACY_ADMIN_TOKEN`.
Session signatures continue to call `signingSecret()`, which reads only
`ADMIN_REVIEW_TOKEN`.

`POST /api/admin/login` is unchanged around the verifier: it rejects
cross-origin or non-JSON requests, hashes the trusted-proxy client identity,
allows eight attempts per fifteen minutes, and issues an HTTP-only SameSite
session only after successful verification.

## Managed release and documentation

- `ADMIN_REVIEW_PASSWORD_HMAC` is included in
  `MANAGED_APPLICATION_ENVIRONMENT_KEYS`, so staging and production deployers
  reconcile it from Infisical and read back governed scope metadata.
- Production `check-secrets` requires a lowercase 64-hex HMAC.
- The existing 32-character minimum and distinctness gates continue to apply
  only to the three bearer credentials.
- The login UI says "Password or review token" while preserving password input
  behavior.
- The env example, README, technical spec, API contract, infrastructure doc,
  launch checklist, runbook, and agent guide describe the same boundary and
  token/HMAC co-rotation requirement.

## Verification completed

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- Focused Vitest passed: 4 files and 48 tests, including positive password
  login and negative bearer, malformed-HMAC, and stale-key cases.
- `git diff --check` passed.
- GitHub CI is required on the pushed exact head before merge.
- The full combined release tree will be tested after PR integration because
  PR #78 supplies the repository's Node 26 Web Storage and BSD regex
  portability fixes.

Post-merge Infisical mutation, exact-SHA staging deployment, real browser
password proof, production promotion, and rollback readiness remain mandatory
release gates.
