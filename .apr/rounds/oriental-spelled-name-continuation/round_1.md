Here is the review of the spelled-name continuation parser against the contract.

### 1. Cue Matching, Spacing, and Hyphens
*   **Implementation:** The extraction strictly requires an explicit conversational name cue (`"my name is"`, `"call me"`, etc.) before capturing the individually spoken letters (`lib/voice/tentative-extraction.ts:132-135`).
*   **Spacing/Hyphens:** Handled explicitly by the capture group `(?:[\s-]+|(?=[.!?]|$))` at `lib/voice/tentative-extraction.ts:131`, meaning ASR output like `G-U-R-P-R-E-E-T` and `G U R P R E E T` are uniformly isolated.

### 2. Sentence Continuation & Names Ending in "I"
*   **Implementation:** A trailing "I" pronoun masquerading as the final spelled letter is properly stripped at `lib/voice/tentative-extraction.ts:144-147` if the following context initiates a multi-letter word (`/^[A-Za-z]{2,}/u.test(following)`).
*   **Testing:** Executable proof successfully covers standard continuation (`"G U R P R E E T I am from Mereka."` -> `"Gurpreet"`) and edge cases with names naturally ending in I (`"A L I I am ..."` -> `"Ali"`) at `tests/tentative-extraction.test.ts:30-31`.

### 3. Fail-Closed Ordinary Prose Rejection
*   **Implementation:** Fails closed if the cue is missing. Additionally, enforces a strict `2` to `60` character bound (`lib/voice/tentative-extraction.ts:148`). 
*   **Testing:** Ordinary prose like `"We are building a community lab."` cleanly resolves to `null` (`tests/tentative-extraction.test.ts:32`).

### 4. Runtime Caller & Typed-Chat State (No Email/Routing Mutation)
*   **Caller Application:** The extraction is executed safely inside `applyExplicitSpelledNameUpdate` (`lib/voice/realtime-events.ts:2673-2677`), mutating only the `name` field of the `captured` object (`{ ...state, captured: { ...state.captured, name } }`). 
*   **Typed-Chat State:** Integrated into live interactions at `lib/voice/realtime-events.ts:256` (`appendTypedUserMessage`) and audio completions at `lib/voice/realtime-events.ts:2657`.
*   **Blocker Check:** Broader identity capture and routing logic are completely insulated. `extractExplicitVisitorEmail` logic remains unchanged. Focused test execution actively verifies `expect(result.captured.email).toBe("");` when providing the spelling update (`tests/realtime-events.test.ts:48-53`). 

All explicitly spelled spelling behaviors remain fail-closed without overriding explicit routing authority or other field captures.

VERDICT: SHIP SAFE DEFAULTS
