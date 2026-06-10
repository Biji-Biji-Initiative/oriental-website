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
1. Greeting        → "Hi, I'm Reka. We're moving into Oriental..."
2. Segment pick    → tool_call: set_partner_type(segment)
3. Opener          → voiceOpener for the picked segment
4. Discovery       → free dialogue, agent uses capture_field() only for grounded values
5. Send or recap   → route immediately when the user says "send"; recap only when helpful
6. Routing         → tool_call: route_to_team(segment)
7. Close           → tool_call: end_call() when the user says bye/stop/end voice
```

The agent can revisit any step. If the user changes partner type mid-call, the
agent re-routes.

## 4. Tool surface (OpenAI Realtime function calls)

The model is given exactly these tools — keep this list small, mostly because
hallucinated tools waste tokens and cause silent failures.

```ts
type Segment = 'tenancy'|'education'|'programme'|'technology'|'ai'|'cultural'|'community'|'other';

const tools = [
  {
    name: 'set_partner_type',
    description: 'Pick the partner segment for this enquiry. Re-callable.',
    parameters: { type: 'object', properties: { segment: { type: 'string', enum: SEGMENT_IDS } }, required: ['segment'] },
  },
  {
    name: 'capture_field',
    description: 'Save a single piece of structured info to the lead.',
    parameters: {
      type: 'object',
      properties: {
        key:   { type: 'string', enum: ['name','email','org','message'] },
        value: { type: 'string' },
        evidence: { type: 'string' }, // exact user-transcript words; required by policy for name/email/org
        mode: { type: 'string', enum: ['replace','append'] },
      },
      required: ['key','value'],
    },
  },
  {
    name: 'clear_field',
    description: 'Clear a field after the user rejects or corrects a capture.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', enum: ['name','email','org','message'] } },
      required: ['key'],
    },
  },
  {
    name: 'summarise_lead',
    description: 'Read back the current lead state to the user before submission.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'route_to_team',
    description: 'Finalise. Marks the lead ready for human follow-up.',
    parameters: { type: 'object', properties: { segment: { type: 'string', enum: SEGMENT_IDS } }, required: ['segment'] },
  },
  {
    name: 'wait_for_user',
    description: 'End the turn without a spoken reply for silence, background audio, or side conversation.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'end_call',
    description: 'End the voice session when the user says goodbye, asks to stop, or is done with voice.',
    parameters: { type: 'object', properties: { reason: { type: 'string', enum: ['user_done','user_cancelled'] } } },
  },
];
```

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

```
You are Reka, the voice host for Mereka's Oriental Building partner intake — a
historic Kuala Lumpur landmark being reactivated for future learning,
technology, creativity, and community. You speak with prospective tenants, programme operators,
education partners, technology partners, cultural and community
collaborators, and strategic partners.

Your job, in order:
  1. Identify the right partner segment (use set_partner_type).
  2. Capture name, email, organisation, and a short brief of what they'd bring
     (use capture_field one key at a time).
  3. Use typed handoff panel context without asking for those fields again.
  4. Route the enquiry to the correct Mereka team member when the user says send.

Tone: warm, Malaysian, upbeat, pace-driven, precise. Sound like a distinctive KL
ecosystem host, not a Western call-centre voice. Use Malaysian English spelling
and light Malaysian English rhythm without caricature or forced slang.

For name, email, and organisation, include exact user-transcript evidence when
calling capture_field. Never infer these from examples, browser overlays,
background audio, account names, email domains, or previous defaults. If the
user rejects a captured identity field, call clear_field and ask them to type or
say the correct value.

If asked something off-topic (real estate prices, availability, dates), say
honestly that the building opens in 2027, partner conversations are open now,
and offer to route them to the right person for specifics.

Never invent: a price, a square footage, an opening date earlier than 2027,
a person's name not listed above, or a guarantee of partnership. If the user
asks something you don't know, capture the question in the message field and
say a human will follow up.

End the voice session when the user says bye, stop, or end voice. Never say a
lead was sent until route_to_team succeeds.
```

## 6. Voice / audio constraints

| Parameter | Value |
|---|---|
| Model | `gpt-realtime-2` by default via `OPENAI_REALTIME_MODEL` |
| Voice | Source fallback is `marin`; production is currently `coral` via `OPENAI_REALTIME_VOICE` |
| Speech speed | Source fallback is `1.18`; production is currently `1.28` via `OPENAI_REALTIME_SPEED`; clamped to OpenAI's supported `0.25` to `1.5` range |
| Input audio | Browser-default mic, captured locally before token minting |
| Session length cap | **150 seconds** client-side runtime cap; `/api/voice/session` refuses to mint a new token if the same IP exceeds 3 sessions / day in the Redis-backed limiter, with memory fallback only when Redis is unavailable |
| Turn detection | `semantic_vad`, `eagerness: "auto"`, `create_response: true`, `interrupt_response: true` — the turn-detection model waits when the speaker pauses mid-thought (e.g. dictating an email) instead of cutting at a fixed silence threshold |
| Input transcription | `gpt-4o-transcribe` by default via `OPENAI_REALTIME_TRANSCRIPTION_MODEL`, with a multilingual domain `prompt` covering Malaysian English, Bahasa Melayu, Mandarin, and Tamil plus spoken-email patterns and brand terms. Transcription feeds the visible transcript, review snapshots, and capture grounding; the model itself hears audio natively |
| Noise reduction | `near_field` for mobile user agents, `far_field` for desktops, chosen at mint time in `/api/voice/session` |
| Idle behaviour | Reka speaks a one-sentence goodbye in a grace window (`idleGoodbyeGraceMs`, 6 s) before the 20 s idle cutoff; the goodbye cannot extend the session and the visitor speaking cancels the close |
| Reconnects | When a session starts with an existing transcript, the last turns are sent as context and Reka resumes instead of repeating the opener |
| Modalities | Audio output with text events and tool-call events on the data channel; typed user messages are sent as `input_text` conversation items |

## 7. Auth & token mint

The browser **never** holds the long-lived `OPENAI_API_KEY`. The connect flow
is permission-aware via the Permissions API: a returning visitor with a
granted microphone runs mic acquisition and token minting in parallel; a
first-time visitor sees the browser prompt immediately on click (with a
dedicated `requesting_mic` stage state) and the daily voice quota is only
spent after the mic is granted; a known denial fails fast with guidance and
mints nothing. Browsers without microphone permission queries (Firefox) fall
back to the prompt-first path.

1. Client POSTs `/api/voice/session` with a Turnstile token.
2. Route Handler verifies Turnstile, applies the voice rate limit, and asks
   OpenAI for an ephemeral client secret.
3. Returns `{ client_secret, expires_at, model, voice, speed,
   transcription_model, noise_reduction, review }`.
4. Client opens a WebRTC peer connection using the ephemeral token.
5. Mic audio is streamed up; assistant audio is streamed down to an
   `<audio>` element.
6. Tool-call deltas arrive via the data channel and are reduced into
   `captured` state.

See [`06-API-CONTRACTS.md`](./06-API-CONTRACTS.md) §`/api/voice/session`.

## 8. Fallback behaviour

| Failure | Behaviour |
|---|---|
| Mic permission denied | Voice is unavailable; the handoff form remains editable. Show toast: "Voice unavailable. You can keep typing here." |
| WebRTC ICE fails | Same — handoff form remains editable. |
| `/api/voice/session` returns 429 | Handoff form remains editable + toast: "Voice limit reached for today." |
| OpenAI Realtime returns 5xx | Same. Track in Coolify logs until a dedicated observability stack is added. |
| User goes idle in voice mode | Reka says a one-sentence goodbye ~6 s before the cutoff, then voice tears down after 20 seconds of inactivity. The form and captured fields remain visible. |
| Conversation reaches max duration | Voice tears down after 150 seconds. The form and captured fields remain visible. Reconnecting resumes with recent transcript context instead of a fresh opener. |
| Benign realtime protocol errors (e.g. cancel races) | Recorded in the session error log with codes, never surfaced as user toasts. Non-benign errors show one deduplicated toast. |

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

- The microsite UI promises **"no recordings kept"**. To honour this:
  - Audio is **not** stored. OpenAI's Realtime API may transiently buffer
    audio; we do not log raw audio anywhere of ours.
  - The **transcript** (text only) is stored with the Convex lead row.
  - The user is told this at the bottom of the hero (`hero__privacy`).
  - Privacy notice (PDPA) is linked from the voice modal footer — link target
    TBD.
- Confirm with legal that the current copy holds. If not, soften to
  "transcripts kept only for follow-up, deleted after 90 days".

## 10. Submission

On `route_to_team` (voice) or "Send to Mereka" (form), the client POSTs
`/api/leads` with:

```json
{
  "source": "voice" | "form",
  "segment": "education",
  "form": { "name": "...", "email": "...", "org": "...", "message": "..." },
  "transcript": [ { "role": "user", "text": "..." }, ... ],
  "turnstileToken": "...",
  "utm": { ... }
}
```

Server then:

1. Verifies Turnstile.
2. Validates payload (zod).
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
