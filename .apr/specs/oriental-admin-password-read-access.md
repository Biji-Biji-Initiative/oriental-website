# Oriental admin password full-access contract

## Objective

The managed interactive password is the human administrator credential for the
Oriental Enquiry CRM. A successful password login must expose the complete
admin console and every governed admin action.

## Required security boundary

1. Password login remains limited to `POST /api/admin/login` and never
   authenticates an `Authorization: Bearer` request.
2. Password login mints a signed, HTTP-only, SameSite session with
   `method=password`, role `admin`, and a maximum lifetime of thirty minutes.
3. The password principal receives every permission in the canonical
   `ADMIN_PERMISSIONS` registry, including CRM reads and writes, bulk actions,
   archive/export, voice follow-up, evaluations, SLA/retention, and privacy
   deletion.
4. Cookie-authenticated mutations continue to require same-origin JSON. Full
   authorization must not weaken CSRF checks, password rate limiting, HMAC
   validation, session signing, token separation, or collision detection.
5. The complete admin UI must render after password login, including selection,
   row actions, workflow forms, bulk controls, evaluation triggers, and voice
   follow-up controls.
6. Mutation admission is proven without changing a real customer record by
   sending an authenticated same-origin request with a deliberately invalid
   payload and requiring application validation `400`, not auth `401/403`.
7. Review, ops, and privacy bearer credentials retain their existing scoped
   behavior for API and scheduled automation. The human password itself remains
   invalid as bearer auth.
8. Plaintext password material must remain absent from source, managed
   environments, runtime configuration, logs, tests, and review artifacts.

## Acceptance evidence

- Unit tests prove the password login and cookie are role `admin`, all canonical
  permissions are granted, bearer use is rejected, and same-origin JSON remains
  mandatory for mutations.
- Component tests prove fixture customer data and mutation controls render for
  a password session.
- Browser tests prove nonempty CRM and voice reads, password bearer rejection,
  full admin UI controls, and protected mutation admission reaching payload
  validation without mutating a real record.
- Lint, strict TypeScript, full Vitest, production build, exact-head GitHub CI,
  and hermetic exact-tree review pass.

## Release gates

Deploy the exact merge SHA to staging first and production second. On each
target, enter the password only through hidden input and require the governed
admin release proof to show role `admin`, nonempty reads, bearer rejection,
protected mutation admission, shared Redis limiting, and zero skipped/flaky/
unexpected tests. Production must run the identical SHA proven on staging.
