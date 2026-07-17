Here is the tracing evaluation against the voice intake release contract:

*   **Failure Classification & Retry Selection:** Proven. `lib/voice/realtime-call-failure.ts` parses SDP errors, and only `realtime_busy` receives a retry. Exhausted quota strictly closes (`.apr/evidence/oriental-voice-intake-release.md:5-8`, `166-169`).
*   **Typed Interruption:** Proven. Typed turns predictably serialize cancel, clear, text, and response. Expected no-active-response cancellation is properly filtered (`.apr/evidence/oriental-voice-intake-release.md:18-19`).
*   **Adaptive/Strict Email Grounding/Correction:** Proven. Adaptive captures enforce syntax, evidence grounding, and exact/bounded-ASR drift limits with explicit email cues. Strict mode fail-closes (`.apr/evidence/oriental-voice-intake-release.md:9-12`, `29-30`).
*   **API Submission:** Proven. `/api/leads` requires verification markers for voice and strips them prior to storage (`.apr/evidence/oriental-voice-intake-release.md:16-17`).
*   **Review Persistence:** Proven. Heartbeats preserve `leadId` linkages unconditionally, and snapshots retain PII-free mode/provenance across current deployments (`.apr/evidence/oriental-voice-intake-release.md:20-21`, `31-34`).
*   **Partial-batch Semantics:** Proven. Reducer retains independent valid fields, returns rejected properties for focus, and crashes duplicates before commit (`.apr/evidence/oriental-voice-intake-release.md:24-26`).
*   **Bounded ASR Identity Grounding:** Proven. Native name drift is contained by field cues and one-edit phonetic bounds (`.apr/evidence/oriental-voice-intake-release.md:27-30`).
*   **Primary-Action Visibility:** Proven. Automated layout bounds and three-pane limits are fixed. The action (`<Button data-voice-primary-action>`) appears above fold before scrolling (`.apr/evidence/oriental-voice-intake-release.md:37-43`, `components/voice-agent/VoiceSessionStage.tsx:168-185`).
*   **Caption Retention:** Proven. The `aria-hidden` visual caption renders strictly above the primary action, retaining its bounds between turns (`.apr/evidence/oriental-voice-intake-release.md:47-51`, `components/voice-agent/VoiceSessionStage.tsx:142-152`).
*   **Microphone Lifecycle:** Proven. Explains persistent vs. one-time allocations gracefully (with recovery pointers) without assuming unobservable browser states. Mic streams are torn down cleanly (`.apr/evidence/oriental-voice-intake-release.md:52-54`, `components/voice-agent/VoiceSessionStage.tsx:186-190`, `247-272`).
*   **Per-Tool Telemetry (120-cap replacement):** Proven. Reducer binds a new array to guarantee publish on the 121st call, enforcing identity mutation despite static length (`.apr/evidence/oriental-voice-intake-release.md:55-59`, `104-107`).
*   **Concurrent Routing:** Proven. Persistence and fan-out notifications trigger synchronously while maintaining existing failure constraints (`.apr/evidence/oriental-voice-intake-release.md:59-61`, `162-164`).
*   **Staging-cell Materialization & Infisical Parity:** Proven. Explicitly verified `baseline/candidate(gpt-realtime-2.1)/low/adaptive`, picker `false` structure inside `.env` configurations matching Infisical outputs without exposing secrets (`.apr/evidence/oriental-voice-intake-release.md:108-120`).
*   **Public-Health Verification:** Proven. Round 5 removed tautological verification. Staging tests evaluate against governed properties rather than trusting the fallback endpoints blindly (`.apr/evidence/oriental-voice-intake-release.md:173-179`).
*   **Production Isolation:** Proven. The candidate variant fails closed in production. Production branch stays frozen entirely at `bb8e267` (`.apr/evidence/oriental-voice-intake-release.md:88-92`, `112-114`).
*   **Evaluation Attribution:** Proven. Synthetics and control-cell prompts successfully exclude themselves from availability calculations without polluting actual candidate staging flows (`.apr/evidence/oriental-voice-intake-release.md:22-23`).

**Blocker checks:**
- No unproven claims; evidence lists clear test boundaries, Git SHAs, and Playwright execution (`File 1:133-150`).
- No PII leakage; restricted by PII-free constraints (`File 1:31, 55, 72, 119`).
- No reasoning/runtime promotion (`File 1:94-96`).
- No candidate promotion to production or production mutations (`File 1:88-92`, `117-120`).
- `MerekaMiniMark` renaming confirmed end-to-end (`File 2:6`, `24`).

VERDICT: SHIP SAFE DEFAULTS
