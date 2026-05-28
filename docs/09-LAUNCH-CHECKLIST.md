# 09 — Launch Checklist

The pre-launch gate. Each row is a binary check. No subjective items —
those go to [`10-ROADMAP.md`](./10-ROADMAP.md).

Use this on the day of soft-launch and again 24 hours before public-launch.

---

## Code & deploy

- [ ] `main` branch builds clean in Coolify (preview environment)
- [ ] Image size < 220 MB
- [ ] `pnpm exec convex deploy` completed with the production deploy key
- [ ] `/api/health` returns `200` for 5 consecutive checks
- [ ] `/api/health` reports the expected deployed `version` commit and `convex: true`
- [ ] Cloudflare DNS for `oriental.mereka.io` resolves to Coolify origin
- [ ] Cloudflare cert active (Full Strict mode)
- [ ] Cloudflare cache rules avoid stale HTML while the root layout is dynamic
- [ ] Cloudflare WAF rules active (no-UA block on `/api/*`)
- [ ] Coolify auto-deploy webhook wired to `main`

## Secrets

- [ ] Infisical project `6bfac905-9bb1-449e-8be8-f25f9634802b` has all keys from
      [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) §5 populated in `/deploy/oriental-website` for `prod`
- [ ] Coolify machine identity has read-only access to `/deploy/oriental-website`
- [ ] CI/check machine identity has read-only access where used
- [ ] Rotation calendar reminder set for OPENAI / AWS keys (90 days)
- [ ] CI's `scripts/check-secrets.ts` passes for all three environments
- [ ] `REDIS_URL` is present in production and API logs show `rateLimitStore: "redis"`
- [ ] `COOLIFY_ORIENTAL_APPLICATION_UUID` is set to `mtrl2z6a7zvoyevxvufpntij` for deploy scripts
- [ ] `ADMIN_REVIEW_TOKEN` is present in `/deploy/oriental-website`
- [ ] Sentry `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, and
      `SENTRY_PROJECT=oriental-website` are present
- [ ] `OPS_ALERT_SLACK_CHANNEL_ID=C01AVSGACFN` targets `#tech-team-test`

## Cloudflare Turnstile

- [ ] Site key embedded in client (NEXT_PUBLIC_TURNSTILE_SITE_KEY)
- [ ] Secret key in Infisical
- [ ] Widget renders invisibly on page load
- [ ] Submitting `/api/leads` without a token returns `403 turnstile_failed`
- [ ] Submitting with a tampered token returns `403`

## Convex

- [ ] `convex/schema.ts` deployed to production
- [ ] Convex `leads.recordVoiceSession`, `leads.recordLeadNotification`, and
      `leads.reviewDashboard` are deployed before `/admin/session-review` is used
- [ ] `leads` table accepts a staging/prod test lead
- [ ] `leadEvents` receives the matching `created` event
- [ ] `CONVEX_INGEST_SECRET` rejects an invalid secret
- [ ] Backup/export ownership and retention are documented

## OpenAI Realtime

- [ ] `/api/voice/session` mints a working ephemeral token in staging
- [ ] WebRTC handshake completes in < 2s on stable broadband
- [ ] Tool calls `set_partner_type` / `capture_field` / `summarise_lead` /
      `route_to_team` / `wait_for_user` all fire correctly during a 90s mock conversation
- [ ] `capture_field` only saves name/email/org when supported by recent user transcript evidence
- [ ] Client idle/max timers stop microphone/WebRTC at 20s idle and 150s max
- [ ] Rate limit enforced — 4th minted session/IP/day returns `429 voice_limit_reached`
- [ ] Reka introduces herself proactively, says Reka (not Mereka) as her name, and explains Oriental in one short Malaysian-English opener
- [ ] Reka can use typed handoff-panel context and does not ask again for fields already typed
- [ ] Saying "send" submits immediately when all required fields are present
- [ ] Saying "bye", "stop", or "end voice" tears down WebRTC without continuing the conversation
- [ ] Human listening QA signs off that the configured Realtime voice is Malaysian enough for launch
- [ ] `/admin/session-review` shows the test voice transcript, captured fields,
      usage counters, and submitted lead id after a voice submit
- [ ] Falls back to typed handoff panel on mic-denied
- [ ] Falls back to typed handoff panel on session 429

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

- [ ] `og-image.svg` renders correctly in:
      Slack, WhatsApp, X, LinkedIn, iMessage
- [ ] `sitemap.xml` and `robots.txt` served
- [ ] Canonical URL set to `https://oriental.mereka.io/`

## Legal / privacy

- [ ] PDPA privacy notice copy approved
- [ ] Privacy notice link visible in the voice modal footer
- [ ] Privacy notice link in main footer
- [ ] "No recordings kept" claim verified against actual behaviour
- [ ] Cookie banner not required (we use only Cloudflare's first-party
      analytics, which is cookieless) — confirm with legal

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
- [ ] Monitor Cloudflare Turnstile failure rate
- [ ] Monitor OpenAI usage / spend
- [ ] Daily lead count posted to the agreed launch channel
