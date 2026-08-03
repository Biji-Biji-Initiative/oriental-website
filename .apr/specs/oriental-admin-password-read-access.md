# Oriental admin password read-access contract

## Objective

The existing interactive admin password must open the complete Enquiry CRM in
read-only mode. Password viewers may inspect customer records, email addresses,
conversation transcripts, and voice-session details, but must not mutate any
lead, voice session, evaluation, archive state, workflow state, or bulk state.

## Required security boundary

1. Password login remains limited to `POST /api/admin/login` and never
   authenticates an `Authorization: Bearer` request.
2. Password login mints a signed, HTTP-only, SameSite session with
   `method=password`, role `viewer`, and a maximum lifetime of thirty minutes.
3. The canonical permission registry grants the password principal only
   `dashboard.aggregate`, `dashboard.read`, `leads.read`, `voice.read`, and
   `session.logout`.
4. The password principal has no permission whose name ends in `.write` and no
   `evals.run` permission. Every mutation route must continue to reject it
   server-side with `403`.
5. Full CRM rendering must be gated by `dashboard.read`. Voice-detail reads
   must remain gated by `voice.read`.
6. The server must derive authorization from the same canonical permission
   registry used for capability rendering. The UI may hide unavailable controls
   for clarity, but hidden controls are never the security boundary.
7. Read-only UI must retain useful inspection features: overview, customer
   records, emails, transcripts, voice details, search, filtering, sorting,
   pagination, and record navigation.
8. Read-only UI must not render row selection, bulk actions, workflow mutation
   forms, lead action menus, evaluation triggers, archive controls, or voice
   follow-up state controls.
9. Review-token sessions retain their existing read and mutation capabilities.
10. Existing same-origin enforcement, rate limiting, password HMAC validation,
    cookie signing, token separation, and production secret validation remain
    unchanged.

## Acceptance evidence

- Unit tests prove all required password read permissions and deny every
  mutation permission.
- Component tests prove actual fixture customer names and email addresses render
  for password viewers while mutation controls do not.
- Browser tests prove password-as-bearer is rejected, raw CRM and voice-detail
  reads return `200`, and a real mutation request returns `403`.
- Lint, strict TypeScript, the full Vitest suite, production build, and focused
  Chrome browser proof pass.
- A hermetic APR run on a designated remote host returns an explicit merge
  verdict for the exact implementation commit and tree.
- GitHub CI passes on the exact pull-request head before merge.

## Release gates

Deploy the exact merge SHA to staging first and then production. On each target,
run the governed admin release proof with the managed password without logging
the credential. The proof must confirm the password session can read nonempty
CRM and voice data, cannot act as a bearer, and receives `403` for mutation.
Production must run the identical SHA proven on staging.
