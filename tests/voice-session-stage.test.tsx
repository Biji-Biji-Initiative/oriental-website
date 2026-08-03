import { fireEvent, render, screen } from "@testing-library/react";
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
    const orb = container.querySelector<HTMLElement>("[data-voice-stage-orb]");
    if (!caption || !action || !composer || !orb) throw new Error("Listening stage is incomplete");

    expect(orb).toHaveAttribute("data-renderer", "production-orb");
    expect(orb.querySelector(".voice-orb__aurora")).toBeInTheDocument();
    expect(orb.querySelector('[data-nebula-m="true"]')).not.toBeInTheDocument();
    expect(caption).toHaveTextContent("A live answer that remains visible while Reka is speaking.");
    expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(caption.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps a persistent mobile email check beside the voice action", () => {
    const onEmailBlur = vi.fn();
    const onEmailChange = vi.fn();
    const onEmailFocus = vi.fn();
    render(
      <VoiceSessionStage
        activeTopicId={null}
        assistantDraft=""
        audioRef={createRef<HTMLAudioElement>()}
        captured={{ ...emptyCapturedLead, email: "asha@example.com" }}
        connectionStatus="listening"
        emailAttention="pending"
        emailInputRef={createRef<HTMLInputElement>()}
        getLocalStream={() => null}
        lastAssistantLine=""
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onEmailBlur={onEmailBlur}
        onEmailChange={onEmailChange}
        onEmailFocus={onEmailFocus}
        onLocalSpeechEnded={vi.fn()}
        onRemoteAudioStarted={vi.fn()}
        onSendText={vi.fn(() => true)}
        onTopicToggle={vi.fn()}
        selectedSegment={getSegment("other")}
        status="idle"
        turnPhase="quiet"
      />,
    );

    const email = screen.getByLabelText("Email to follow up");
    expect(email).toHaveValue("asha@example.com");
    expect(email).toHaveAttribute("aria-required", "true");
    expect(screen.getByText(/say it again naturally, including the domain/i)).toBeVisible();
    fireEvent.focus(email);
    expect(onEmailFocus).toHaveBeenCalledOnce();
    fireEvent.change(email, { target: { value: "asha+team@example.com" } });
    expect(onEmailChange).toHaveBeenCalledWith("asha+team@example.com");
    fireEvent.blur(email);
    expect(onEmailBlur).toHaveBeenCalledOnce();
  });

  it("announces a touched invalid mobile email independently of voice attention", () => {
    const { container } = render(
      <VoiceSessionStage
        activeTopicId={null}
        assistantDraft=""
        audioRef={createRef<HTMLAudioElement>()}
        captured={{ ...emptyCapturedLead, email: "not-an-email" }}
        connectionStatus="idle"
        emailAttention="pending"
        emailTouched
        emailValid={false}
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

    const email = screen.getByLabelText("Email to follow up");
    const error = screen.getByRole("alert");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-errormessage", "voice-quick-email-help");
    expect(error).toHaveTextContent("Enter a valid email, such as name@example.com.");
    expect(container.querySelector("[data-email-quick-capture]")).toHaveAttribute("data-email-state", "invalid");
  });
});
