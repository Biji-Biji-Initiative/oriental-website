The `useRealtimeVoiceSession` hook successfully implements the recovery contract with robust guards against async races and capacity failures.

### Adversarial Trace Results
1. **Connect & Status Dishonesty**: `connectGateRef` strictly owns the session start block. The UI explicitly receives the `reconnecting` state during the jitter delay, never appearing idle until manually torn down or completely failed. Concurrent connection attempts are successfully ignored instead of clobbering state.
2. **SDP Retry & Error Classification**: The `for (;;)` loop in `connectVoice` securely scopes the Realtime SDP retry. By delegating to `shouldRetryRealtimeCall(sdpResponse.status, retriesUsed)`, it isolates the 429 status and correctly bounds the attempt limit. Any network timeout or underlying fetch failure skips the loop via the initial `.catch()`, maintaining the required `webrtc_failed` classification without pointless retries.
3. **Context Loss & Credential Exposure**: Telemetry only captures non-sensitive transport metrics (`transportRef`) and emits them through `emitTransport()`. Reversible fields and the ephemeral session remain identical. The `session.client_secret.value` remains enclosed in the fetch header and is neither stored in transport logs nor pushed to Convex metadata.
4. **Duplicate Minting**: `prewarmVoiceSession` properly guards against duplicate execution by returning early if `statusRef.current !== "idle"`. Parallel `obtainVoiceSession` calls piggyback onto `prewarmPromiseRef.current`, eliminating quota leaks.
5. **Teardown Races**: The hook provides excellent protection against stale resolutions:
   - **Stale Permission Results:** The `acquireMicStream` function performs a monotonic identity check via `ownsVoiceConnectAttempt`. An old `getUserMedia` resolution cannot overwrite a newer attempt; it immediately stops all its stray tracks and throws safely.
   - **Stale Finally Blocks:** The `connectVoice` execution completes with `if (connectGateRef.current === attemptId) connectGateRef.current = null;`. A stale fetch failure finishing late will never clear the gate of a newer, legitimate connection attempt.
   - **Jitter Revival:** Both the `wait` delay and the `sdpResponse.text()` await perform `connectionRef.current !== peer || statusRef.current === "idle"` checks. Manual disconnections mid-jitter or mid-fetch will cleanly throw `manual` instead of reviving a dead WebRTC instance.

VERDICT: SHIP
