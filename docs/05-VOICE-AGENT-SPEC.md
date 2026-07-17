# 05 — Voice Agent Specification

The voice agent is the heart of the partner intake. This document is the
**contract** between the design (prototype) and the production wire-up.

---

## 1. Interaction Model

A single fullscreen overlay acts as a collaborative workspace. Voice and typing
are available at the same time; the user never has to choose a separate mode.
The right-hand handoff panel is always editable and uses shadcn form primitives
with Zod validation.

| Surface | Purpose |
|---|---|
| **Partner rail** | Segment intent and routing owner hint. |
| **Voice stage** | Reka voice controls, audio-reactive orb, story cues, live audio state, and a typed-chat composer while voice is live. |
| **Handoff panel** | Editable Name, Email, Organisation, and brief fields. |
| **Live notes** | Recent transcript snippets for user confidence and debugging. |

The design principle is: let the user talk naturally, but let them type or fix
anything instantly. Voice-captured values populate the same form fields the user
can edit before sending. While voice is live, the stage also offers a chat
composer: typed messages enter the same realtime conversation as user turns,
interrupt an in-flight spoken response (`response.cancel` +
`output_audio_buffer.clear`), join the transcript, and ground identity captures
exactly like speech.

## 2. Partner segments

Eight segments. Each is a top-level intent that determines (a) which person at
Mereka the lead routes to, and (b) the voice agent's opener line.

| `id` | Label | Blurb | Routed to | Role |
|---|---|---|---|---|
| `tenancy` | Tenancy | Long-term space for studios & enterprises | **Chewi** | Tenancy Lead |
| `education` | Education | Run learning programmes with us | **Lala** | Programmes Lead |
| `programme` | Programme | Bring recurring workshops & trainings | **Jey** | Programmes Lead |
| `technology` | Technology | Showcase tools & embed demos | **Gurpreet** | Innovation Lead |
| `ai` | AI | AI labs, agents, literacy & applied research | **Gurpreet** | Innovation Lead |
| `cultural` | Cultural | Exhibitions, residencies, performances | **AVI** | Culture Curator |
| `community` | Community | NGO, social impact, community-driven | **Ambika** | Community Lead |
| `other` | Other | Press, investor, or just exploring | **Nadia** | Partnerships |

> ⚠ Names and titles are working drafts. Confirmation needed from each
> individual before launch — see [`10-ROADMAP.md`](./10-ROADMAP.md) §Blockers.

Source of truth in production: `lib/segments.ts` exporting a typed `SEGMENTS`
constant matching the prototype's `voice-agent.jsx`.

## 3. Conversation flow (voice)

```
1. Greeting        → "Hi, I'm Reka from Mereka. What would you like to build with us at Oriental Building?"
2. Segment pick    → tool_call: set_partner_type(segment)
3. Opener          → voiceOpener for the picked segment
4. Discovery       → free dialogue, agent batches grounded reversible fields with capture_fields()
5. Verify email    → accept only grounded adaptive capture; clarify rejected/invalid evidence
6. Send or recap   → route immediately when the user says "send"; recap only when helpful
7. Routing         → tool_call: route_to_team(segment)
8. Close           → tool_call: end_call() when the user says bye/stop/end voice
```

The agent can revisit any step. If the user changes partner type mid-call, the
agent re-routes.

In governed `adaptive` mode, a speech email is sendable only after syntax,
model-evidence, and latest-turn grounding pass; exact evidence is high
confidence and is immediately usable only when the complete literal or spoken
evidence canonicalizes to that exact address. Bounded ASR substitution applies
only to a complete spoken-form candidate with an explicit email cue; it is
medium confidence, stays pending, and gets one exact readback with explicit
affirmation before it is usable. A literal email that differs from the proposed
address never enters the approximate path. The address is always
visible/editable; exact high-confidence captures do not pay a blanket
confirmation turn.

A correction or failed replacement invalidates the earlier verification before
any route can submit it, then grounds the replacement from scratch. Duplicate
email tool calls pass through the same grounding rule. A pending native-audio
transcription may yield medium confidence only when no completed turn already
contradicts the proposed value, and it never bypasses the exact readback.
Non-PII turn sequence and Realtime item identity preserve that decision across
form edits and out-of-order transcription completion. Clear-all also clears the
remembered handoff and fences every pre-clear ASR completion by Realtime item
identity. A typed form edit versions any already-active response stale for email
capture, confirmation, clearing, and routing, so older tool output cannot
overwrite or submit the typed value. `strict` restores exact
readback plus explicit confirmation. Email supplied through the hero prefill or
edited directly in the handoff form is confirmed by that typed action. Both the
client runtime and `/api/leads` reject invalid, stale, or pending email state.

Typed messages always send `response.cancel` and
`output_audio_buffer.clear` before the text turn, even when the browser has not
yet observed `response.created`. This makes a typed interruption deterministic
across the opener race; the expected no-active-response cancellation is benign
telemetry rather than an operator error.

## 4. Tool surface (OpenAI Realtime function calls)

The model is given exactly these tools. `lib/voice/profile.ts` is the executable
JSON-schema source of truth.

| Tool | Contract |
|---|---|
| `set_partner_type` | Reversible segment selection. |
| `capture_fields` | Applies 1–6 reversible fields in one reducer transaction. Valid fields are retained; invalid or ungrounded items are returned in `rejectedFields` for focused retry. Duplicate keys invalidate the batch. |
| `lookup_oriental` | Read-only, bounded lookup over published Oriental facts and FAQs. It has no network or write side effects. |
| `clear_field` | Reverses one captured field after a visitor correction. |
| `summarise_lead` | Reads the current draft and validation state. |
| `route_to_team` | Irreversible submission; separate from capture batches and requires clear visitor intent. |
| `wait_for_user` | Ends a turn silently for background audio, silence, or side conversation. |
| `end_call` | Irreversible voice close on clear visitor intent. |

Tool calls stream into the shared React state backing the editable shadcn form.
For `name`, `email`, and `org`, the reducer rejects captures that are not
grounded in recent user transcript evidence. Three deliberate exceptions:
while a user turn is still transcribing (transcription often lands after the
model's function call), evidence that is consistent with the value is accepted;
`org: "Individual"` is accepted with grounded evidence even though the visitor
never says the word "Individual"; and re-capturing a value that already matches
the typed/captured field is a silent confirmation. Typed handoff values are
synced back to the model as explicit context, so Reka can see what the user
typed and should not ask for those fields again. Brief updates may use
`mode: "append"` so the user can build a better story without losing earlier
context.

## 5. System prompt

The permanent prompt is a compact reflex prompt generated by
`buildVoiceInstructions()` and kept below 7 KB by test. It contains role, spoken
style, conversation reflexes, the tool contract, safety, and the routing table.
Detailed space, timeline, programme, partner, price, and process facts live
behind `lookup_oriental`; they are not copied into every Realtime session.

The prompt MUST require exact visitor evidence for identity capture, MUST keep
reversible batch capture separate from routing/end-call actions, and MUST never
claim a handoff succeeded before `route_to_team` returns success.

## 6. Voice / audio constraints

| Parameter | Value |
|---|---|
| Model | `gpt-realtime-2` by default via `OPENAI_REALTIME_MODEL` |
| Voice | Source fallback is `marin`; production is currently `coral` via `OPENAI_REALTIME_VOICE` |
| Speech speed | Source fallback is `1.18`; production is currently `1.28` via `OPENAI_REALTIME_SPEED`; clamped to OpenAI's supported `0.25` to `1.5` range |
| Input audio | Browser-default mic; page load imports the voice bundle and preconnects, but Realtime token minting happens only while permission is currently granted or after the visitor grants a first/expired one-time prompt. The app releases tracks on close. |
| Session length cap | **10 minutes** by default from the typed policy in `lib/voice/session-policy.ts`; bounded override `VOICE_MAX_DURATION_MS` accepts 1–30 minutes. `/api/voice/session` returns the resolved value to the client. |
| Turn detection | `baseline` uses semantic VAD `auto`. `instant-v1` uses `high` for normal turns, switches deterministically to `low` after Reka asks for an email, then returns to `high` on the next response. `VOICE_RUNTIME_PROFILE=baseline` is the rollback. |
| Email capture | `adaptive` immediately confirms only exact high-confidence speech evidence; medium ASR substitution gets one exact readback. Both stay visible/editable. `strict` always requires exact readback plus explicit confirmation. |
| Input transcription | `gpt-4o-transcribe` by default via `OPENAI_REALTIME_TRANSCRIPTION_MODEL`, with a multilingual domain `prompt` covering Malaysian English, Bahasa Melayu, Mandarin, and Tamil plus spoken-email patterns and brand terms. Transcription feeds the visible transcript, review snapshots, and capture grounding; the model itself hears audio natively |
| Noise reduction | `near_field` for mobile user agents, `far_field` for desktops, chosen at mint time in `/api/voice/session` |
| Idle behaviour | Reka speaks a one-sentence goodbye in a grace window (`idleGoodbyeGraceMs`, 6 s) before the 20 s idle cutoff; the goodbye cannot extend the session and the visitor speaking cancels the close |
| Reconnects | When a session starts with an existing transcript, the last turns are sent as context and Reka resumes instead of repeating the opener |
| Modalities | Audio output with text events and tool-call events on the data channel; typed user messages are sent as `input_text` conversation items |

## 7. Auth & token mint

The browser **never** holds the long-lived `OPENAI_API_KEY`. The connect flow
is permission-aware via the Permissions API: a visitor with a currently
granted microphone runs mic acquisition and token minting in parallel; a
visitor in `prompt` state (first use or an expired one-time grant) sees the
browser prompt immediately on click (with a
dedicated `requesting_mic` stage state) and the daily voice quota is only
spent after the mic is granted; a known denial fails fast with guidance and
mints nothing. Browsers without microphone permission queries (Firefox) fall
back to the prompt-first path.

1. Client POSTs `/api/voice/session` with the intended partner segment and selected voice variant; no Turnstile token is required for voice start.
2. Route Handler applies the voice rate limit and asks OpenAI for an ephemeral client secret plus signed voice review credentials.
3. Returns the secret and resolved model/reasoning cells, voice variant, runtime
   profile/input policy, transcription/noise settings, typed duration limits,
   and signed review credentials.
4. Client opens a WebRTC peer connection using the ephemeral token.
5. Mic audio is streamed up; assistant audio is streamed down to an
   `<audio>` element.
6. Tool-call deltas arrive via the data channel and are reduced into
   `captured` state.
7. Voice lead handoff submits the signed review credential back to `/api/leads`; the server verifies it as the voice anti-abuse proof and strips the token before persistence or notifications.

See [`06-API-CONTRACTS.md`](./06-API-CONTRACTS.md) §`/api/voice/session`.

## 8. Fallback behaviour

| Failure | Behaviour |
|---|---|
| Mic permission denied | Voice is unavailable; the handoff form remains editable. Show toast: "Voice unavailable. You can keep typing here." |
| WebRTC ICE fails | Same — handoff form remains editable. |
| `/api/voice/session` returns 429 | Handoff form remains editable + toast: "Voice limit reached for today." |
| OpenAI Realtime call returns 429 | Reuse the current mint/offer for one retry after 300–700 ms jitter while showing `Reconnecting`; if it is still busy, preserve the editable handoff and show transient capacity guidance. Never mislabel it as the visitor's daily limit. |
| OpenAI Realtime returns 5xx | Same. Track in Coolify logs until a dedicated observability stack is added. |
| User goes idle in voice mode | Reka says a one-sentence goodbye ~6 s before the cutoff, then voice tears down after 20 seconds of inactivity. The form and captured fields remain visible. |
| Conversation reaches max duration | Voice waits for a natural speech stop, gives the configured goodbye grace, and tears down at the server-resolved cap (10 minutes by default). The form remains visible and reconnecting resumes with recent context. |
| Benign realtime protocol errors (e.g. cancel races) | Recorded in the session error log with codes, never surfaced as user toasts. Non-benign errors show one deduplicated toast. |

The OpenAI SDP response body distinguishes transient capacity 429s from
`insufficient_quota`. Only `realtime_busy` receives the bounded retry. Quota
exhaustion, microphone denial, session mint failures, timeouts, and other
transport failures are never retried by this path. Quota, capacity, and
transport failures remain separate in review/evaluation metrics.

## 8.1 Conversation QA Contract

The current product bar is not only that tools fire; Reka must feel like a
distinct Malaysian host. Manual QA should check:

- Reka introduces herself proactively when voice connects.
- She says **Reka** as her name and treats **Mereka** as the organisation.
- She uses current handoff-panel context and does not claim she cannot fill the
  form.
- She appends story updates when the user asks to add or improve the brief.
- She submits immediately when the user says "send" and required fields are
  present.
- She calls `end_call` when the user says bye, stop, or end voice.
- She does not invent identity fields from overlays, account names, or old
  defaults.
- Typing a message while she is speaking interrupts her; she addresses the
  typed message instead of finishing the dropped sentence.
- She mirrors Bahasa Melayu or Mandarin when the visitor uses it, and switches
  back when they do.
- After a reconnect she resumes the earlier conversation in one sentence rather
  than redoing the opening pitch.
- She uses the visitor's name sparingly once captured — confirmations and the
  send cue, never every sentence.
- Human ears decide whether the configured voice is Malaysian enough before a
  wider launch.

## 9. Privacy

Owner decision (June 2026): transcripts and session records are kept for
follow-up. The hero copy states this plainly ("transcribed & saved so the
right person follows up").

- Audio is currently **not** stored on our side. OpenAI's Realtime API may
  transiently buffer audio; we do not log raw audio anywhere of ours. Keeping
  recordings is permitted under the current policy if a future need arises.
- The **transcript** (text only) is stored with the Convex lead row, and
  voice-session snapshots (captured fields, transcript, errors, usage) are
  stored in `voiceSessions` — including sessions that were never submitted.
- Following up with visitors who shared contact details in voice but did not
  press send (the admin "Recoverable voice leads" queue) is sanctioned.
- Privacy notice (PDPA) is linked from the voice modal footer — link target
  TBD.

## 10. Submission

On `route_to_team` (voice) or "Send to Mereka" (form), the client POSTs
`/api/leads` with:

```json
{
  "source": "voice" | "form",
  "segment": "education",
  "form": { "name": "...", "email": "...", "org": "...", "message": "..." },
  "transcript": [ { "role": "user", "text": "..." }, ... ],
  "voiceEmailVerified": true,
  "voiceEmailVerificationSource": "speech" | "typed" | "prefill",
  "turnstileToken": "...",
  "utm": { ... }
}
```

Server then:

1. Verifies Turnstile.
2. Validates payload (zod) and rejects voice email without a verified readback/edit marker.
3. Inserts a row into `leads` through the Convex `leads.createLead` mutation.
4. Inserts a row into `leadEvents` (`kind: "created"`).
5. Attempts owner email via SMTP or SES, depending on configured secrets.
6. Attempts Slack notification with `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID`,
   falling back to `SLACK_WEBHOOK_URL` when bot-token delivery is not configured.
7. Returns `{ ok: true, id, persisted, notifications }` when the lead is saved
   and production notification policy is satisfied.

In production, if persistence succeeds but neither owner email nor Slack
notification delivers, the route returns `{ ok: false, error:
"notification_failed", persisted: true, notifications }` with status `502` so
the UI can tell the user the handoff was saved but needs notification attention.

Errors surface as `{ ok: false, error: 'human_readable' }` — UI toasts and
stays in the modal so the user can retry or use the fallback email.

## 11. Persistence of captured state

If the user reloads mid-session, current `captured` state is **lost**. We do
not localStorage the partial form because (a) it's a 2-minute interaction and
(b) PDPA cleanliness.

During local development, the dialog posts the latest captured fields,
transcript, usage, and errors to `/api/voice/debug` so agents can inspect
conversation failures without asking the tester to paste browser logs.

In production, `/api/voice/session` returns signed review credentials. The
dialog uses those credentials to POST review snapshots to `/api/voice/debug`;
the route verifies the signature and upserts the Convex `voiceSessions` row for
the internal `/admin/session-review` dashboard. `GET /api/voice/debug` remains
local-development only.
