import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { VoiceSessionStage } from "@/components/voice-agent/VoiceSessionStage";
import { getSegment } from "@/lib/segments";
import { emptyCapturedLead } from "@/lib/voice/realtime-events";

describe("VoiceSessionStage", () => {
  it("keeps the visual live caption hidden from assistive tech and before the primary action", () => {
    const { container } = render(
      <VoiceSessionStage
        activeTopicId={null}
        assistantDraft="A live answer that remains visible while Reka is speaking."
        audioRef={createRef<HTMLAudioElement>()}
        captured={emptyCapturedLead}
        connectionStatus="listening"
        getLocalStream={() => null}
        lastAssistantLine=""
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onLocalSpeechEnded={vi.fn()}
        onRemoteAudioStarted={vi.fn()}
        onSendText={vi.fn(() => true)}
        onTopicToggle={vi.fn()}
        selectedSegment={getSegment("other")}
        status="idle"
        turnPhase="quiet"
      />,
    );

    const caption = container.querySelector<HTMLElement>("[data-voice-stage-caption]");
    const action = container.querySelector<HTMLElement>("[data-voice-primary-action]");
    const composer = container.querySelector<HTMLElement>("[data-voice-stage-composer]");
    if (!caption || !action || !composer) throw new Error("Listening stage is incomplete");

    expect(caption).toHaveTextContent("A live answer that remains visible while Reka is speaking.");
    expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(caption.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
