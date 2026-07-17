import { describe, expect, it } from "vitest";
import {
  openingVoiceInstruction,
  voiceCloseReasonToast,
  voiceStatusCopy,
} from "@/components/voice-agent/voice-dialog-copy";

describe("voice dialogue activation copy", () => {
  it("uses the reviewed one-sentence opener", () => {
    const instruction = openingVoiceInstruction(false);
    expect(instruction).toContain("Hi, I'm Reka. What would you like to build at Oriental?");
    expect(instruction).toContain("exactly one opening sentence");
  });

  it("acknowledges a detected pause without claiming understanding", () => {
    const immediate = voiceStatusCopy("listening", "waiting_for_response", false);
    expect(immediate.label).toBe("Turn ended");
    expect(immediate.detail).toContain("no understanding is implied");

    const delayed = voiceStatusCopy("listening", "waiting_for_response", true);
    expect(delayed.label).toBe("Reka is responding");
  });

  it("maps speaking phases to distinct live states", () => {
    expect(voiceStatusCopy("listening", "user_speaking").label).toBe("Listening");
    expect(voiceStatusCopy("listening", "assistant_speaking").label).toBe("Reka speaking");
  });

  it("sets accurate expectations for temporary microphone permission", () => {
    expect(voiceStatusCopy("requesting_mic")).toEqual({
      label: "Mic permission",
      detail:
        "If your browser asks, choose its every-visit option to remember the mic. One-time access will ask again later.",
      button: "Opening microphone...",
    });

    expect(voiceCloseReasonToast("mic_denied")).toEqual({
      tone: "error",
      title: "Microphone access is blocked.",
      description:
        "Use the microphone control in your browser's address bar to allow access, then try again — or type the handoff instead.",
    });
  });

  it("distinguishes upstream Realtime capacity from a visitor's daily limit", () => {
    expect(voiceCloseReasonToast("realtime_busy")).toEqual({
      tone: "warning",
      title: "Live voice is busy right now.",
      description: "Your handoff is still here. Try voice again shortly, or keep typing while the service recovers.",
    });
    expect(voiceCloseReasonToast("realtime_quota_exhausted")).toEqual({
      tone: "error",
      title: "Live voice is temporarily unavailable.",
      description: "The team has been alerted. Your handoff is still here, so you can keep typing in the meantime.",
    });
    expect(voiceCloseReasonToast("voice_limit_reached")?.title).toBe("Voice limit reached for today.");
  });

  it("shows the bounded capacity retry without clearing the handoff", () => {
    expect(voiceStatusCopy("reconnecting")).toEqual({
      label: "Reconnecting",
      detail: "Live voice is busy. Reka is making one quick retry without losing your handoff.",
      button: "Reconnecting...",
    });
  });
});
