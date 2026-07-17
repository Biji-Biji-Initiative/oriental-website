# Oriental email grounding closure — ship contract

## Required behavior

1. A completed visitor turn that explicitly rejects or replaces the currently
   verified email MUST invalidate that verification before `route_to_team` can
   submit it.
2. A duplicate email tool call MUST cross the grounding boundary again. It
   MUST NOT turn stale, missing, or corrected evidence into success.
3. Pending transcription MAY preserve the native-audio relaxation at medium
   confidence only when no completed turn contradicts the proposed address.
4. Ordered corrections MUST select the intended address for literal and spoken
   forms: “use new instead of old” accepts new and rejects old.
5. Explicit visitor ownership (`My email is …`, a bare address, or a selected
   `use`/`keep`/`contact me at` address) MUST supersede a stale verified value.
   An explicitly selected current contact address MUST remain valid when a
   later address is clearly secondary, such as billing or invoices.
6. The visible stale draft MAY remain editable after invalidation, but it MUST
   be unrouteable until the replacement is independently grounded.
7. Adaptive mode MUST remain low-friction for fresh exact or bounded-ASR
   evidence. Strict mode and the API submission boundary MUST remain fail
   closed.
8. Verification freshness MUST use non-PII chronology. A typed form edit MUST
   outrank older transcripts, and out-of-order pending transcriptions MUST
   reconcile by their Realtime item identity rather than completion order. The
   edit MUST also invalidate any already-active response for email mutation or
   routing.

## Acceptance

- Focused reducer tests cover stale duplicate, direct-route, pending known
  contradiction, fresh pending relaxation, literal/spoken ordering, explicit
  replacements, alternatives, and selected-contact controls.
- Lint, typecheck, all unit tests, secret contract, and production build pass.
- APR ends with `VERDICT: SHIP SAFE DEFAULTS`.
- The merged exact SHA passes both canonical staging voice smokes before any
  production deployment.
