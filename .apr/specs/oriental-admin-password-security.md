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
   thirty minutes, and authorize only a dedicated PII-free aggregate service and
   same-origin logout. The aggregate Convex query and Next adapter must expose a
   fixed metrics DTO and must never return raw leads, emails, transcripts, voice
   details, events, analytics/queues, or mutation capability to Next or the
   password principal. Trusted Convex execution may process a bounded set of
   payload-safe rows in memory solely to calculate those aggregates; that
   residual compute and inference exposure is explicitly accepted and must not
   be represented as a pre-aggregated counter architecture. Strong review-token
   login must sign method `review`, retain the configured interactive role, and
   expire after twelve hours.
6. `ADMIN_REVIEW_TOKEN` must remain at least 32 characters in production and
   distinct from the ops and privacy bearer credentials. Production validation
   and runtime authentication must also reject any configuration where the
   password HMAC proves the password equals any review, ops, or privacy bearer.
7. Interactive login must preserve same-origin JSON enforcement, per-IP rate
   limiting, signed HTTP-only SameSite cookies, and principal-bound roles.
8. Missing or malformed password-HMAC configuration must fail closed for the
   human password without disabling the strong review token.
9. Rotating `ADMIN_REVIEW_TOKEN` must invalidate old password HMACs and all old
   admin sessions until the managed password HMAC is deliberately co-rotated.
10. The new HMAC must be part of the complete Infisical-to-Coolify managed
    runtime inventory and production secret validation.
11. A whole-production AST test must pin the exact path/method/permission map
    across every supported extension and require every non-login HTTP export to
    be an immutable simple-identifier const directly initialized by the
    structural permission wrapper. Hostile mutable assignment, destructuring,
    alias, re-export, namespace/default/import-equals/dynamic/relative/CommonJS
    import, CommonJS object/property export, extra login method, wrong literal
    permission, named callback, and manual positional-auth fixtures must fail.
12. Session minting must require a runtime-unforgeable proof created only by
    successful credential verification, handle password and review provenance
    exhaustively, own no default identity, and have exactly one production call
    site in the login route. TypeScript module resolution must close alternative
    specifiers across the complete production runtime graph. The signer and
    bearer verifier remain private.
13. UI copy, API documentation, technical specifications, infrastructure
    guidance, launch checklist, and release governance must describe the same
    credential and historical-exposure boundary.

## Acceptance evidence

- Unit tests prove distinct password/review sessions, dedicated aggregate-only
  trusted-Convex computation with strict Convex and Next DTO validation, raw
  customer-data and mutation rejection, bearer rejection, pre-existing-cookie
  all-bearer collision failure, forged-mint rejection, malformed-HMAC rejection,
  both-session stale-key rejection, invalid-Authorization no-fallback, and
  distinct trusted rate-limit identities.
- AST tests prove login-only verifier/mint authority and direct structural
  wrapping for every non-login HTTP export across the exact canonical route
  inventory, including hostile fixtures.
- Secret-contract tests prove the HMAC is required, exactly 64 lowercase
  hexadecimal characters in production, and distinct from every bearer value.
- Release-governance tests own the new managed environment key.
- Biome, strict TypeScript, focused Vitest, and diff checks pass.
- GitHub CI passes on the exact PR head.
- Hermetic APR returns an explicit merge verdict on the exact tree.

## Release contract

After merge, derive the requested password HMAC without logging either the
password or the strong token, write it to both staging and production
`/deploy/oriental-website` Infisical scopes, and run the governed release.
Deploy the exact merge SHA to canonical staging first, prove the human password
through the real browser login while also proving aggregate-only output, raw
customer-data and mutation `403` responses, and bearer rejection, then
promote the same SHA to production control and repeat health and login proof.
Retain the previous production SHA as the automatic rollback target.
