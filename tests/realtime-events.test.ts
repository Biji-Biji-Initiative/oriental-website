import { describe, expect, it } from "vitest";
import {
  appendTypedUserMessage,
  emptyCapturedLead,
  isBenignVoiceError,
  reduceRealtimeServerEvent,
  responseHasFunctionCall,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";

function state(overrides: Partial<VoiceRuntimeState> = {}): VoiceRuntimeState {
  return {
    segment: "other",
    captured: emptyCapturedLead,
    transcript: [],
    ...overrides,
  };
}

describe("reduceRealtimeServerEvent", () => {
  it("identifies tool-only response completions so timing waits for the spoken follow-up", () => {
    expect(
      responseHasFunctionCall({
        type: "response.done",
        response: { output: [{ type: "function_call", name: "lookup_oriental" }] },
      }),
    ).toBe(true);
    expect(responseHasFunctionCall({ type: "response.done", response: { output: [{ type: "message" }] } })).toBe(false);
  });

  it("tentatively captures only an explicit literal visitor email", () => {
    const typed = appendTypedUserMessage(state(), "My email is asha@example.com");
    expect(typed.captured.email).toBe("asha@example.com");
    expect(typed.emailVerification).toEqual({ value: "asha@example.com", source: "typed", status: "confirmed" });

    const example = appendTypedUserMessage(state(), "The website uses team@example.com as an example.");
    expect(example.captured.email).toBe("");
  });

  it("replaces an existing email when the visitor explicitly supplies a new one", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "correct@example.com" },
        emailVerification: { value: "correct@example.com", source: "prefill", status: "confirmed" },
      }),
      "My email is other@example.com",
    );
    expect(result.captured.email).toBe("other@example.com");
    expect(result.emailVerification).toEqual({ value: "other@example.com", source: "typed", status: "confirmed" });
  });

  it("uses the final literal address in a same-turn correction", () => {
    const result = appendTypedUserMessage(
      state({ emailCaptureMode: "adaptive" }),
      "My email is old@example.com; actually use new@example.com.",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toMatchObject({ status: "confirmed" });
  });

  it.each([
    "Actually, do not use new@example.com; keep the address already there.",
    "Actually, her email is new@example.com.",
    "Actually, Priya's email is new@example.com.",
    "Priya’s email is new@example.com.",
    "My colleague’s email is new@example.com.",
    "The customer email is new@example.com.",
    "The accounts payable email is new@example.com.",
    "The billing department email is new@example.com.",
    "Actually, use new@example.com as an example.",
  ])("does not give contradicted or non-visitor literal corrections capture authority: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual({
      value: "old@example.com",
      source: "typed",
      status: "confirmed",
    });
  });

  it.each([
    "Actually use new@example.com, not old@example.com.",
    "Actually not old@example.com, use new@example.com.",
    "Use new@example.com.",
    "Replace old@example.com with new@example.com.",
    "Change old@example.com to new@example.com.",
    "Update old@example.com with new@example.com.",
    "Use new@example.com, not other@example.com.",
  ])("selects exactly one authorized literal correction regardless of address order: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({
      value: "new@example.com",
      source: "typed",
      status: "confirmed",
    });
  });

  it.each([
    "Actually use new@example.com or other@example.com.",
    "Actually use new@example.com and other@example.com.",
    "Actually use new@example.com, and also other@example.com.",
    "Actually use new@example.com; maybe other@example.com.",
    "Actually use new@example.com; other@example.com is also fine.",
  ])("revokes existing authority when a correction offers competing literals: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it.each([
    "Do not use old@example.com.",
    "old@example.com is not mine.",
    "old@example.com isn’t my email.",
    "old@example.com is not the one.",
  ])("revokes a specifically contradicted current literal: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        activeResponse: true,
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
    expect(result.activeResponseStaleForEmail).toBe(true);
  });

  it("does not let an irrelevant billing aside preserve a rejected current address", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "old@example.com is not mine; billing@example.com is for invoices",
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it("does not let a coordinated billing clause preserve a rejected current address", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "old@example.com is not mine and billing@example.com is for invoices",
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it("does not let an article-prefixed billing clause preserve a rejected current address", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "old@example.com is not mine, and the billing email is billing@example.com",
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it("selects a primary correction even when a later clause describes the old address", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "Actually use new@example.com. The old email was old@example.com",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it("selects a visitor address before a coordinated billing aside", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "My email is new@example.com, billing@example.com is for invoices",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it("selects a visitor address before a purpose-prefixed billing aside", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "My email is new@example.com and for billing use billing@example.com",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it.each([
    "Actually use new@example.com instead of billing@example.com for invoices",
    "Use new@example.com rather than billing@example.com for invoices",
    "My email is new@example.com plus billing@example.com for invoices",
  ])("selects the visitor address across a replacement/comparison coordinator: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it.each([
    "old@example.com, no that is not mine",
    "old@example.com, no that email is not mine",
    "old@example.com, no this is not mine",
    "old@example.com, nope, that is not mine",
    "old@example.com, that’s not it",
    "old@example.com, scratch that",
    "old@example.com, that’s my old email",
    "old@example.com; actually that one is wrong",
    "old@example.com, no that's not mine",
    "old@example.com; actually it’s wrong",
    "old@example.com, not that one",
    "old@example.com, no that is not mine and billing@example.com is for invoices",
  ])("binds an immediate anaphoric rejection to the preceding address: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it.each([
    "old@example.com is my old email",
    "old@example.com is Priya’s email",
  ])("revokes a current address explicitly reassigned to historical or third-party ownership: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it.each([
    "Use new@example.com; other@example.com is Priya’s email",
    "Use new@example.com; other@example.com is an example",
  ])("selects the visitor address while ignoring a labelled non-visitor address: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it("selects an address that the visitor explicitly owns while ignoring a billing address", () => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "new@example.com is mine, billing@example.com is for invoices",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toEqual({ value: "new@example.com", source: "typed", status: "confirmed" });
  });

  it("does not select the first address from an unresolved visitor declaration", () => {
    const result = appendTypedUserMessage(state(), "My email is first@example.com or second@example.com.");
    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
  });

  it("promotes an identical typed address and fences older ASR work", () => {
    const result = appendTypedUserMessage(
      state({
        activeResponse: true,
        captured: { ...emptyCapturedLead, email: "person@example.com" },
        emailVerification: { value: "person@example.com", source: "speech", status: "pending" },
        pendingUserTranscriptIds: ["older-asr-item"],
        emailGroundingAwaitingTranscript: { value: "person@example.com", userTurnCount: 0, itemId: "older-asr-item" },
      }),
      "My email is person@example.com.",
    );

    expect(result.emailVerification).toEqual({
      value: "person@example.com",
      source: "typed",
      status: "confirmed",
    });
    expect(result.emailVerificationUserTurnSequence).toBe(1);
    expect(result.emailVerificationIgnoredTranscriptIds).toEqual(["older-asr-item"]);
    expect(result.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(result.activeResponseStaleForEmail).toBe(true);

    const late = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "older-asr-item",
        transcript: "Actually, use old@example.com.",
      },
      result,
    );
    expect(late.state.captured.email).toBe("person@example.com");
    expect(late.state.emailVerification).toMatchObject({ source: "typed", status: "confirmed" });
  });

  it.each([
    "Sorry, I meant new.",
    "No, I said new.",
  ])("invalidates a current email after a short contextual correction: %s", (correction) => {
    let current = appendTypedUserMessage(state(), "My email is old@example.com.");
    current = appendTypedUserMessage(current, correction);

    expect(current.captured.email).toBe("");
    expect(current.emailVerification).toBeUndefined();
  });

  it("keeps a current email when a short correction follows unrelated context", () => {
    let current = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      "The meeting is on Monday.",
    );
    current = appendTypedUserMessage(current, "Sorry, I meant Tuesday.");

    expect(current.captured.email).toBe("old@example.com");
  });

  it("captures function call fields from response.done output items", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_1",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com", evidence: "asha@example.com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("asha@example.com");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_1",
        createResponse: true,
        output: {
          ok: true,
          key: "email",
          mode: "replace",
          emailConfirmationRequired: true,
          emailReadback: "asha at example dot com",
          nextAction: expect.stringContaining("Read emailReadback verbatim"),
          captured: { ...emptyCapturedLead, email: "asha@example.com" },
        },
      },
    ]);
    expect(result.state.emailVerification).toEqual({
      value: "asha@example.com",
      source: "speech",
      status: "pending",
    });
  });

  it("routes a grounded speech email without a confirmation turn in adaptive mode", () => {
    const capture = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_adaptive_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha@example.com",
                evidence: "asha at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha at example dot com." }] }),
    );

    expect(capture.state.emailCaptureMode).toBe("adaptive");
    expect(capture.state.emailVerification).toEqual({
      value: "asha@example.com",
      source: "speech",
      status: "confirmed",
      confidence: "high",
    });
    expect(capture.commands[0]).toMatchObject({
      output: {
        ok: true,
        emailConfirmationRequired: false,
        emailCaptureMode: "adaptive",
        emailConfidence: "high",
        nextAction: expect.stringContaining("without asking for a separate confirmation"),
      },
    });

    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_adaptive_route",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      capture.state,
    );
    expect(routed.commands).toEqual([{ type: "submit_voice", callId: "call_adaptive_route", segment: "technology" }]);
  });

  it("keeps bounded ASR drift pending in the visible editor without a spoken read-back", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_adaptive_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asia dot lim at example dot my." }] }),
    );

    expect(result.state.emailVerification).toMatchObject({
      status: "pending",
      source: "speech",
      confidence: "medium",
    });
    expect(result.commands[0]).toMatchObject({
      output: {
        emailConfirmationRequired: false,
        emailCheckRequired: true,
        emailCaptureMode: "adaptive",
      },
    });
  });

  it.each([
    "sora.kim@gmail.com",
    "saraxlim@gmail.com",
    "sara_lim@gmail.com",
    "sara-lim@gmail.com",
    "sara+lim@gmail.com",
    "sara.lim@gmajl.com",
  ])("never auto-confirms an approximate spoken mailbox: %s", (modelEmail) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: `call_spoken_substitution_${modelEmail}`,
              arguments: JSON.stringify({
                key: "email",
                value: modelEmail,
                evidence: "sara dot lim at gmail dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is sara dot lim at gmail dot com." }] }),
    );

    expect(result.state.emailVerification).toMatchObject({
      value: modelEmail,
      source: "speech",
      status: "pending",
      confidence: "medium",
    });
    expect(result.commands[0]).toMatchObject({
      output: { emailConfirmationRequired: false, emailCheckRequired: true, emailCaptureMode: "adaptive" },
    });
  });

  it("re-evaluates a corrected adaptive email and still blocks an invented replacement", () => {
    const initial = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_initial_adaptive_email",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com", evidence: "asha@example.com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha@example.com." }] }),
    );
    const corrected = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_corrected_adaptive_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.com",
                evidence: "actually asha dot lim at example dot com",
              }),
            },
          ],
        },
      },
      {
        ...initial.state,
        transcript: [
          ...initial.state.transcript,
          { role: "user", text: "Actually, it is asha dot lim at example dot com." },
        ],
      },
    );
    expect(corrected.state.captured.email).toBe("asha.lim@example.com");
    expect(corrected.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });

    const invented = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_invented_replacement",
              arguments: JSON.stringify({
                key: "email",
                value: "sales@example.com",
                evidence: "sales at example dot com",
              }),
            },
          ],
        },
      },
      corrected.state,
    );
    expect(invented.state.captured.email).toBe("asha.lim@example.com");
    expect(invented.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a one-character email drift instead of changing the visitor's address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_near_miss",
              arguments: JSON.stringify({ key: "email", value: "g@g.com", evidence: "g at b dot com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is g at b dot com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
    expect(result.state.errors).toContainEqual(
      expect.objectContaining({ code: "voice_capture_rejected_email", message: expect.stringContaining("email") }),
    );
  });

  it("never applies approximate matching to a different literal address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_literal_email_near_miss",
              arguments: JSON.stringify({
                key: "email",
                value: "sora.kim@gmail.com",
                evidence: "sara.lim@gmail.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is sara.lim@gmail.com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps a native-audio email as a pending draft when ASR spelling drifts", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_asr_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asia dot lim at example dot my." }] }),
    );

    expect(result.state.captured.email).toBe("asha.lim@example.my");
    expect(result.state.emailVerification).toEqual({
      value: "asha.lim@example.my",
      source: "speech",
      status: "pending",
    });
    expect(result.commands[0]).toMatchObject({
      output: { ok: true, emailConfirmationRequired: true, emailReadback: "asha dot lim at example dot my" },
    });
  });

  it("still rejects a self-consistent email invention when the user gave no contact detail", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_invented",
              arguments: JSON.stringify({
                key: "email",
                value: "invented@example.com",
                evidence: "invented at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "We want to run a robotics workshop." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("requires an exact read-back confirmation before routing a speech email", () => {
    const capture = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_exact",
              arguments: JSON.stringify({ key: "email", value: "g@b.com", evidence: "g at b dot com" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is g at b dot com." }] }),
    );
    const prematureRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_too_soon",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      capture.state,
    );

    expect(prematureRoute.commands[0]).toMatchObject({
      output: {
        ok: false,
        error: "unconfirmed_required_fields",
        unconfirmedFields: ["email"],
      },
    });

    let confirmedState = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "I heard g at b dot com. Is that right?" },
      prematureRoute.state,
    ).state;
    confirmedState = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Yes, that's correct. Do not send it yet.",
      },
      confirmedState,
    ).state;
    confirmedState = reduceRealtimeServerEvent(
      {
        type: "response.output_audio_transcript.done",
        transcript: "Alright, let me lock that confirmation in first.",
      },
      confirmedState,
    ).state;
    const contradictedConfirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_contradicted_email",
              arguments: JSON.stringify({ evidence: "Yes, that's not correct" }),
            },
          ],
        },
      },
      confirmedState,
    );
    expect(contradictedConfirmation.commands[0]).toMatchObject({
      output: { ok: false, error: "email_confirmation_not_explicit", key: "email" },
    });

    const confirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_email",
              arguments: JSON.stringify({ evidence: "Yes, that's correct. Do not send it yet" }),
            },
          ],
        },
      },
      confirmedState,
    );
    expect(confirmation.state.emailVerification).toEqual({
      value: "g@b.com",
      source: "speech",
      status: "confirmed",
    });

    const route = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_confirmed",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      confirmation.state,
    );
    expect(route.commands).toEqual([{ type: "submit_voice", callId: "call_route_confirmed", segment: "technology" }]);
  });

  it.each([
    "I heard x sora dot kim at gmail dot com. Is that right?",
    "I heard sora dot kim at gmail dot com x. Is that right?",
  ])("rejects an email embedded inside a different read-back: %s", (readback) => {
    const captured = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_capture_bounded_readback",
              arguments: JSON.stringify({
                key: "email",
                value: "sora.kim@gmail.com",
                evidence: "sora dot kim at gmail dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "sora dot kim at gmail dot com" }] }),
    );
    const withReadback = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: readback },
      captured.state,
    ).state;
    const withConfirmation = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Yes, correct.",
      },
      withReadback,
    ).state;
    const confirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_bounded_readback",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      withConfirmation,
    );

    expect(confirmation.state.emailVerification?.status).toBe("pending");
    expect(confirmation.commands[0]).toMatchObject({
      output: { ok: false, error: "email_readback_missing", key: "email" },
    });
  });

  it.each([
    "right",
    "great",
    "perfect",
    "thanks",
    "so",
    "and",
    "okay",
    "ok",
    "alright",
    "confirm",
  ])("does not strip a valid wrapped read-back local part named %s", (localPart) => {
    const email = `${localPart}@example.com`;
    const captured = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: `call_capture_${localPart}`,
              arguments: JSON.stringify({
                key: "email",
                value: email,
                evidence: `${localPart} at example dot com`,
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: `${localPart} at example dot com` }] }),
    );
    const withReadback = reduceRealtimeServerEvent(
      {
        type: "response.output_audio_transcript.done",
        transcript: `Okay, just to confirm your email is ${localPart} at example dot com. Is that exactly right?`,
      },
      captured.state,
    ).state;
    const withConfirmation = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "Yes, correct.",
      },
      withReadback,
    ).state;
    const confirmation = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: `call_confirm_${localPart}`,
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      withConfirmation,
    );

    expect(confirmation.state.emailVerification).toMatchObject({ value: email, status: "confirmed" });
  });

  it("rejects strict confirmation when the same completed turn replaces the read-back email", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirmation_with_replacement",
              arguments: JSON.stringify({ evidence: "Yes" }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "speech", status: "pending" },
        transcript: [
          { role: "assistant", text: "I heard old at example dot com. Is that right?" },
          { role: "user", text: "Yes, actually use new@example.org instead." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "old@example.com", status: "pending" });
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "email_confirmation_contradicted", key: "email" },
    });
  });

  it.each([
    "Yes, except the first letter is n.",
    "Yes, apart from the domain.",
    "Yes, though it should end in dot org.",
    "Yes, except the domain is dot org.",
    "Yes, but change the first letter.",
    "Mostly, yes.",
    "Yeah, no.",
    "Yes and no.",
    "Yes, not quite.",
    "Yes, sort of.",
    "Yes, maybe.",
    "Yes, with one exception.",
  ])("rejects a qualified strict confirmation: %s", (answer) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_qualified_confirmation",
              arguments: JSON.stringify({ evidence: "yes" }),
            },
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_qualified_confirmation",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "speech", status: "pending" },
        transcript: [
          { role: "assistant", text: "I heard old at example dot com. Is that right?" },
          { role: "user", text: answer },
        ],
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "email_confirmation_contradicted", key: "email" },
    });
    expect(result.commands[1]).toMatchObject({
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it("pre-scans a response so routing cannot outrun a later authoritative-email conflict", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_before_authority_conflict",
              arguments: JSON.stringify({ segment: "technology" }),
            },
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_late_authority_conflict",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.org",
                evidence: "new at example dot org",
              }),
            },
          ],
        },
      },
      state({
        activeResponse: true,
        activeResponseTranscriptBinding: { pending: true, itemId: "audio_new" },
        pendingUserTranscripts: 1,
        pendingUserTranscriptIds: ["audio_new"],
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_late_authority_conflict",
        createResponse: false,
        output: { ok: false, error: "stale_response", key: "email" },
      },
      {
        type: "function_result",
        callId: "call_route_before_authority_conflict",
        createResponse: false,
        output: { ok: false, error: "stale_response" },
      },
    ]);
  });

  it("reduces email mutations before routing even when model output orders route first", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_before_valid_replacement",
              arguments: JSON.stringify({ segment: "technology" }),
            },
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_valid_replacement_after_route",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.org",
                evidence: "new@example.org",
              }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [{ role: "user", text: "Use new@example.org." }],
      }),
    );

    expect(result.state.captured.email).toBe("new@example.org");
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([
      expect.objectContaining({
        type: "function_result",
        callId: "call_valid_replacement_after_route",
        output: expect.objectContaining({ ok: true, key: "email" }),
      }),
      { type: "submit_voice", callId: "call_route_before_valid_replacement", segment: "technology" },
    ]);
  });

  it("captures several grounded fields atomically", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_batch",
              arguments: JSON.stringify({
                fields: [
                  { key: "name", value: "Asha Lim", evidence: "Asha Lim" },
                  { key: "email", value: "asha@example.com", evidence: "asha at example dot com" },
                  { key: "message", value: "We run robotics workshops." },
                ],
              }),
            },
          ],
        },
      },
      state({
        transcript: [{ role: "user", text: "I'm Asha Lim, asha at example dot com. We run robotics workshops." }],
      }),
    );

    expect(result.state.captured).toMatchObject({
      name: "Asha Lim",
      email: "asha@example.com",
      message: "We run robotics workshops.",
    });
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, fields: [{ key: "name" }, { key: "email" }, { key: "message" }] },
    });
  });

  it("retains valid fields when one identity field in a batch is ungrounded", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_atomic_reject",
              arguments: JSON.stringify({
                fields: [
                  { key: "message", value: "A robotics workshop." },
                  { key: "email", value: "invented@example.com", evidence: "invented at example dot com" },
                ],
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "We want to run a robotics workshop." }] }),
    );

    expect(result.state.captured).toEqual({ ...emptyCapturedLead, message: "A robotics workshop." });
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: false,
        error: "partial_capture",
        fields: [{ key: "message", mode: "replace" }],
        rejectedFields: [{ index: 1 }],
        detail: { error: "ungrounded_identity_capture", key: "email" },
        retry: expect.stringContaining("visible email field"),
      },
    });
  });

  it("records every rejected identity field and preserves email attribution in a partial batch", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_multi_identity_reject",
              arguments: JSON.stringify({
                fields: [
                  { key: "name", value: "Invented Name", evidence: "Invented Name" },
                  { key: "email", value: "invented@example.com", evidence: "invented@example.com" },
                ],
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "We have a robotics project." }] }),
    );

    expect(result.state.errors).toEqual([
      expect.objectContaining({ message: "capture_fields:ungrounded_identity_capture:name" }),
      expect.objectContaining({ message: "capture_fields:ungrounded_identity_capture:email" }),
    ]);
  });

  it("rejects duplicate keys instead of applying ambiguous batch order", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_duplicate_batch",
              arguments: JSON.stringify({
                fields: [
                  { key: "message", value: "First." },
                  { key: "message", value: "Second.", mode: "append" },
                ],
              }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.state.captured.message).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "invalid_field_batch", detail: { error: "duplicate_field" } },
    });
  });

  it("answers factual lookup calls from the bounded local knowledge base", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "lookup_oriental",
              call_id: "call_lookup",
              arguments: JSON.stringify({ topic: "pricing", query: "full floor size" }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.state.captured).toEqual(emptyCapturedLead);
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, topic: "pricing", matches: expect.any(Array) },
    });
    expect(JSON.stringify(result.commands[0])).toContain("2,800–3,000 sq ft");
  });

  it("waits for response.done before executing function calls", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "capture_field",
          call_id: "call_too_early",
          arguments: JSON.stringify({ key: "name", value: "Asha", evidence: "Asha" }),
        },
      },
      state({ transcript: [{ role: "user", text: "I am Asha." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands).toHaveLength(0);
  });

  it("routes only through known segments and asks the UI to submit", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_2",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailVerification: { value: "asha@example.com", source: "typed", status: "confirmed" },
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          phone: "",
          website: "",
          message: "We want to run public AI literacy demos.",
        },
      }),
    );

    expect(result.state.segment).toBe("technology");
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([{ type: "submit_voice", callId: "call_2", segment: "technology" }]);
  });

  it("allows spoken email corrections that only add punctuation", () => {
    const current = state({
      captured: { ...emptyCapturedLead, email: "saralim@gmail.com" },
      transcript: [{ role: "user", text: "Sorry, it is sara dot lim at gmail dot com." }],
    });

    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "sara.lim@gmail.com",
                evidence: "sara dot lim at gmail dot com",
              }),
            },
          ],
        },
      },
      current,
    );

    expect(result.state.captured.email).toBe("sara.lim@gmail.com");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: true, key: "email", captured: expect.objectContaining({ email: "sara.lim@gmail.com" }) },
    });
  });

  it("does not route malformed email addresses", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_bad_email",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, email: "sara at gmail", message: "AI demos." } }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_bad_email",
        createResponse: true,
        output: {
          ok: false,
          ready: false,
          segment: "technology",
          error: "invalid_required_fields",
          missingFields: [],
          missingFieldLabels: [],
          invalidFields: ["email"],
          invalidFieldLabels: ["email"],
          captured: { ...emptyCapturedLead, email: "sara at gmail", message: "AI demos." },
        },
      },
    ]);
  });

  it("does not submit twice after a route was already requested", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_3",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        routeRequested: true,
        emailVerification: { value: "asha@example.com", source: "typed", status: "confirmed" },
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          phone: "",
          website: "",
          message: "We want to run public AI literacy demos.",
        },
      }),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_3",
        createResponse: true,
        output: { ok: false, error: "route_already_requested", segment: "technology" },
      },
    ]);
  });

  it("does not route incomplete leads", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_incomplete",
              arguments: JSON.stringify({ segment: "education" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Asha" } }),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_incomplete",
        createResponse: true,
        output: {
          ok: false,
          ready: false,
          segment: "education",
          error: "missing_required_fields",
          missingFields: ["email"],
          missingFieldLabels: ["email"],
          invalidFields: [],
          invalidFieldLabels: [],
          captured: { ...emptyCapturedLead, name: "Asha" },
        },
      },
    ]);
  });

  it("treats whitespace-only fields as missing before routing", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_whitespace",
              arguments: JSON.stringify({ segment: "education" }),
            },
          ],
        },
      },
      state({
        captured: {
          name: "Asha",
          email: "   ",
          org: "Future Lab",
          phone: "",
          website: "",
          message: "AI literacy demos.",
        },
      }),
    );

    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: false,
        ready: false,
        missingFields: ["email"],
        missingFieldLabels: ["email"],
        invalidFields: [],
        invalidFieldLabels: [],
      },
    });
  });

  it("summarises readiness with missing-field labels", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [{ type: "function_call", name: "summarise_lead", call_id: "call_summary", arguments: "{}" }],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Asha", message: "A programme idea." } }),
    );

    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: {
        ok: true,
        ready: false,
        missingFields: ["email"],
        missingFieldLabels: ["email"],
        invalidFields: [],
        invalidFieldLabels: [],
        routeRequested: false,
      },
    });
  });

  it("does not apply the same function call twice", () => {
    const event = {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            name: "capture_field",
            call_id: "call_repeat",
            arguments: JSON.stringify({ key: "name", value: "Asha", evidence: "Asha" }),
          },
        ],
      },
    };

    const first = reduceRealtimeServerEvent(event, state({ transcript: [{ role: "user", text: "I am Asha." }] }));
    const second = reduceRealtimeServerEvent(event, first.state);

    expect(first.commands).toHaveLength(1);
    expect(second.commands).toHaveLength(0);
    expect(second.state.captured.name).toBe("Asha");
  });

  it("stores assistant transcript text without duplicating identical final messages", () => {
    const first = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hello there." },
      state(),
    ).state;
    const second = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hello there." },
      first,
    ).state;

    expect(second.transcript).toEqual([{ role: "assistant", text: "Hello there." }]);
  });

  it("replaces a truncated assistant caption with its complete final line", () => {
    const partial = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I'm R" },
      state(),
    ).state;
    const complete = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I'm Reka. What would you like to build?" },
      partial,
    ).state;

    expect(complete.transcript).toEqual([{ role: "assistant", text: "Hi, I'm Reka. What would you like to build?" }]);
  });

  it("stores user transcription and transcription token usage", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "My name is Asha.",
        usage: { total_tokens: 26, input_tokens: 17, output_tokens: 9 },
      },
      state(),
    );

    expect(result.state.transcript).toEqual([{ role: "user", text: "My name is Asha." }]);
    expect(result.state.usage).toMatchObject({
      transcriptionCount: 1,
      transcriptionTokens: 26,
      transcriptionInputTokens: 17,
      transcriptionOutputTokens: 9,
    });
  });

  it("captures response usage totals", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          usage: {
            total_tokens: 253,
            input_tokens: 132,
            output_tokens: 121,
            input_token_details: { cached_tokens: 64 },
          },
        },
      },
      state(),
    );

    expect(result.state.usage).toMatchObject({
      responseCount: 1,
      responseTokens: 253,
      responseInputTokens: 132,
      responseOutputTokens: 121,
      responseCachedTokens: 64,
    });
  });

  it("returns wait_for_user output without creating a spoken response", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "wait_for_user",
              call_id: "call_wait",
              arguments: "{}",
            },
          ],
        },
      },
      state(),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_wait",
        createResponse: false,
        output: { ok: true, waited: true },
      },
    ]);
  });

  it("ends the voice session without asking the model to keep speaking", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "end_call",
              call_id: "call_end",
              arguments: JSON.stringify({ reason: "user_done" }),
            },
          ],
        },
      },
      state(),
    );

    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_end",
        createResponse: false,
        output: { ok: true, ended: true, reason: "user_done" },
      },
      { type: "end_voice", reason: "user_done" },
    ]);
  });

  it("rejects ungrounded identity fields instead of hallucinating contact details", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_hallucinated_name",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "I want to explore an AI demo partnership." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_hallucinated_name",
        createResponse: true,
        output: { ok: false, error: "ungrounded_identity_capture", key: "name", value: "Alex Tan" },
      },
    ]);
  });

  it("accepts spoken email evidence when it matches the user transcript", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim+ai@example.com",
                evidence: "asha dot lim plus ai at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is asha dot lim plus ai at example dot com." }] }),
    );

    expect(result.state.captured.email).toBe("asha.lim+ai@example.com");
  });

  it("accepts ASR hyphen separators between individually spelled local-part letters", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_hyphen_spelling",
              arguments: JSON.stringify({
                key: "email",
                value: "gurpreet@example.com",
                evidence: "g-u-r-p-r-e-e-t at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is G, g-u-r-p-r-e-e-t at example dot com." }] }),
    );

    expect(result.state.captured.email).toBe("gurpreet@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed" });
  });

  it("preserves an explicitly spoken dash in an email", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_dash",
              arguments: JSON.stringify({
                key: "email",
                value: "g-p@example.com",
                evidence: "g dash p at example dot com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My email is g dash p at example dot com." }] }),
    );

    expect(result.state.captured.email).toBe("g-p@example.com");
  });

  it("invalidates a stale confirmed prefill when a grounded replacement attempt is rejected", () => {
    const rejected = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_bad_replacement_evidence",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.com",
                evidence: "new at wrong dot invalid",
              }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "prefill", status: "confirmed" },
        transcript: [{ role: "user", text: "Actually, use new at example dot com for my email." }],
      }),
    );

    expect(rejected.state.captured.email).toBe("");
    expect(rejected.state.emailVerification).toBeUndefined();
    expect(rejected.commands[0]).toMatchObject({
      output: {
        ok: false,
        previousEmailInvalidated: true,
        nextAction: expect.stringContaining("visible email field"),
      },
    });

    const route = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_rejected_replacement",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      rejected.state,
    );
    expect(route.state.routeRequested).toBeFalsy();
    expect(route.commands[0]).toMatchObject({ output: { ok: false, error: "missing_required_fields" } });
  });

  it("keeps a grounded email valid across a trailing unrelated microphone transcription", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_fields",
              call_id: "call_email_after_mic_race",
              arguments: JSON.stringify({
                fields: [
                  {
                    key: "email",
                    value: "qa.nebula@example.test",
                    evidence: "q a dot nebula at example dot test",
                  },
                ],
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is q a dot nebula at example dot test." },
          { role: "user", text: "Sorry, background audio says we can meet at 3." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("qa.nebula@example.test");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
    expect(result.commands[0]).toMatchObject({ output: { ok: true, emailConfirmationRequired: false } });
  });

  it("does not revive an older email after a newer correction", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_stale_email_after_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old at example dot com." },
          { role: "user", text: "Actually, use new at example dot com instead." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("re-grounds a duplicate email instead of accepting a stale captured value", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_stale_duplicate_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, use new@example.com instead." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("invalidates a corrected email before a direct route can submit the stale address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_email_correction",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, use new@example.com instead." },
        ],
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_route_after_email_correction",
        createResponse: true,
        output: expect.objectContaining({
          ok: false,
          error: "unconfirmed_required_fields",
          unconfirmedFields: ["email"],
        }),
      },
    ]);
  });

  it.each([
    "My email is new@example.com.",
    "new@example.com",
    "No, not old@example.com; use new@example.com.",
    "Use new@example.com.",
    "Use new at example dot com.",
    "new at example dot com",
  ])("invalidates stale verification for an explicit replacement before routing: %s", (correction) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_explicit_replacement",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: correction },
        ],
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it.each([
    "My email is old@example.com—actually, new@example.com.",
    "Use old@example.com—actually, use new@example.com.",
    "old@example.com—no, new@example.com.",
    "No, it is new@example.com.",
    "Go with new@example.com.",
    "Switch to new@example.com.",
    "Guna new@example.com, bukan old@example.com.",
  ])("uses the last decisive replacement before routing: %s", (correction) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_ordered_replacement",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: correction },
        ],
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it.each([
    "Use old at example dot com—actually, use new at example dot com.",
    "Use old@example.com—actually, not old@example.com.",
    "Use old at example dot com—actually, not old at example dot com.",
    "Either old@example.com or new@example.com works, but actually use new@example.com.",
    "Both old@example.com and new@example.com work; actually use new@example.com.",
    "Either old at example dot com or new at example dot com works, but actually use new at example dot com.",
    "Use old at example dot com. Either old at example dot com or new at example dot com works, but actually use new at example dot com.",
    "Either old at example dot com or new at example dot com is acceptable, but actually use new at example dot com.",
    "Either old at example dot com or new at example dot com works; actually, new at example dot com.",
    "Either old at example dot com or new at example dot com works; actually use new at example dot com or text me.",
    "My website is example dot com; use new@example.com for email.",
    "The website is at example dot com, and use new at example dot com for email.",
    "Website is example dot com; email: new at example dot com.",
    "Website is example dot com; use new at example dot com as the email.",
    "Actually, the email domain is example dot org.",
    "Actually, change the email domain to example dot org.",
    "The website is example dot com. Actually, use new at example dot org.",
    "The website is example dot com. Actually, the contact address is new at example dot org.",
    "The website is example dot com. Actually, reach us at new at example dot org.",
    "Either old at example dot com or new at example dot com works; choose new at example dot com.",
    "Either old at example dot com or new at example dot com works; I prefer new at example dot com.",
    "Either old@example.com or new@example.com works; choose new@example.com.",
    "Either old@example.com or new@example.com works; I prefer new@example.com.",
    "Either old at example dot com or new at example dot com works; actually use new at example dot com, then keep my name as Asha.",
    "The website is example dot com, actually new at example dot org.",
    "The website is example dot com — actually new at example dot org.",
    "The website is example dot com and actually new at example dot org.",
    "The website is example dot com, I meant new at example dot org.",
    "Actually, use new@example.org. The old email was old@example.com.",
    "Actually, use new at example dot org. The old email was old at example dot com.",
    "New at example dot org should replace old at example dot com.",
    "Use new at example dot org as the replacement for old at example dot com.",
    "My email is new at example dot com; old at example dot com is just for invoices.",
    "Actually, use new@example.org. It used to be old@example.com.",
    "Actually, use new@example.org. Old@example.com was the previous address.",
    "Actually, use new at example dot org; old at example dot com was the previous address.",
    "I prefer new at example dot org over old at example dot com.",
    "Use new at example dot org in place of old at example dot com.",
    "Choose new at example dot org over old at example dot com.",
    "Use new at example dot org versus old at example dot com.",
    "Either old at example dot com or new at example dot org works, select new at example dot org.",
    "Actually, use new@example.org. My email used to be old@example.com.",
    "Actually, use new at example dot org. My email used to be old at example dot com.",
    "Actually, use new@example.org. I used old@example.com right before this.",
    "Actually, use new@example.org. In the archive, it is old@example.com.",
    "Actually, use new@example.org. Old@example.com was the right one until yesterday.",
    "Actually, use new@example.org. Back then my email was old@example.com.",
    "My email used to be old@example.com and now it is new@example.org.",
    "My email used to be old at example dot com and now it is new at example dot org.",
    "I used old@example.com before, now my email is new@example.org.",
    "Back then my email was old@example.com, now it is new@example.org.",
    "Old@example.com was the previous address, new@example.org is current.",
    "My old address was old at example dot com and my new address is new at example dot org.",
    "Either new@example.org or alt@example.org works for my email.",
    "Either new at example dot org or alt at example dot org works for my email.",
    "The current one is new at example dot org, the old one is old at example dot com.",
    "The new one is new at example dot org and the old one was old at example dot com.",
    "The active address is new at example dot org, the inactive address was old at example dot com.",
    "The correct one is new at example dot org and old at example dot com was previous.",
    "Today it is new at example dot org, yesterday it was old at example dot com.",
    "It has moved to new at example dot org from old at example dot com.",
    "Use new@example.org for my email and billing.",
    "My email is new@example.org and it is also for invoices.",
    "Use new at example dot org for my contact and billing.",
    "Use new at example dot org for billing too.",
    "Use new@example.org as my contact address for accounts.",
    "Contact me at new at example dot org about the invoice.",
  ])("honours a later spoken, rejected, or post-alternative decision: %s", (correction) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_later_decision",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [{ role: "user", text: correction }],
      }),
    );

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it("keeps an explicitly selected contact email when a later address is only for invoices", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_selected_contact_email",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, use old@example.com; new@example.com is only for invoices." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "old@example.com", status: "confirmed" });
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_selected_contact_email", segment: "technology" },
    ]);
  });

  it("keeps a selected contact address when a later labelled address is billing-only", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_contact_then_billing",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "contact@example.com" },
        emailVerification: {
          value: "contact@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          {
            role: "user",
            text: "Use contact@example.com for contact; billing email is billing@example.com for invoices.",
          },
        ],
      }),
    );

    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_contact_then_billing", segment: "technology" },
    ]);
  });

  it("does not replace the contact email with a billing contact address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_billing_contact",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "contact@example.com" },
        emailVerification: {
          value: "contact@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [{ role: "user", text: "For invoices, the billing contact address is bills@example.com." }],
      }),
    );

    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_billing_contact", segment: "technology" },
    ]);
  });

  it.each([
    "My email is new@example.com, but use old@example.com for this enquiry.",
    "Contact me at new@example.com; actually keep old@example.com for this.",
    "Either old@example.com or new@example.com works, but actually keep old@example.com.",
    "Either old at example dot com or new at example dot com works, but actually keep old at example dot com.",
    "Use new at example dot com—actually, keep old at example dot com.",
  ])("keeps the current address when it is the final explicit selection: %s", (selection) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_final_current_selection",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [{ role: "user", text: selection }],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "old@example.com", status: "confirmed" });
    expect(result.state.routeRequested).toBe(true);
    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_final_current_selection", segment: "technology" },
    ]);
  });

  it("does not reinterpret an older transcript after the visitor edits the form email", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_typed_form_edit",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "new@example.com" },
        emailVerification: { value: "new@example.com", source: "typed", status: "confirmed" },
        emailVerificationUserTurnSequence: 1,
        transcript: [{ role: "user", text: "My email is old@example.com." }],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({
      value: "new@example.com",
      source: "typed",
      status: "confirmed",
    });
    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_typed_form_edit", segment: "technology" },
    ]);
  });

  it("does not let an older pending ASR item demote a later typed form edit", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_before_form_edit",
        email_capture_mode: "adaptive",
        transcript: "Actually, use old@example.com.",
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "new@example.com" },
        emailVerification: { value: "new@example.com", source: "typed", status: "confirmed" },
        emailVerificationUserTurnSequence: 0,
        emailVerificationIgnoredTranscriptIds: ["audio_before_form_edit"],
        pendingUserTranscripts: 1,
        pendingUserTranscriptIds: ["audio_before_form_edit"],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({
      value: "new@example.com",
      source: "typed",
      status: "confirmed",
    });
    expect(result.state.emailVerificationUserTurnSequence).toBe(1);
    expect(result.state.emailVerificationIgnoredTranscriptIds).toEqual([]);
  });

  it("rejects tool output from an active response invalidated by a later typed edit", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_stale_response_capture",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_stale_response_route",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        activeResponse: true,
        activeResponseStaleForEmail: true,
        activeResponseTranscriptBinding: { pending: false, itemId: "audio_old" },
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "new@example.org" },
        emailVerification: { value: "new@example.org", source: "typed", status: "confirmed" },
        transcript: [{ role: "user", text: "My old email was old@example.com." }],
      }),
    );

    expect(result.state.captured.email).toBe("new@example.org");
    expect(result.state.emailVerification).toMatchObject({
      value: "new@example.org",
      source: "typed",
      status: "confirmed",
    });
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_stale_response_capture",
        createResponse: false,
        output: { ok: false, error: "stale_response", key: "email" },
      },
      {
        type: "function_result",
        callId: "call_stale_response_route",
        createResponse: false,
        output: { ok: false, error: "stale_response" },
      },
    ]);
  });

  it.each([
    "typed",
    "prefill",
  ] as const)("taints a response after it conflicts with an authoritative %s email", (source) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: `call_${source}_authority_conflict`,
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.org",
                evidence: "new at example dot org",
              }),
            },
            {
              type: "function_call",
              name: "route_to_team",
              call_id: `call_route_after_${source}_authority_conflict`,
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        activeResponse: true,
        activeResponseTranscriptBinding: { pending: true, itemId: "audio_new" },
        pendingUserTranscripts: 1,
        pendingUserTranscriptIds: ["audio_new"],
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source, status: "confirmed" },
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: `call_${source}_authority_conflict`,
        createResponse: false,
        output: { ok: false, error: "stale_response", key: "email" },
      },
      {
        type: "function_result",
        callId: `call_route_after_${source}_authority_conflict`,
        createResponse: false,
        output: { ok: false, error: "stale_response" },
      },
    ]);
  });

  it.each([
    "Actually, the website is at example dot com.",
    "Actually, our site is at example dot com.",
    "Actually, our domain is example dot com.",
    "The website lists support@example.org as an example.",
    "No, not new@example.com.",
    "old@example.com instead of new@example.com.",
  ])("does not mistake explicit web context for a replacement email: %s", (webUpdate) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_website_turn",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: {
          value: "old@example.com",
          source: "speech",
          status: "confirmed",
          confidence: "high",
        },
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: webUpdate },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "old@example.com", status: "confirmed" });
    expect(result.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_website_turn", segment: "technology" },
    ]);
  });

  it("rejects a stale email when the latest correction repeats it before the replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_stale_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, old@example.com was wrong; use new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("accepts the replacement address when the visitor says what they meant", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_corrected_email",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.com",
                evidence: "new@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, I meant new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("new@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
    expect(result.commands[0]).toMatchObject({ output: { ok: true, emailConfirmationRequired: false } });
  });

  it("does not reuse an older address after a fragment-only correction", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_fragment_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Sorry, I meant the local part should be new." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps prior email grounding across unrelated correction-like microphone text", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_unrelated_should_be",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "The meeting should be at three." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("does not confuse an address with a suffix of the corrected address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_suffix_collision",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: "Actually, I meant qa@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not confuse a spoken address with a suffix of the corrected local part", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email_suffix_collision",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a at example dot com." },
          { role: "user", text: "Actually, I meant q a at example dot com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "qa@example.com.",
    "q a at example dot com.",
  ])("does not revive a suffix address from a different latest address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_suffix_without_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a@example.com.",
    "a at example dot com.",
  ])("does not expand a different latest address into a prefixed stale address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_prefix_without_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "qa@example.com",
                evidence: "qa@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is qa@example.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "The right email is a@y.com.",
    "The right email is a at y dot com.",
  ])("lets a newer different address supersede the older exact address: %s", (latestAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_new_address",
              arguments: JSON.stringify({
                key: "email",
                value: "a@x.com",
                evidence: "a@x.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@x.com." },
          { role: "user", text: latestAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "ca",
    "au",
    "agency",
    "museum",
  ])("recognises an arbitrary valid spoken domain suffix when superseding: .%s", (suffix) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_spoken_tld",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: `a at example dot ${suffix}.` },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a at example dot c a.",
    "a at example dot a u.",
  ])("recognises a letter-spelled spoken suffix when superseding: %s", (spokenAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_spelled_tld",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: spokenAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "a at proton mail dot com.",
    "a at red panda dot com.",
    "a at my company dot com.",
    "a at the edge dot io.",
    "a at our team dot org.",
  ])("recognises a naturally spoken multiword domain when superseding: %s", (spokenAddress) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_older_email_after_multiword_domain",
              arguments: JSON.stringify({
                key: "email",
                value: "a@example.com",
                evidence: "a@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@example.com." },
          { role: "user", text: spokenAddress },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps prior email grounding across an unrelated at-point phrase", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_launch_point",
              arguments: JSON.stringify({
                key: "email",
                value: "a@x.com",
                evidence: "a@x.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is a@x.com." },
          { role: "user", text: "We are at the launch point now." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("a@x.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it.each([
    "Meet me at the red dot on the map.",
    "Look at the blue dot near the entrance.",
  ])("keeps prior email grounding across ordinary dot-location language: %s", (backgroundTranscript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_dot_location",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: backgroundTranscript },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("treats a different address after forget as a replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_forget",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Forget old@example.com; use new@example.com." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not accept an address explicitly rejected after the replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_explicitly_rejected_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Use new@example.com, not old@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("does not accept the trailing address rejected by instead of", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_instead_of",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Use new@example.com instead of old@example.com." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Use new@example.com instead of old@example.com.",
    "Use new at example dot com instead of old at example dot com.",
  ])("accepts the selected address before instead of: %s", (transcript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_selected_email_before_instead_of",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.com",
                evidence: "new@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: transcript }] }),
    );

    expect(result.state.captured.email).toBe("new@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
    expect(result.commands[0]).toMatchObject({ output: { ok: true } });
  });

  it.each([
    "Use new@example.com rather than old@example.com.",
    "Use new at example dot com rather than old at example dot com.",
  ])("does not accept the trailing address rejected by rather than: %s", (transcript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_rather_than",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: transcript }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("recognises a contracted rejection after an address", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_isnt_correct",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "old@example.com isn't correct." }] }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a spoken address when its repeated mention retracts it", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_spoken_retraction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          {
            role: "user",
            text: "old at example dot com — no, not old at example dot com.",
          },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Actually, old@example.com, yes, old@example.com.",
    "Actually, old at example dot com, yes, old at example dot com.",
  ])("accepts a repeated address that the visitor affirms: %s", (transcript) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_repeated_email_affirmation",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: transcript }] }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("orders fully spoken replacement addresses correctly", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_spoken_email_replacement_order",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old at example dot com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          {
            role: "user",
            text: "Actually, old at example dot com should be new at example dot com.",
          },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it.each([
    "Sorry, I meant new.",
    "No, I said new.",
  ])("does not reuse an older address after the fragment correction %s", (correction) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_after_short_fragment",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: correction },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps email grounding across an explicitly meeting-related I meant turn", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_email_before_meeting_correction",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Sorry, I meant Tuesday for the meeting." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("old@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("accepts either explicitly offered address without extra confirmation", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_alternative_email",
              arguments: JSON.stringify({
                key: "email",
                value: "first@example.com",
                evidence: "first@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Either first@example.com or second@example.com works." }] }),
    );

    expect(result.state.captured.email).toBe("first@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("accepts a plain or choice when either offered address works", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_plain_alternative_email",
              arguments: JSON.stringify({
                key: "email",
                value: "first@example.com",
                evidence: "first@example.com",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Actually, first@example.com or second@example.com works." }] }),
    );

    expect(result.state.captured.email).toBe("first@example.com");
    expect(result.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("accepts an organisation when ASR spelling drifts from what the model heard", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_asr_drift",
              arguments: JSON.stringify({
                key: "org",
                value: "Khazanah Nasional",
                evidence: "Khazanah Nasional",
              }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "I'm calling from Cazana Nasional about the demo lab." }] }),
    );

    expect(result.state.captured.org).toBe("Khazanah Nasional");
  });

  it("still rejects an organisation with no resemblance to anything the user said", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_invented",
              arguments: JSON.stringify({ key: "org", value: "Petronas", evidence: "sure can" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "sure can, let's do that" }] }),
    );

    expect(result.state.captured.org).toBe("");
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_org_invented",
        createResponse: true,
        output: { ok: false, error: "ungrounded_identity_capture", key: "org", value: "Petronas" },
      },
    ]);
  });

  it("accepts a name when the transcript spells it differently but recognisably", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_asr_drift",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet Singh", evidence: "Gurpreet Singh" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Gurprit Sing." }] }),
    );

    expect(result.state.captured.name).toBe("Gurpreet Singh");
  });

  it("accepts a phonetically rough name draft only behind an explicit name cue", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_rough_asr",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet", evidence: "Gurpreet" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Goodbreed." }] }),
    );

    expect(result.state.captured.name).toBe("Gurpreet");
  });

  it("rejects an unrelated same-initial name despite an explicit name cue", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_name_unrelated_asr",
              arguments: JSON.stringify({ key: "name", value: "Gurpreet", evidence: "Gurpreet" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "My name is Gareth." }] }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "name" },
    });
  });

  it("appends brief updates when the model marks the message capture as additive", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_append_message",
              arguments: JSON.stringify({
                key: "message",
                value: "I can also rent the space and teach workshops.",
                mode: "append",
              }),
            },
          ],
        },
      },
      state({
        captured: {
          ...emptyCapturedLead,
          message: "I am a trainer and want the team to look me up.",
        },
      }),
    );

    expect(result.state.captured.message).toBe(
      "I am a trainer and want the team to look me up.\n\nI can also rent the space and teach workshops.",
    );
  });

  it("normalizes common spoken Mereka variants for organisation capture", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_moreika",
              arguments: JSON.stringify({ key: "org", value: "Moreika", evidence: "Moreika" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "Moreika." }] }),
    );

    expect(result.state.captured.org).toBe("Mereka");
  });

  it("captures organisation when the user asks Reka to write a recently mentioned value", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_write_it",
              arguments: JSON.stringify({ key: "org", value: "Mereka", evidence: "You write it in" }),
            },
          ],
        },
      },
      state({
        transcript: [
          { role: "user", text: "Moreika." },
          { role: "assistant", text: "Please say the organisation name." },
          { role: "user", text: "You write it in." },
        ],
      }),
    );

    expect(result.state.captured.org).toBe("Mereka");
  });

  it("clears fields when the user rejects a wrong capture", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_field",
              call_id: "call_clear_name",
              arguments: JSON.stringify({ key: "name" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, name: "Alex Tan" } }),
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      callId: "call_clear_name",
      output: { ok: true, key: "name" },
    });
  });

  it("clears every field and email verification in one deterministic call", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_all",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      state({
        captured: {
          name: "Asha",
          email: "asha@example.com",
          org: "Future Lab",
          phone: "123",
          website: "example.com",
          message: "AI workshops",
        },
        emailVerification: { value: "asha@example.com", source: "typed", status: "confirmed" },
        routeRequested: true,
      }),
    );

    expect(result.state.captured).toEqual(emptyCapturedLead);
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.state.routeRequested).toBe(false);
    expect(result.commands[0]).toMatchObject({
      output: {
        ok: true,
        cleared: true,
        clearedFields: ["name", "email", "org", "phone", "website", "message"],
      },
    });
  });

  it("ignores a transcription that was already pending when clear-all ran", () => {
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_pending",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "speech", status: "confirmed" },
        pendingUserTranscripts: 1,
        pendingUserTranscriptIds: ["old-item"],
      }),
    );

    const late = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "old-item",
        transcript: "My email is old@example.com.",
      },
      cleared.state,
    );

    expect(late.state.captured.email).toBe("");
    expect(late.state.emailVerification).toBeUndefined();
    expect(late.state.transcript).toEqual([]);
    expect(late.state.ignoredUserTranscriptIds).toEqual(["old-item"]);
  });

  it("keeps clear-all safe when new and old transcriptions complete out of order", () => {
    const oldCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "old-item" },
      state({ captured: { ...emptyCapturedLead, email: "old@example.com" } }),
    );
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_out_of_order",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      oldCommitted.state,
    );
    const newCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "new-item" },
      cleared.state,
    );
    const newCompleted = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "new-item",
        transcript: "My email is new@example.com.",
      },
      newCommitted.state,
    );
    const oldCompleted = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "old-item",
        transcript: "My email is old@example.com.",
      },
      newCompleted.state,
    );

    expect(oldCompleted.state.captured.email).toBe("new@example.com");
    expect(oldCompleted.state.transcript).toEqual([{ role: "user", text: "My email is new@example.com." }]);
    expect(oldCompleted.state.pendingUserTranscriptIds).toEqual([]);
    expect(oldCompleted.state.ignoredUserTranscriptIds).toEqual(["old-item"]);
  });

  it("keeps duplicate, unknown, reused, and untagged events fenced after clear-all", () => {
    const oldCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "old-item" },
      state({ captured: { ...emptyCapturedLead, email: "old@example.com" } }),
    );
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_protocol_edges",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      oldCommitted.state,
    ).state;

    const oldOnce = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "old-item",
        transcript: "My email is old@example.com.",
      },
      cleared,
    ).state;
    const oldTwice = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "old-item",
        transcript: "My email is old@example.com.",
      },
      oldOnce,
    ).state;
    const unknown = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "unknown-item",
        transcript: "My email is unknown@example.com.",
      },
      oldTwice,
    ).state;
    const reusedCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "old-item" },
      unknown,
    ).state;
    const reusedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "old-item",
        transcript: "My email is reused@example.com.",
      },
      reusedCommit,
    ).state;
    const untaggedCommit = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, reusedCompletion).state;
    const untaggedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "My email is legacy@example.com.",
      },
      untaggedCommit,
    ).state;

    expect(untaggedCompletion.captured.email).toBe("");
    expect(untaggedCompletion.transcript).toEqual([]);
    expect(untaggedCompletion.pendingUserTranscripts).toBe(0);
    expect(untaggedCompletion.pendingUserTranscriptIds).toEqual([]);
    expect(untaggedCompletion.ignoredUserTranscriptIds).toEqual(["old-item"]);
  });

  it("deduplicates a newly committed tagged transcript after clear-all", () => {
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_duplicate_commit",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      state(),
    ).state;
    const firstCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "new-item" },
      cleared,
    ).state;
    const duplicateCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "new-item" },
      firstCommit,
    ).state;
    const completed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "new-item",
        transcript: "My email is new@example.com.",
      },
      duplicateCommit,
    ).state;

    expect(duplicateCommit.pendingUserTranscripts).toBe(1);
    expect(duplicateCommit.pendingUserTranscriptIds).toEqual(["new-item"]);
    expect(completed.captured.email).toBe("new@example.com");
    expect(completed.pendingUserTranscripts).toBe(0);
  });

  it("accepts evidence-consistent identity capture while a user transcription is still pending", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_lagging_transcript",
              arguments: JSON.stringify({
                key: "email",
                value: "asha@example.com",
                evidence: "asha at example dot com",
              }),
            },
          ],
        },
      },
      committed.state,
    );

    expect(result.state.captured.email).toBe("asha@example.com");
  });

  it("rejects a stale email during pending transcription when a completed correction is already known", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_stale_email",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        pendingUserTranscripts: 1,
        transcript: [
          { role: "user", text: "My email is old@example.com." },
          { role: "user", text: "Actually, use new@example.com instead." },
        ],
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a pending stale draft after a selected replacement even without an older matching transcript", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_stale_without_prior_match",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        pendingUserTranscripts: 1,
        transcript: [{ role: "user", text: "Use new@example.com." }],
      }),
    );

    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("rejects a pending stale draft after a completed bare replacement", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_stale_after_bare_replacement",
              arguments: JSON.stringify({
                key: "email",
                value: "old@example.com",
                evidence: "old@example.com",
              }),
            },
          ],
        },
      },
      state({
        emailCaptureMode: "adaptive",
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        pendingUserTranscripts: 1,
        transcript: [{ role: "user", text: "new@example.org" }],
      }),
    );

    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("keeps the pending-transcription relaxation when no completed turn contradicts the email", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_fresh_email",
              arguments: JSON.stringify({
                key: "email",
                value: "new@example.com",
                evidence: "new at example dot com",
              }),
            },
          ],
        },
      },
      state({ pendingUserTranscripts: 1 }),
    );

    expect(result.state.captured.email).toBe("new@example.com");
    expect(result.state.emailVerification).toMatchObject({
      status: "pending",
      source: "speech",
      confidence: "medium",
    });
    expect(result.commands[0]).toMatchObject({
      output: {
        ok: true,
        emailConfirmationRequired: false,
        emailCheckRequired: true,
        emailCaptureMode: "adaptive",
      },
    });
  });

  it("reconciles the same ASR-drifted email whether transcription completes before or after capture", () => {
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", email_capture_mode: "adaptive" },
      state(),
    );
    const captured = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_asr_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      committed.state,
    );

    expect(captured.state.emailGroundingAwaitingTranscript).toMatchObject({
      value: "asha.lim@example.my",
      userTurnCount: 0,
    });
    expect(captured.state.emailVerification).toMatchObject({ status: "pending", confidence: "medium" });

    const transcribed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        email_capture_mode: "adaptive",
        transcript: "My email is asia.lim@example.my.",
      },
      captured.state,
    );
    expect(transcribed.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(transcribed.state.emailVerification).toMatchObject({ status: "pending", confidence: "medium" });

    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_pending_asr_drift",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      transcribed.state,
    );
    expect(routed.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it("matches pending email grounding to its transcription item when another transcript completes first", () => {
    const firstCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_unrelated", email_capture_mode: "adaptive" },
      state(),
    );
    const emailCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_email", email_capture_mode: "adaptive" },
      firstCommitted.state,
    );
    const captured = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_multi_pending_asr_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      emailCommitted.state,
    );
    expect(captured.state.emailGroundingAwaitingTranscript).toMatchObject({ itemId: "audio_email" });

    const unrelated = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_unrelated",
        email_capture_mode: "adaptive",
        transcript: "The meeting should be at three.",
      },
      captured.state,
    );
    expect(unrelated.state.emailGroundingAwaitingTranscript).toMatchObject({ itemId: "audio_email" });
    expect(unrelated.state.emailVerification).toMatchObject({ status: "pending", confidence: "medium" });

    const transcribed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_email",
        email_capture_mode: "adaptive",
        transcript: "My email is asia.lim@example.my.",
      },
      unrelated.state,
    );
    expect(transcribed.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(transcribed.state.emailVerificationUserTurnSequence).toBe(2);
    expect(transcribed.state.emailVerification).toMatchObject({ status: "pending", confidence: "medium" });

    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_multi_pending_asr_drift",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      transcribed.state,
    );
    expect(routed.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it("binds capture to the response input when a later interruption is also pending", () => {
    const emailCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_email_first", email_capture_mode: "adaptive" },
      state(),
    );
    const responseCreated = reduceRealtimeServerEvent(
      { type: "response.created", email_capture_mode: "adaptive" },
      emailCommitted.state,
    );
    const interruptionCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_interruption", email_capture_mode: "adaptive" },
      responseCreated.state,
    );
    const captured = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_response_bound_asr_drift",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      interruptionCommitted.state,
    );
    expect(captured.state.emailGroundingAwaitingTranscript).toMatchObject({ itemId: "audio_email_first" });

    const emailTranscribed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_email_first",
        email_capture_mode: "adaptive",
        transcript: "My email is asia.lim@example.my.",
      },
      captured.state,
    );
    expect(emailTranscribed.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(emailTranscribed.state.emailVerification).toMatchObject({ status: "pending", confidence: "medium" });

    const interruptionTranscribed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_interruption",
        email_capture_mode: "adaptive",
        transcript: "Sorry, the meeting should be at three.",
      },
      emailTranscribed.state,
    );
    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_response_bound_asr_drift",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      interruptionTranscribed.state,
    );
    expect(routed.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "unconfirmed_required_fields", unconfirmedFields: ["email"] },
    });
  });

  it("never binds an older response to a correction committed after that response began", () => {
    const initial = state({
      emailCaptureMode: "adaptive",
      captured: { ...emptyCapturedLead, email: "asha.lim@example.my" },
      emailVerification: {
        value: "asha.lim@example.my",
        source: "speech",
        status: "confirmed",
        confidence: "high",
      },
      emailVerificationUserTurnSequence: 1,
      transcript: [{ role: "user", text: "My email is asha.lim@example.my." }],
    });
    const responseCreated = reduceRealtimeServerEvent(
      { type: "response.created", email_capture_mode: "adaptive" },
      initial,
    );
    const correctionCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "correction_interrupt", email_capture_mode: "adaptive" },
      responseCreated.state,
    );
    const oldResponseDone = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_old_response_recapture",
              arguments: JSON.stringify({
                key: "email",
                value: "asha.lim@example.my",
                evidence: "asha dot lim at example dot my",
              }),
            },
          ],
        },
      },
      correctionCommitted.state,
    );
    expect(oldResponseDone.state.emailGroundingAwaitingTranscript).toBeUndefined();

    const corrected = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "correction_interrupt",
        email_capture_mode: "adaptive",
        transcript: "Actually, my email is asia.lim@example.my.",
      },
      oldResponseDone.state,
    );
    expect(corrected.state.captured.email).toBe("asia.lim@example.my");
    expect(corrected.state.emailVerification).toMatchObject({
      value: "asia.lim@example.my",
      source: "speech",
      status: "confirmed",
      confidence: "high",
    });

    const routed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        email_capture_mode: "adaptive",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_late_correction",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      corrected.state,
    );
    expect(routed.state.routeRequested).toBe(true);
    expect(routed.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_late_correction", segment: "technology" },
    ]);
  });

  it("still rejects evidence-inconsistent capture while a transcription is pending", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_pending_mismatch",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan", evidence: "we want a demo lab" }),
            },
          ],
        },
      },
      committed.state,
    );

    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture" },
    });
  });

  it("clears the pending transcription window once the user transcript completes", () => {
    const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state());
    const transcribed = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "We want a demo lab." },
      committed.state,
    );
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_after_transcript",
              arguments: JSON.stringify({ key: "name", value: "Alex Tan", evidence: "Alex Tan" }),
            },
          ],
        },
      },
      transcribed.state,
    );

    expect(result.state.pendingUserTranscripts).toBe(0);
    expect(result.state.captured.name).toBe("");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture" },
    });
  });

  it("captures organisation as Individual when the user says they have no organisation", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_org_individual",
              arguments: JSON.stringify({ key: "org", value: "Individual", evidence: "no organisation, just me" }),
            },
          ],
        },
      },
      state({ transcript: [{ role: "user", text: "No organisation, just me." }] }),
    );

    expect(result.state.captured.org).toBe("Individual");
  });

  it("does not upgrade an already-captured email without fresh grounding evidence", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_confirm_existing",
              arguments: JSON.stringify({ key: "email", value: "asha@example.com" }),
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, email: "asha@example.com" } }),
    );

    expect(result.state.captured.email).toBe("asha@example.com");
    expect(result.commands[0]).toMatchObject({
      type: "function_result",
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("grounds identity captures in messages the visitor typed into the chat", () => {
    const typed = appendTypedUserMessage(state(), "My email is mei@example.com and I am from Future Lab.");
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_typed_email",
              arguments: JSON.stringify({
                key: "email",
                value: "mei@example.com",
                evidence: "mei@example.com",
              }),
            },
          ],
        },
      },
      typed,
    );

    expect(typed.transcript).toEqual([{ role: "user", text: "My email is mei@example.com and I am from Future Lab." }]);
    expect(result.state.captured.email).toBe("mei@example.com");
  });

  it("streams assistant captions from transcript deltas and clears them on completion", () => {
    const first = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Hi, I’m " },
      state(),
    );
    const second = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Reka." },
      first.state,
    );
    expect(second.state.assistantDraft).toBe("Hi, I’m Reka.");

    const done = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.done", transcript: "Hi, I’m Reka." },
      second.state,
    );
    expect(done.state.assistantDraft).toBe("");
    expect(done.state.transcript).toEqual([{ role: "assistant", text: "Hi, I’m Reka." }]);
  });

  it("drops captions of a cancelled response when it finishes", () => {
    const speaking = reduceRealtimeServerEvent(
      { type: "response.output_audio_transcript.delta", delta: "Let me tell you about the spa" },
      state(),
    );
    const cancelled = reduceRealtimeServerEvent({ type: "response.done" }, speaking.state);

    expect(cancelled.state.assistantDraft).toBe("");
    expect(cancelled.state.transcript).toEqual([]);
  });

  it("tracks whether an assistant response is in flight", () => {
    const started = reduceRealtimeServerEvent({ type: "response.created" }, state());
    expect(started.state.activeResponse).toBe(true);

    const finished = reduceRealtimeServerEvent({ type: "response.done" }, started.state);
    expect(finished.state.activeResponse).toBe(false);
  });

  it("records error codes and classifies benign realtime errors", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "error",
        error: { code: "response_cancel_not_active", message: "Cancellation failed: no active response found" },
      },
      state(),
    );

    expect(result.state.errors).toEqual([
      {
        eventId: undefined,
        code: "response_cancel_not_active",
        message: "Cancellation failed: no active response found",
      },
    ]);
    expect(isBenignVoiceError(result.state.errors?.[0] ?? { message: "" })).toBe(true);
    expect(isBenignVoiceError({ message: "Server error while processing audio" })).toBe(false);
  });

  it("retains only the fixed bounded shape from realtime rate-limit updates", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "rate_limits.updated",
        rate_limits: [
          { name: "requests", limit: 100, remaining: 90, reset_seconds: 5, private: "visitor@example.com" },
          { name: "bad", limit: -1, remaining: 2, reset_seconds: 5 },
          null,
        ],
      },
      state(),
    );

    expect(result.state.rateLimits).toEqual([{ name: "requests", limit: 100, remaining: 90, reset_seconds: 5 }]);
    expect(JSON.stringify(result.state.rateLimits)).not.toContain("visitor@example.com");
  });
});
