# Oriental interactive admin password security contract

## Runtime boundary

The Oriental admin console has one human-facing login endpoint and several
server-side admin APIs. The human password is a convenience credential for the
interactive login, while high-entropy managed bearer credentials retain API
authority. Infisical is canonical configuration and Coolify is a materialized
runtime copy.

## Required behavior

1. The owner-selected human password must authenticate through
   `POST /api/admin/login`.
2. The plaintext password, a hard-coded verifier, and an unsalted password
   digest must not be committed or stored in runtime configuration.
3. `ADMIN_REVIEW_PASSWORD_HMAC` must be a domain-separated HMAC-SHA256 keyed by
   the high-entropy `ADMIN_REVIEW_TOKEN`.
4. The human password must never authenticate an `Authorization: Bearer`
   request and must never become the admin session-signing key.
5. `ADMIN_REVIEW_TOKEN` must remain at least 32 characters in production and
   distinct from the ops and privacy bearer credentials.
6. Interactive login must preserve same-origin JSON enforcement, per-IP rate
   limiting, signed HTTP-only SameSite cookies, and principal-bound roles.
7. Missing or malformed password-HMAC configuration must fail closed for the
   human password without disabling the strong review token.
8. Rotating `ADMIN_REVIEW_TOKEN` must invalidate an HMAC derived with the old
   key until the managed password HMAC is deliberately rotated with it.
9. The new HMAC must be part of the complete Infisical-to-Coolify managed
   runtime inventory and production secret validation.
10. UI copy, API documentation, technical specifications, infrastructure
    guidance, launch checklist, and release governance must describe the same
    credential boundary.

## Acceptance evidence

- Unit tests prove password login success, bearer rejection, malformed-HMAC
  rejection, stale-key rejection, and continued strong-token success.
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
