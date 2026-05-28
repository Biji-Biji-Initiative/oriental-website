# 05 — Voice Agent Specification

The voice agent is the heart of the partner intake. This document is the
**contract** between the design (prototype) and the production wire-up.

---

## 1. Modes

A single fullscreen overlay with two interchangeable modes. State is shared —
fields captured in one mode are visible in the other.

| Mode | Surface | When to use |
|---|---|---|
| **Voice** | Mereka orb + utterance + tour topics + transcript | Default. Hands-free, conversational. |
| **Form** | 4-field intake (Name, Email, Organisation, "What you'd bring") | Quiet environments, accessibility preference, or "I just want to type this". |

Mode toggle is a `Tabs`-style switch in the centre stage. The user can switch at
any time without losing data.

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
1. Greeting        → "Welcome. I'm Mereka. What brings you to Oriental today?"
2. Segment pick    → tool_call: set_partner_type(segment)
3. Opener          → voiceOpener for the picked segment
4. Discovery       → free dialogue, agent uses capture_field() liberally
5. Summary check   → "So that's <name>, <email>, building <thing>. Sound right?"
6. Routing         → tool_call: route_to_team(segment)
7. Close           → "Sent. <First name> will be in touch within 2 working days."
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
      },
      required: ['key','value'],
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
];
```

Tool calls stream into the existing `captured` React state via the same
`setCaptured` setter the prototype uses today — no UI changes required to
accept them.

## 5. System prompt

```
You are Mereka, the partner intake for Oriental Building — a historic Kuala
Lumpur landmark being reactivated for future learning, technology, creativity,
and community. You speak with prospective tenants, programme operators,
education partners, technology partners, cultural and community
collaborators, and strategic partners.

Your job, in order:
  1. Identify the right partner segment (use set_partner_type).
  2. Capture name, email, organisation, and a short brief of what they'd bring
     (use capture_field one key at a time).
  3. Summarise the captured lead back to the user (use summarise_lead).
  4. Route the enquiry to the correct Mereka team member (use route_to_team).

Tone: warm, civic, precise. Never hyped, never salesy. Use Malaysian English
spelling and idiom (organisation, programme, neighbourhood). Be brief — short
sentences, no monologues.

If asked something off-topic (real estate prices, availability, dates), say
honestly that the building opens in 2027, partner conversations are open now,
and offer to route them to the right person for specifics.

Never invent: a price, a square footage, an opening date earlier than 2027,
a person's name not listed above, or a guarantee of partnership. If the user
asks something you don't know, capture the question in the message field and
say a human will follow up.

End the conversation by summarising and confirming routing. Never end without
a captured email.
```

## 6. Voice / audio constraints

| Parameter | Value |
|---|---|
| Model | `gpt-realtime-2` by default via `OPENAI_REALTIME_MODEL` |
| Voice | `marin` by default via `OPENAI_REALTIME_VOICE` |
| Input audio | Browser-default mic, captured locally before token minting |
| Session length cap | **150 seconds** client-side runtime cap; `/api/voice/session` also refuses to mint a new token if the same IP exceeds 3 sessions / day in the current in-memory limiter |
| Server VAD | `server_vad`, `threshold: 0.5`, `prefix_padding_ms: 300`, `silence_duration_ms: 700`, `create_response: true`, `interrupt_response: true` |
| Modalities | Audio output with text events and tool-call events on the data channel |

## 7. Auth & token mint

The browser **never** holds the long-lived `OPENAI_API_KEY`. Flow:

1. Client POSTs `/api/voice/session` with a Turnstile token.
2. Route Handler verifies Turnstile, applies the voice rate limit, and asks
   OpenAI for an ephemeral client secret.
3. Returns `{ client_secret, expires_at, model, voice }`.
4. Client opens a WebRTC peer connection using the ephemeral token.
5. Mic audio is streamed up; assistant audio is streamed down to an
   `<audio>` element.
6. Tool-call deltas arrive via the data channel and are reduced into
   `captured` state.

See [`06-API-CONTRACTS.md`](./06-API-CONTRACTS.md) §`/api/voice/session`.

## 8. Fallback behaviour

| Failure | Behaviour |
|---|---|
| Mic permission denied | Auto-switch to Form mode. Show toast: "Microphone unavailable — switched to form." |
| WebRTC ICE fails | Same — switch to Form mode. |
| `/api/voice/session` returns 429 | Form mode + toast: "Voice limit reached for today. Form is open." |
| OpenAI Realtime returns 5xx | Same. Track in Coolify logs until a dedicated observability stack is added. |
| User goes idle in voice mode | Voice tears down after 20 seconds of inactivity. The form and captured fields remain visible. |
| Conversation reaches max duration | Voice tears down after 150 seconds. The form and captured fields remain visible. |

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
6. Attempts Slack webhook notification when `SLACK_WEBHOOK_URL` is configured.
7. Returns `{ ok: true, id, persisted, notifications }`.

Errors surface as `{ ok: false, error: 'human_readable' }` — UI toasts and
stays in the modal so the user can retry.

## 11. Persistence of captured state

If the user reloads mid-session, current `captured` state is **lost**. We do
not localStorage the partial form because (a) it's a 2-minute interaction and
(b) PDPA cleanliness.

During local development only, the dialog posts the latest captured fields,
transcript, usage, and errors to `GET /api/voice/debug` so agents can inspect
conversation failures without asking the tester to paste browser logs. The
endpoint returns 404 in production.
