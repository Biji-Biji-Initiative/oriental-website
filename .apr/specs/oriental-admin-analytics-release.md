# Oriental admin analytics release — merge review

Review the combined admin-console, on-demand evaluation, consented analytics,
Search Console, and aggregate tool-latency change as one exact-tree merge gate.

## Required contract

- The authenticated admin console MUST remain functionally complete on desktop
  and mobile, with a coherent dark theme across application content and portaled
  overlays. The command palette MUST expose a named modal, trap focus, close on
  Escape, keep the background inert, and restore focus.
- On-demand evaluations MUST require the existing admin permission boundary,
  accept only a small explicit model allowlist, enforce a global cooldown, skip
  already-scored sessions for untargeted runs, bound provider retries and
  timeout, expose aggregate failure categories, and never persist or log raw
  transcripts or captured lead fields.
- GA4 MUST fail closed: no Google script or event may be sent before an explicit
  local opt-in. Denial and withdrawal MUST stop future collection, withdrawal
  MUST attempt to clear first-party analytics cookies, page locations MUST omit
  query strings and fragments, and admin/API paths MUST never be instrumented.
- The public site MUST provide an accessible English/Bahasa Malaysia privacy
  notice and a persistent way to revise analytics consent.
- GA4 and Google site-verification public identifiers MUST be wired into both
  Next.js build paths without exposing secrets. Missing or malformed values
  MUST remain safely disabled.
- Aggregate-only voice evidence MAY report per-tool names, outcomes, and latency
  percentiles, but MUST omit review/session/lead identifiers, transcripts,
  captured values, attention lists, and other visitor-level rows.
- Tool latency changes MUST preserve the existing routing truth boundary: the
  assistant can only claim a lead was sent after a successful durable handoff.
- Existing CRM, email-grounding, release-governance, canonical-host, DNS-only,
  exact-SHA, and production voice-cell contracts MUST not regress.
- This is a code merge gate. Live staging and production proof, Convex function
  deployment, Google property verification, and exact-SHA convergence can only
  follow a merge verdict. The known OpenAI organization quota failure is an
  external release caveat, not evidence that this patch should bypass review.

## Review request

Inspect the implementation and evidence adversarially. Treat privacy leakage,
analytics before consent, weak admin authorization, unbounded or duplicative
evaluation spend, inaccessible overlays, misleading tool telemetry, loss of
lead durability, broken build/deploy wiring, or regression of the current
release contracts as blockers. Do not demand post-merge live evidence during
this pre-merge gate and do not propose unrelated product work. End with exactly
`VERDICT: MERGE ADMIN ANALYTICS` or `VERDICT: DO NOT MERGE`.
