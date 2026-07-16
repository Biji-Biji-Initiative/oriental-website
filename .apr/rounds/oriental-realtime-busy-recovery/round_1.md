An analysis of the Realtime-busy recovery implementation reveals a critical teardown race resulting in a duplicate microphone leak.

When a visitor connects and their microphone permission is already granted, `connectVoice` executes `acquireMicStream()` and `obtainVoiceSession()` concurrently via `Promise.all`.

If `obtainVoiceSession()` rejects quickly (e.g., due to an immediate HTTP 429 that exhausts limits, a DNS failure, or a CORS error), `Promise.all` immediately rejects. This triggers `teardownVoice()`, which resets `statusRef.current` to `"idle"` and sets `connectGateRef.current` to `false`. Crucially, at this point, the hardware `getUserMedia` promise is often still pending, meaning `localStreamRef.current` is null and no tracks can be stopped yet.

Because `connectGateRef.current` is now false, the user can immediately tap the "Connect" button again. This subsequent tap begins a new `connectVoice` execution and sets `statusRef.current = "connecting"`.

When the OS finally resolves the original `getUserMedia` request, it resumes inside the first `acquireMicStream` call and evaluates its safety check:
```typescript
if (statusRef.current === "idle") {
  for (const track of stream.getTracks()) track.stop();
  throw new VoiceConnectionFailure("manual");
}
```
Because the second connection attempt has already modified `statusRef.current` to `"connecting"`, this check fails. The orphaned execution incorrectly believes it belongs to the active session. It sets `localStreamRef.current = stream` and returns.

Shortly after, the second `acquireMicStream` call resolves its own `getUserMedia` promise. It blindly overwrites `localStreamRef.current` with the second stream. All references to the first stream are permanently lost, and its audio tracks are never stopped. The browser's active-microphone indicator will remain illuminated indefinitely, and the user's microphone continues recording in the background until the tab is closed.

This violates the blockers against teardown races and duplicate mic minting.

VERDICT: DO NOT SHIP
