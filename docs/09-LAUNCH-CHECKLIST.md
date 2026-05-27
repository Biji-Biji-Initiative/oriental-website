# 09 — Launch Checklist

The pre-launch gate. Each row is a binary check. No subjective items —
those go to [`10-ROADMAP.md`](./10-ROADMAP.md).

Use this on the day of soft-launch and again 24 hours before public-launch.

---

## Code & deploy

- [ ] `main` branch builds clean in Coolify (preview environment)
- [ ] Image size < 220 MB
- [ ] `pnpm db:migrate` runs clean against the prod database
- [ ] `/api/health` returns `200` for 5 consecutive checks
- [ ] Sentry receiving events from prod (test 500)
- [ ] Cloudflare DNS for `oriental.mereka.io` resolves to Coolify origin
- [ ] Cloudflare cert active (Full Strict mode)
- [ ] Cloudflare cache configured: edge 5 min, browser 0
- [ ] Cloudflare WAF rules active (no-UA block on `/api/*`)
- [ ] Coolify auto-deploy webhook wired to `main`

## Secrets

- [ ] Infisical `oriental-microsite` project has all keys from
      [`02-TECHNICAL-SPEC.md`](./02-TECHNICAL-SPEC.md) §5 populated in `prod`
- [ ] `oriental-coolify-deploy` machine identity has read-only access
- [ ] `oriental-ci-check` machine identity has read-only access
- [ ] Rotation calendar reminder set for OPENAI / AWS keys (90 days)
- [ ] CI's `scripts/check-secrets.ts` passes for all three environments

## Cloudflare Turnstile

- [ ] Site key embedded in client (NEXT_PUBLIC_TURNSTILE_SITE_KEY)
- [ ] Secret key in Infisical
- [ ] Widget renders invisibly on page load
- [ ] Submitting `/api/leads` without a token returns `403 turnstile_failed`
- [ ] Submitting with a tampered token returns `403`

## Database

- [ ] `leads` table exists with all columns + constraints
- [ ] `lead_events` table exists with all columns
- [ ] Indexes created
- [ ] Daily snapshot enabled, retention ≥ 30 days
- [ ] Snapshot restore tested at least once in staging

## OpenAI Realtime

- [ ] `/api/voice/session` mints a working ephemeral token in staging
- [ ] WebRTC handshake completes in < 2s on stable broadband
- [ ] Tool calls `set_partner_type` / `capture_field` / `summarise_lead` /
      `route_to_team` all fire correctly during a 90s mock conversation
- [ ] Session length cap enforced — server rejects > 180s
- [ ] Rate limit enforced — 4th session/IP/day returns `429`
- [ ] Falls back to Form mode on mic-denied
- [ ] Falls back to Form mode on session 429

## Email (SES)

- [ ] `SES_FROM_ADDRESS` (`oriental@mereka.io`) is verified
- [ ] DKIM, SPF, DMARC records in place
- [ ] Test lead routes to each of the 8 owners' inboxes
- [ ] Bounce / complaint webhook configured (or accepted as deferred)

## Slack

- [ ] `#partner-intake` channel created
- [ ] Webhook tested end-to-end (test submission → message visible)
- [ ] Webhook URL is in Infisical, not in code

## Functional smoke test

Walk through every user path on the staging URL:

- [ ] Hero loads with the building photo within 2.5s on a 4G simulation
- [ ] Hero email capture: invalid email is rejected
- [ ] Hero email capture: valid email shows success state + "Take 2 minutes" link
- [ ] Clicking "Talk to Mereka" in nav opens the voice modal
- [ ] Mereka orb renders (3D, animated) within 600ms of modal open
- [ ] Pressing SPACE on a non-input element opens the voice modal
- [ ] Each ecosystem cell opens the modal with the right segment intent
- [ ] Each space card opens the modal with the right segment intent
- [ ] Each partner card opens the modal with the right segment intent
- [ ] Mode toggle between Voice / Form preserves captured state
- [ ] Form: all 4 fields validate (required, email format, length caps)
- [ ] Form submit returns 200 + shows `<SubmittedView>`
- [ ] Captured rail shows the routed-to person + role
- [ ] Voice rail (floating) appears after 720px scroll
- [ ] Voice rail disappears when modal is open
- [ ] Footer `mailto:team@mereka.io` opens email client
- [ ] Footer partner links open in new tabs
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
- [ ] Three.js bundle is **not** in the initial chunk
- [ ] Images served as AVIF where supported, with WebP fallback

## SEO & social

- [ ] `og-image.svg` renders correctly in:
      Slack, WhatsApp, X, LinkedIn, iMessage
- [ ] Title and description appear in Google's preview tool
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
- [ ] Slack `#partner-intake-ops` channel ready for incident triage
- [ ] Coolify rollback button tested

## First 72 hours (post-launch)

- [ ] Monitor Sentry hourly
- [ ] Monitor Cloudflare Turnstile failure rate
- [ ] Monitor OpenAI usage / spend
- [ ] Daily lead count posted to `#partner-intake`
