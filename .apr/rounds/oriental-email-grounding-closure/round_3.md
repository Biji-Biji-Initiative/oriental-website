The provided implementation and specification successfully align on all required behavioral constraints for the grounding boundary closure. Here is a trace of the reducer against every stated contract requirement:

### 1. Direct Routing After Correction (Capture Freshness)
- **Validation**: Incoming `RealtimeServerEvent`s are sequentially reduced. The very first operation (line 193: `state = invalidateSupersededEmailVerification(state)`) runs `emailCorrectionInvalidates` on the newest transcript before processing any function calls (line 299).
- **Impact**: If a user correction arrives, the verification is immediately deleted. When `route_to_team` is subsequently reduced (line 544), `getUnconfirmedFields(next)` catches the missing verification (line 1875) and blocks the API call with `unconfirmed_required_fields` (line 570), securely failing closed.

### 2. Duplicate Calls
- **Validation**: Duplicate capture exits early for non-email fields (line 1087: `if (key !== "email" && !FREE_TEXT_CAPTURE_KEYS.has(key) && duplicateCapture)`), but intentionally forces `email` to continue to `validateCaptureGrounding()`.
- **Impact**: A duplicate email call without fresh evidence cannot exploit previous state success; it must cross the grounding boundary again or fail with `ungrounded_identity_capture` (line 1206).

### 3. Pending Audio & Contradictions
- **Validation**: `transcriptionPendingForCapture` uses precise `item_id` tracking (line 978) to ascertain native audio delays. In `validateEmailCaptureGrounding`, a pending state offers a relaxation (`emailConfidence: "medium"`, line 1243).
- **Impact**: Crucially, this relaxation is strictly gated by checking if a completed turn explicitly contradicts the proposed address (`latestTurnSupersedes && explicitlyReplaces`, lines 1238-1242), preventing an outdated pending capture from superseding a spoken correction.

### 4. Literal and Spoken Replacements (Ordered Corrections)
- **Validation**: Text containing literal addresses (`test@example.com`) is processed by `resolveLiteralEmailSelection` (line 1376) checking for positional cues (e.g. `instead of` or `use`). Spoken addresses (`test at example dot com`) run through `emailTurnSelectsDifferentAddress` and `emailTurnRejectsTarget`.
- **Impact**: "Use new instead of old" applies `"selected"` disposition to the new address and `"rejected"` to the old address (lines 1420-1433), properly preserving intent.

### 5. Alternatives and Secondary Addresses
- **Validation**: `hasSecondaryEmailContext` detects keywords like "invoice" or "billing" (line 814) while `emailTurnOffersAlternatives` looks for "either...or" (line 1490).
- **Impact**: When billing/invoice addresses are mentioned, `resolveEmailClauseSelection` early returns `"none"` (line 766) unless explicit primary ownership (`my contact address`) is detected, preserving the primary contact.

### 6. Typed / Prefill Authority
- **Validation**: A typed interaction directly assigns `emailVerificationIgnoredTranscriptIds` (line 655) and flags `activeResponseStaleForEmail` (line 656).
- **Impact**: `captureWouldReplaceAuthoritativeEmail` prevents incoming functions from replacing a `typed` or `prefill` source address (line 998). If a model tries to wipe it via `clear_field` or mutate it via `capture_field`, it returns `{ ok: false, error: "stale_response", key: "email" }` and cancels response creation (lines 349/502).

### 7. Strict vs. Adaptive Behavior
- **Validation**: Grounding determines bounded ASR support and explicitly evaluates `emailConfidence` (lines 1218-1253). `spokenEmailVerification` interprets `emailCaptureMode` to apply `status: "confirmed"` for adaptive and `status: "pending"` for strict (line 1060).
- **Impact**: Adaptive enables low-friction advancement, while strict mode mandates readback confirmation.

### 8. Stale Draft Retention
- **Validation**: `invalidateSupersededEmailVerification` nullifies `emailVerification` (line 740) but intentionally leaves `state.captured.email` intact.
- **Impact**: The UI can retain an editable state while strictly preventing routeability until the evidence is grounded.

VERDICT: SHIP SAFE DEFAULTS
