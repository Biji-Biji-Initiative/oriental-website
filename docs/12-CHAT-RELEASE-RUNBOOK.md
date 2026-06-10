# 12 — Chat Integration Release Runbook

Ship and verify the `claude/chat-integration-improvements` branch: hybrid
type-or-talk voice, semantic VAD + `gpt-4o-transcribe`, live captions,
permission-aware connect, reconnect continuity, notification durability, and
the admin recoverable-leads workflow. Everything below is the human half —
the machine-verifiable half (96 unit tests, lint, typecheck, build, fuzz +
golden-session suites, two adversarial review passes) is green on every
commit.

## 1. Deploy order

1. **Convex functions first** — the branch adds `voiceSessions.followedUpAt`,
   the `setVoiceSessionFollowUp` mutation, and the error `code` field:
   ```bash
   CONVEX_DEPLOY_KEY='prod:...' pnpm exec convex deploy
   ```
   Until this runs, review snapshots with error codes fail to persist
   (logged as `voice_review.persistence_failed`) and the admin
   "Mark followed up" buttons return a clean error toast.
2. **App deploy** via Coolify as usual.
3. **Smoke the logs**: the first `voice_session.created` line should show
   `transcriptionModel: "gpt-4o-transcribe"`, `noiseReduction`,
   `deviceProfile`, and `rateLimitStore: "redis"`.

## 2. Ten-minute voice QA script

Run once on desktop Chrome and once on a phone. Say the lines literally.

| # | Do / say | Expect |
|---|---|---|
| 1 | Fresh profile, click **Start talking with Reka** | Browser mic prompt appears immediately; stage shows "Mic permission" copy |
| 2 | Deny the mic | Friendly denial toast; check logs — **no** `voice_session.created` (quota not spent) |
| 3 | Re-allow and connect | Greeting starts; captions stream under the orb; orb breathes with her voice |
| 4 | "We run AI literacy workshops and want a demo lab" | Brief and segment captured in the panel without Reka announcing it |
| 5 | "My name is Asha, email asha dot lim at example dot com" — pause mid-email | Semantic VAD waits through the pauses; both fields land (transcription-race tolerant) |
| 6 | Type `gurpreet@mereka.io` into the composer while Reka is mid-sentence | She stops talking and addresses the typed message; email updates |
| 7 | "No organisation, it's just me" | Organisation captures as `Individual` |
| 8 | Say a sentence in Bahasa Melayu | Reka mirrors in Malay, returns to English when you do |
| 9 | Go silent ~14 s | Reka says a one-sentence goodbye; session ends at 20 s. Speak during the goodbye — the close cancels |
| 10 | Reconnect after a session ends with history | One-sentence "I'm back" continuation, no repeated opening pitch |
| 11 | "Okay, send it" | Submitted state; Slack message and owner email arrive with the redesigned formatting |
| 12 | End one session with an email captured but **not** sent | It appears in admin **Recoverable voice leads**; "Follow up by email" drafts correctly; "Mark followed up" clears it (post-Convex-deploy) |

Human-ear judgement calls while you're in there: is the accent Malaysian
enough, is `coral` at `1.28` the right energy, do the captions feel synced?

## 3. Admin console visual pass

`/admin/session-review` renders with the `mk-ash`/`mk-blue` tokens applied
for the first time (they were undefined before this branch — the 7-day chart
bars were invisible). Check: muted text hierarchy reads well, chart and
progress bars are visible, error badges distinguish real errors from
"benign", and the recoverable queue card layout holds with 0, 1, and many
entries.

## 4. Remaining automated step

The e2e suite can run inside the remote dev environment despite the browser
CDN being blocked — `@sparticuz/chromium` (a devDependency) ships a chromium
binary through npm:

```bash
pnpm build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
PORT=3011 node .next/standalone/server.js &
# Extracts the npm-shipped chromium to /tmp/chromium and prints the path:
node -e "const m = require('@sparticuz/chromium'); Promise.resolve((m.default ?? m).executablePath()).then((p) => console.log(p))"
PLAYWRIGHT_CHROMIUM_PATH=/tmp/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:3011 pnpm test:e2e
```

All 12 specs (chromium + Pixel 7 mobile) passed against the production
standalone build during this branch's verification. CI/local runs work
unchanged with Playwright's own browsers.

## 5. Watch list for the first days

- `voice_review.session_errors` — non-benign codes only; benign cancel races
  are expected with typed interruptions and are filtered from admin badges.
- `lead.accepted` with `persisted: false` — the new degraded mode (Convex
  down, notifications carried the lead). It pages ops as critical.
- `notification.smtp_failed_falling_back` — SMTP broke and SESv2 covered it.
- OpenAI spend per session in the admin usage summaries (`gpt-4o-transcribe`
  replaces whisper-1 line items).

## 6. Deferred by design (decision records live in chat/PR)

- CSP header — needs staging verification against Turnstile, Sentry, and the
  OpenAI WebRTC origins.
- `USER node` in the Dockerfile — verify `.next/cache` write permissions on
  a staging deploy first.
- Idempotency keys for lead creation — wants a Convex-side dedupe design.
- Native `idle_timeout_ms` — incompatible with semantic VAD; client goodbye
  covers it.
