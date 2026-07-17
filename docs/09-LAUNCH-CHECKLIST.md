# 09 — Launch Checklist

The pre-launch gate. Each row is a binary check. No subjective items —
those go to [`10-ROADMAP.md`](./10-ROADMAP.md).

Use this on the day of soft-launch and again 24 hours before public-launch.

Evidence status on 2026-07-16: engineering release
`bb8e2673e5f129f342fba78f3eb653a54de8763b` was proven on both canonical hosts
and remains the production release. Shared staging can move independently for a
controlled experiment, so its current SHA MUST be read from `/api/health`
rather than inferred from this historical record. The instant-voice product
outcome remains evidence-gated: the corpus is baseline/control/low only while
grounded adaptive email capture is the approved policy, and the
promotion evaluator reports `insufficient_data`. Unchecked human, legal,
listening, data-retention, and availability gates are real handoff work; they
MUST NOT be reported as complete.

---

## Code & deploy

- [x] `main` branch builds clean in Coolify
- [ ] Image size < 220 MB
- [x] `pnpm exec convex deploy` completed with the production deploy key
- [x] `/api/health` returns `200` for 5 consecutive checks on both canonical hosts
- [x] `/api/health` reports the expected deployed `version` commit and `convex: true`
- [x] Cloudflare DNS for both canonical hosts resolves directly to Coolify origin `194.233.71.200`
- [x] Coolify Traefik serves valid Let's Encrypt certificates for both canonical hosts
- [x] Cloudflare proxy/cache/WAF are intentionally not on the request path; records are DNS-only
- [x] Coolify API deployment from a frozen `main` SHA has produced exact-SHA releases
- [x] Coolify health probes `127.0.0.1:3000` and the runtime image binds `HOSTNAME=0.0.0.0`

## Secrets

- [x] Infisical project `6bfac905-9bb1-449e-8be8-f25f9634802b` has the production runtime keys from
      [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) §5 populated in `/deploy/oriental-website` for `prod`
- [ ] Coolify machine identity has read-only access to `/deploy/oriental-website`
- [ ] CI/check machine identity has read-only access where used
- [ ] Rotation calendar reminder set for OPENAI / AWS keys (90 days)
- [ ] Populate an isolated `dev` scope and dedicated staging upstream services; the staging Infisical contract exists, but its Convex/notification accounts are still shared
- [x] `REDIS_URL` is present in production and API logs show `rateLimitStore: "redis"`
- [x] `COOLIFY_ORIENTAL_APPLICATION_UUID` is set to `mtrl2z6a7zvoyevxvufpntij` for deploy scripts
- [x] Distinct `ADMIN_REVIEW_TOKEN`, `OPS_AUTOMATION_TOKEN`, and
      `PRIVACY_ADMIN_TOKEN` credentials plus explicit `ADMIN_REVIEW_ROLE` /
      `ADMIN_REVIEW_ACTOR` are present in `/deploy/oriental-website`
- [x] Sentry `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, and
      `SENTRY_PROJECT=oriental-website` are present
- [x] `OPS_ALERT_SLACK_CHANNEL_ID=C01AVSGACFN` targets `#tech-team-test`
- [ ] Governed production deploy reads back the exact managed GA4 and Google
      verification values with both Coolify build-time and runtime enabled

## Optional Cloudflare Turnstile

- [x] `TURNSTILE_ENFORCEMENT=relaxed` is explicit in the managed staging and
      production contract; Redis-backed route limits remain active
- [x] Client Turnstile UI is deliberately disabled; Redis remains the active abuse-control layer
- [x] Site and secret keys are held in Infisical for a deliberate future enablement
- [x] Required-enforcement tests reject missing and tampered tokens for unsigned form/newsletter intake
- [x] Signed voice handoffs remain valid without a Turnstile token

## Convex

- [ ] `convex/schema.ts` deployed to production
- [ ] Convex `leads.recordVoiceSession`, `leads.recordLeadNotification`,
      `leads.reviewDashboard`, and `leads.updateLeadWorkflow` are deployed before
      `/admin/session-review` is used
- [ ] `leads` table accepts a staging/prod test lead
- [ ] `leadEvents` receives the matching `created` event
- [ ] `CONVEX_INGEST_SECRET` rejects an invalid secret
- [x] Runtime retention windows and verified deletion handling are documented
- [ ] Backup/export ownership and restore-time retention reapplication are assigned

## OpenAI Realtime

- [x] `/api/voice/session` has minted working ephemeral tokens in staging
- [ ] WebRTC handshake completes in < 2s on stable broadband
- [ ] Tool calls `set_partner_type` / `capture_fields` / `lookup_oriental` /
      `summarise_lead` / `route_to_team` / `wait_for_user` fire correctly in a staged conversation
- [x] `capture_fields` retains valid fields and returns ungrounded identity fields in `rejectedFields`; duplicate keys reject the batch
- [ ] Client uses the returned duration policy and stops microphone/WebRTC at 20s idle and 600s max by default
- [ ] With `VOICE_SESSION_DAILY_LIMIT=3` in a controlled environment, the 4th minted session/IP/day returns `429 voice_limit_reached`
- [ ] Reka introduces herself proactively, says Reka (not Mereka) as her name, and explains Oriental in one short Malaysian-English opener
- [ ] Reka can use typed handoff-panel context and does not ask again for fields already typed
- [ ] Saying "send" submits immediately when all required fields are present
- [ ] Saying "bye", "stop", or "end voice" tears down WebRTC without continuing the conversation
- [ ] Human listening QA signs off that the configured Realtime voice is Malaysian enough for launch
- [ ] `/admin/session-review` shows the test voice transcript, captured fields,
      usage counters, and submitted lead id after a voice submit
- [x] Falls back to typed handoff panel on mic-denied
- [x] Realtime capacity 429 receives one bounded retry, then preserves the typed handoff if still busy

## Email (SES)

- [ ] `SES_FROM_ADDRESS` (`oriental@mereka.io`) is verified
- [ ] DKIM, SPF, DMARC records in place
- [ ] Test lead routes to each of the 8 owners' inboxes
- [ ] Owner email includes lead id, source, segment, routed owner, contact fields, brief, and transcript excerpt
- [ ] Reply-To points to the lead's submitted email address
- [ ] Bounce / complaint webhook configured (or accepted as deferred)

## Slack

- [ ] `#tech-team-test` channel is the current smoke-test destination
- [ ] `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID=C01AVSGACFN` tested end-to-end (test submission → message visible)
- [ ] Slack message includes routed owner, lead id, source, contact fields, brief, and transcript excerpt
- [ ] `SLACK_WEBHOOK_URL` is treated as fallback only and stays in Infisical, not in code

## Observability

- [ ] Sentry receives a test server error in project `oriental-website`
- [ ] Sentry sourcemaps upload during production build when a build-only
      `SENTRY_AUTH_TOKEN` is supplied outside Coolify runtime logs
- [ ] Redis limiter fallback emits `rate_limit.redis_fallback` and sends a Slack ops alert in a controlled test
- [ ] OpenAI session mint failure emits `voice_session.openai_failed` and sends a Slack ops alert in a controlled test
- [ ] `/api/admin/review` rejects unauthenticated requests
- [ ] `/api/admin/leads/[leadId]` rejects unauthenticated requests and records a
      `workflow_update` event for a valid admin update
- [ ] `/admin/session-review` requires the admin token and renders recent Convex data

## Functional smoke test

Walk through every user path on the staging URL:

- [ ] Hero loads with the building photo within 2.5s on a 4G simulation
- [ ] Hero email capture: invalid email is rejected
- [ ] Hero email capture: valid email shows success state + "Take 2 minutes" link
- [ ] Clicking the nav voice CTA opens the voice modal
- [ ] Brand orb renders in the voice modal within 600ms of modal open
- [ ] Pressing SPACE on a non-input element opens the voice modal
- [ ] Each ecosystem cell opens the modal with the right segment intent
- [ ] Each space card opens the modal with the right segment intent
- [ ] Each partner card opens the modal with the right segment intent
- [ ] Voice and typed handoff share one editable workspace and preserve captured state
- [ ] Form: all 4 fields validate (required, email format, length caps)
- [ ] Invalid handoff submit shows field-level shadcn validation and a specific toast
- [ ] Form submit returns 200 + shows `<SubmittedView>`
- [ ] Editable handoff panel shows the routed-to person + role
- [ ] Story cue buttons show in-dialog context cards, not page-level toast overlays
- [ ] Voice rail (floating) appears after 720px scroll
- [ ] Voice rail disappears when modal is open
- [ ] Footer `mailto:team@mereka.io` opens email client
- [ ] Footer partner logo row renders Mereka, Biji-biji, and CIMB marks
- [ ] `/favicon.ico`, `/apple-touch-icon.png`, and `/assets/brand/mereka/favicon-*.png` return `200`
- [ ] Footer address link opens Google Maps in new tab
- [ ] ESC closes the voice modal
- [ ] Mobile (375×812): hero stacks, segment rail scrolls horizontally,
      form fields readable

## Accessibility

- [ ] Keyboard-only walkthrough of hero → voice modal → form → submit
- [ ] Focus rings visible on every interactive element
- [ ] Voice modal traps focus, returns focus to trigger on close
- [ ] All real photos have meaningful `alt` text (or `alt=""` if decorative)
- [ ] `prefers-reduced-motion: reduce` disables scroll reveals + orb animation
- [ ] Axe DevTools: zero critical issues on `/`
- [ ] Lighthouse Accessibility ≥ 95

## Performance

- [ ] Lighthouse Performance (mobile, slow 4G) ≥ 85
- [ ] Total JS on first paint < 90 KB gzipped
- [ ] Hero LCP element is the photo, not text
- [ ] No unexpected heavy client bundle enters the initial chunk
- [ ] Images served as AVIF where supported, with WebP fallback

## SEO & social

- [ ] `og-image.png` renders correctly in:
      Slack, WhatsApp, X, LinkedIn, iMessage
- [ ] `sitemap.xml` and `robots.txt` served
- [ ] Canonical URL set to `https://oriental.mereka.io/`
- [ ] Live root renders the exact managed `google-site-verification` meta tag
- [ ] Search Console ownership is verified and `/sitemap.xml` is submitted

## Legal / privacy

- [ ] PDPA privacy notice copy approved
- [x] Privacy notice link visible in the voice handoff
- [x] Privacy notice link in main footer
- [ ] "No recordings kept" claim verified against actual behaviour
- [x] Analytics fails closed behind explicit opt-in; legal copy approval remains a human sign-off gate
- [ ] Live browser proof observes no GA asset before opt-in or on admin, and the
      expected GA asset only after explicit public consent

## Stakeholder sign-off

- [ ] Routed-to people each confirmed by name + title
- [ ] CIMB has approved the partner-row credit
- [ ] Biji-biji has approved the partner-row credit
- [ ] Photography rights cleared for every shipped image
- [ ] Mereka leadership sign-off on copy

## Day-of-launch

- [ ] DNS TTL lowered to 5 min 24h before launch
- [ ] Comms scheduled: LinkedIn post, internal email, partner network
- [ ] On-call rota for first 72 hours
- [ ] Agreed Slack ops channel ready for incident triage (`#tech-team-test` is current smoke-test channel)
- [ ] Coolify rollback button tested

## First 72 hours (post-launch)

- [ ] Monitor Coolify container errors hourly
- [ ] Monitor Realtime mint/SDP 429s, ICE failures, remote-track/no-audio failures, and useful voice start rate
- [ ] Monitor OpenAI usage / spend
- [ ] Daily lead count posted to the agreed launch channel
