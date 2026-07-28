# Oriental interactive admin password security contract

## Runtime boundary

The Oriental admin console has one human-facing login endpoint and several
server-side admin APIs. The human password is a convenience credential for the
interactive login, while high-entropy managed bearer credentials retain API
authority. Infisical is canonical configuration and Coolify is a materialized
runtime copy.

## Required behavior

1. The owner-selected human password must authenticate through
   `POST /api/admin/login`, while being treated as potentially known because of
   historical repository exposure.
2. The plaintext password, a hard-coded verifier, and an unsalted password
   digest must be absent from the current implementation tree and runtime
   configuration.
3. `ADMIN_REVIEW_PASSWORD_HMAC` must be a domain-separated HMAC-SHA256 keyed by
   the high-entropy `ADMIN_REVIEW_TOKEN`.
4. The human password must never authenticate an `Authorization: Bearer`
   request and must never become the admin session-signing key.
5. Password login must sign method `password`, force role `viewer`, expire after
   thirty minutes, and be unable to perform mutations, follow-up, eval,
   maintenance, or privacy operations. Strong review-token login must sign
   method `review`, retain the configured interactive role, and expire after
   twelve hours.
6. `ADMIN_REVIEW_TOKEN` must remain at least 32 characters in production and
   distinct from the ops and privacy bearer credentials.
7. Interactive login must preserve same-origin JSON enforcement, per-IP rate
   limiting, signed HTTP-only SameSite cookies, and principal-bound roles.
8. Missing or malformed password-HMAC configuration must fail closed for the
   human password without disabling the strong review token.
9. Rotating `ADMIN_REVIEW_TOKEN` must invalidate old password HMACs and all old
   admin sessions until the managed password HMAC is deliberately co-rotated.
10. The new HMAC must be part of the complete Infisical-to-Coolify managed
    runtime inventory and production secret validation.
11. A whole-production TypeScript AST test must own the exact login-verifier
    call site, the twelve admin handlers, authorization-before-effects, and the
    private bearer verifier.
12. UI copy, API documentation, technical specifications, infrastructure
    guidance, launch checklist, and release governance must describe the same
    credential and historical-exposure boundary.

## Acceptance evidence

- Unit tests prove distinct password/review sessions, password viewer authority,
  bearer rejection, malformed-HMAC rejection, stale-key rejection, and continued
  strong-token success.
- AST tests prove the login-only verifier and authorization-before-effects call
  graph across the full production TypeScript tree.
- Secret-contract tests prove the HMAC is required and exactly 64 lowercase
  hexadecimal characters in production.
- Release-governance tests own the new managed environment key.
- Biome, strict TypeScript, focused Vitest, and diff checks pass.
- GitHub CI passes on the exact PR head.
- Hermetic APR returns an explicit merge verdict on the exact tree.

## Release contract

After merge, derive the requested password HMAC without logging either the
password or the strong token, write it to both staging and production
`/deploy/oriental-website` Infisical scopes, and run the governed release.
Deploy the exact merge SHA to canonical staging first, prove the human password
through the real browser login while also proving bearer rejection, then
promote the same SHA to production control and repeat health and login proof.
Retain the previous production SHA as the automatic rollback target.
