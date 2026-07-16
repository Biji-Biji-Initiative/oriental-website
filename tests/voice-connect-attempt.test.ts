import { describe, expect, it } from "vitest";
import { ownsVoiceConnectAttempt } from "@/lib/voice/connect-attempt";

describe("voice connection attempt ownership", () => {
  it("rejects a stale microphone result even when a newer attempt is connecting", () => {
    expect(ownsVoiceConnectAttempt(2, 1, "connecting")).toBe(false);
  });

  it("requires both the current generation and a non-idle connection", () => {
    expect(ownsVoiceConnectAttempt(2, 2, "requesting_mic")).toBe(true);
    expect(ownsVoiceConnectAttempt(2, 2, "connecting")).toBe(true);
    expect(ownsVoiceConnectAttempt(2, 2, "idle")).toBe(false);
  });
});
