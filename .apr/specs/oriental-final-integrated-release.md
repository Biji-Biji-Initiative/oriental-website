# Oriental final integrated release — merge review

Review the combined admin, analytics, voice, brand-motion, telemetry, and
deployment-governance patch as one exact-tree merge gate.

## Required contract

- The authenticated admin console MUST remain complete and accessible on
  desktop and mobile. Portaled overlays MUST inherit the admin theme; modal
  focus, Escape, inert-background, and focus-restoration behavior MUST hold.
- On-demand voice evaluations MUST keep the admin authorization boundary,
  explicit model allowlist, global cost lock, bounded batch/retries/timeouts,
  aggregate error categories, and transcript/captured-field privacy boundary.
- GA4 MUST remain fail-closed before explicit local consent, omit query strings
  and fragments, stop future collection after withdrawal, attempt analytics
  cookie cleanup, and remain absent from admin/API traffic. Search Console and
  GA public identifiers MUST be validated and governed in both build paths.
- The approved reactive Mereka point-cloud M and entrance loader MUST render on
  both canonical hosts without creating a bypassable experiment flag. The
  voice dialog MUST keep its primary action initially visible, avoid horizontal
  overflow, and preserve independent-pane scrolling at the documented mobile,
  tablet, landscape, and desktop breakpoints.
- Voice capture MUST preserve correction invalidation, typed-only handoff state,
  stale-response protection, deterministic clear-all behavior, and the durable
  lead truth boundary. `clear_fields` MUST remain the canonical schema,
  persistence, and aggregate-telemetry label; no lossy alias is permitted.
- Email capture MUST keep one visible editor beside the voice controls on
  mobile/short-landscape, place email first in desktop DOM/tab order, require
  only a valid email for routing, preserve focus across the 1024px layout
  boundary, and never present an invalid or medium-confidence address as
  confirmed. Voice-command submission MUST require a valid signed voice-review
  credential; Turnstile alone is not an equivalent proof.
- Intake analytics MUST distinguish first explicit CTA surface, open method,
  submit method, and fixed per-field voice/manual/mixed provenance without
  sending values, transcripts, identifiers, URLs, timestamps, or free text.
  Every conversion and funnel event MUST share the same explicit-consent check,
  event-specific type contract, bounded runtime allowlist, and post-withdrawal
  fail-closed behavior. Server persistence MUST reject impossible source and
  submission-method combinations.
- Tool timing MUST remain PII-free and aggregate execution, response-to-call,
  and response-to-result latency overall and by canonical tool. It MUST NOT
  weaken durable routing or expose arguments, contact data, IDs, transcripts,
  raw timestamps, or visitor-level rows.
- Candidate staging MUST support a clean picker-off evidence mode independently
  from the explicitly approved picker-on audition mode. Production MUST reject
  candidate and audition configurations and remain the control model cell.
- Staging and production deployers MUST use optimistic-lock exact SHAs,
  reconcile the complete approved Infisical runtime scope without printing
  secrets, retire formerly managed keys safely, preserve build/runtime scopes,
  and verify the resulting configuration. Production MUST additionally require
  Coolify `running:healthy` and health ownership on `127.0.0.1`.
- The release verifier MUST prove canonical host behavior, exact revision and
  voice cells, picker state, Google metadata, consent-gated GA loading, admin GA
  exclusion, DNS-only public responses, and legacy redirects. Deployment order
  MUST put changed Convex validators/functions before the web image.
- The release MUST keep production on `gpt-realtime-2` control. The staging
  `gpt-realtime-2.1` candidate is not promotion evidence until clean runtime
  samples and human Malaysian quality evidence satisfy the documented gates.
  Known upstream Realtime quota failures MUST be reported honestly.
- Scheduled evaluation and ownership-SLA operations MUST use the canonical
  production host, valid API limits, the governed admin credential, and
  machine-checkable responses. Evaluation auto-on-close MUST be part of the
  managed environment contract, retain bounded cost/concurrency controls, and
  expose no transcript or captured-field content in workflow output or logs.

## Review request

Inspect the exact implementation and evidence adversarially. Treat privacy
leakage, analytics before consent, weak authorization, unbounded evaluation
spend, inaccessible or overflowing UI, misleading brand/config gates, lost
typed state, stale or lossy capture, misleading telemetry, weakened lead
durability, incomplete secret convergence, unsafe production model changes, or
broken exact-SHA deployment proof as blockers. This is a code merge gate: do
not require the post-merge deployment to have happened, and do not mistake an
external OpenAI quota failure for permission to bypass review.

End with exactly `VERDICT: MERGE ORIENTAL RELEASE` or
`VERDICT: DO NOT MERGE`.
