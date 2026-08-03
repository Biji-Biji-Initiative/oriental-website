# Oriental adaptive conversation recovery — release specification

## Objective

Repair the production voice behaviour exposed by the latest live session: a
visitor who had supplied a clear spoken address was repeatedly asked to repeat
or confirm it, was told to type, and could not continue to describe their
project. The release must make the governed **adaptive** email-capture mode
behave as a conversational aid rather than an interaction gate.

## Release boundary

The runtime changes are limited to the voice dialog/runtime handoff context,
the Realtime session tool surface and instructions, grounded email replacement
protection, and the associated dependency security pins. No production model,
voice, routing, privacy, admin-authentication, or data-retention selector may
change. Production remains `baseline/control/low/adaptive`; staging remains
the clean candidate cell.

## Required behaviour

1. The server-selected `emailCaptureMode` must be retained when the browser
   creates both its initial and subsequent handoff context. An adaptive session
   must never be serialized as a strict pending-confirmation session.
2. In adaptive mode, a pending email must not block conversation, demand typed
   input, or require a separate yes/no confirmation. The assistant should
   continue with the visitor's current question or idea and make at most one
   natural spoken correction when submission actually needs it.
3. The adaptive Realtime tool surface must not expose `confirm_email`; strict
   mode must retain its existing confirmation behaviour.
4. A high-confidence direct spoken capture must not be replaced by a
   near-identical model-generated spelling variation. The protection is
   intentionally narrow: clearly different, ungrounded, malformed, and
   typed/prefilled values retain their existing checks.
5. Tool-driven form updates must not be reflected back to the assistant as
   synthetic new visitor messages. Deliberate local edits and partner-segment
   changes must still synchronize immediately.
6. Voice source submission and existing grounded-capture safeguards remain
   enforced. This is a removal of conversational friction, not a relaxation of
   authorization, privacy, or server-side input validation.

## Acceptance evidence

- Unit coverage proves adaptive context policy, the absence of the adaptive
  confirmation tool, direct-speech near-miss preservation, and no synthetic
  follow-up context from model tool updates.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and a production
  dependency audit pass for the release head.
- Staging uses the exact merged SHA and passes the governed no-submit voice and
  intake smoke checks before production promotion.
- The review record contains no visitor transcript, email address, name, or
  other captured contact data.

## Rollback

The governed rollback remains an exact SHA redeploy through the standard
Coolify release path. If a capture-policy rollback were separately necessary,
the existing `VOICE_EMAIL_CAPTURE_MODE=strict` configuration remains the
fail-closed operational fallback; it is not changed by this release.
