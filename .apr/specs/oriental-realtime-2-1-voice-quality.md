# Realtime 2.1 voice-quality release contract

Review the exact pull-request tree for the Oriental voice-quality release. This
review may authorize a merge only; the merged SHA, staged proof, and production
promotion remain separate gates. It replaces no production security control and
does not authorize a Convex migration, retention job, DNS change, or raw-log
data-store change.

## Required outcome

1. Production's `control` lane and canonical staging's `candidate` lane both
   use `gpt-realtime-2.1`. Those labels are release provenance, not different
   model aliases. Coral remains the voice in both lanes at speed `1.18` and the
   clean picker is off.
2. Reka must sound calm, concise, and English-first when the visitor speaks
   English. She must not use a presenter-like or overly enthusiastic delivery,
   force typed fallback, or repeat a handoff question after the visitor has
   supplied the details.
3. An unambiguous spoken clear-all request such as “clear the form” or “clear
   up the form” must clear the visible handoff immediately even when a Realtime
   response omits `clear_fields`. Negated or purely interrogative phrases must
   not clear data. The local fallback must use the normal reducer transition,
   revoke local handoff memory, synchronise the empty context to the model, and
   never fabricate an upstream OpenAI function result.
4. The approved Mereka M stays live on staging and production. During active
   voice it must remain a clean, legible M—not high-density, oversized white
   particle blobs. The canvas remains decorative, reduced-motion safe, and
   resource-bounded.
5. The model promotion must not silently weaken the production gate. A deploy
   may accept the previous `gpt-realtime-2` public health only with the explicit
   one-time migration flag; new production health must validate 2.1/control and
   normal releases must reject the prior model.

## Review boundary

Treat a clear caused by negated/question-only speech, a fake OpenAI function
result, stale field restoration, a production candidate/picker leak, an
unbounded or inaccessible visual, an unproven model/speed claim, or an
unscoped previous-model bypass as a ship blocker. Do not ask for unrelated
redesign or use stale historical runtime claims as current proof. End with
exactly `VERDICT: MERGE FOR RELEASE` or `VERDICT: DO NOT MERGE`.
