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
    "My email is old@example.com. Actually no, new@example.com.",
    "My email is old@example.com. No, new@example.com.",
    "My email is old@example.com. Actually no, it's new@example.com.",
    "My email is old@example.com. Actually no, make that new@example.com.",
    "My email is old@example.com. Actually no, new@example.com instead.",
    "My email is old@example.com. Actually no, new@example.com, um.",
    "My email is old@example.com. On second thought, make that new@example.com.",
    "My email is old@example.com. Actually no, my correct email is new@example.com.",
    "My email is old@example.com. Actually no, my preferred email is new@example.com.",
    "My email is old@example.com. Actually no, it's new@example.com. Actually, the event is tomorrow.",
    "My email is old@example.com. Actually no, my preferred email is new@example.com. Sorry, the event changed.",
  ])("treats a bare address after a correction marker as the replacement: %s", (correction) => {
    const result = appendTypedUserMessage(state({ emailCaptureMode: "adaptive" }), correction);

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toMatchObject({
      value: "new@example.com",
      status: "confirmed",
    });
  });

  it.each([
    "My email is old@example.com. Actually no, new@example.com. I mean final@example.com.",
    "My email is old@example.com. Actually no, new@example.com. Correction, final@example.com.",
  ])("uses the last decisive address in a correction chain: %s", (correction) => {
    const result = appendTypedUserMessage(state({ emailCaptureMode: "adaptive" }), correction);

    expect(result.captured.email).toBe("final@example.com");
    expect(result.emailVerification).toMatchObject({
      value: "final@example.com",
      status: "confirmed",
    });
  });

  it.each([
    "My email is new@example.com, forget that. old@example.com is Priya's email.",
    "My email is new@example.com, forget that. old@example.com belongs to my colleague.",
    "old@example.com is still my email. old@example.com is Priya's email.",
    "old@example.com is still my email. My email is new@example.com, forget that. Actually old@example.com is Priya's email.",
    "old@example.com is the support address.",
    "old@example.com is the billing email.",
    "old@example.com is the vendor email.",
    "old@example.com is the purchasing email.",
    "old@example.com is the sample email.",
    "old@example.com is the reference email.",
  ])("clears a current address disclaimed after a retracted replacement: %s", (correction) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(initial, correction);

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("");
    expect(afterBenignEvent.emailVerification).toBeUndefined();
  });

  it.each([
    "old@example.com is wrong. Actually no, old@example.com is correct.",
    "old@example.com is wrong. Actually, old@example.com is still my email. My email is new@example.com, forget that.",
  ])("lets a later explicit reaffirmation preserve the current address: %s", (correction) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(initial, correction);

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual(initial.emailVerification);
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("old@example.com");
    expect(afterBenignEvent.emailVerification).toEqual(initial.emailVerification);
  });

  it.each([
    "old@example.com is Priya's email. Actually no, it's mine.",
    "old@example.com is the support address. Actually no, that's still my email.",
    "old@example.com is mine. Actually no, it isn't the vendor email.",
    "old@example.com is the vendor email. Actually no, it isn't the vendor email.",
    "old@example.com is the vendor email. Actually no, that's not the vendor email.",
    "old@example.com is Priya's email. Actually no, it isn't Priya's email.",
    "old@example.com is Priya's email. Actually no, it does not belong to Priya.",
    "old@example.com is Priya's email. Actually no, it doesn't belong to Priya.",
  ])("lets a final anaphoric ownership correction preserve the current address: %s", (correction) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(initial, correction);

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual(initial.emailVerification);
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("old@example.com");
    expect(afterBenignEvent.emailVerification).toEqual(initial.emailVerification);
  });

  it.each([
    "old@example.com is mine. Actually no, it's the vendor email.",
    "old@example.com is mine. Actually no, it's the support.",
    "old@example.com is the vendor email. Actually no, it isn't the vendor email, it's the support email.",
    "old@example.com is mine. Actually no, it isn't the vendor email, it's Priya's email.",
  ])("clears a current address after a final anaphoric secondary-role correction: %s", (correction) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(initial, correction);

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("");
    expect(afterBenignEvent.emailVerification).toBeUndefined();
  });

  it.each([
    "old@example.com is mine. Actually, it's the website that needs updating.",
    "old@example.com is mine. Actually, it's the support package I need.",
    "old@example.com is mine. Actually, it's the purchasing workflow we need to fix.",
    "old@example.com is mine. Actually, that is the sample project.",
  ])("keeps email authority through an unrelated anaphoric topic pivot: %s", (correction) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(initial, correction);

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual(initial.emailVerification);
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("old@example.com");
    expect(afterBenignEvent.emailVerification).toEqual(initial.emailVerification);
  });

  it("lets a final direct ownership correction replace a third-party address", () => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const result = appendTypedUserMessage(
      initial,
      "Priya's email is new@example.com. Actually no, new@example.com is mine.",
    );

    expect(result.captured.email).toBe("new@example.com");
    expect(result.emailVerification).toMatchObject({
      value: "new@example.com",
      status: "confirmed",
    });
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("new@example.com");
    expect(afterBenignEvent.emailVerification).toMatchObject({
      value: "new@example.com",
      status: "confirmed",
    });
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
    const afterBenignEvent = reduceRealtimeServerEvent({ type: "rate_limits.updated", rate_limits: [] }, result).state;
    expect(afterBenignEvent.captured.email).toBe("old@example.com");
    expect(afterBenignEvent.emailVerification).toEqual({
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

  it.each([
    "Actually, old@example.com is not my email.",
    "My email isn’t old@example.com.",
    "My email isn't old@example.com.",
    "old@example.com is not the right email.",
    "old@example.com isn’t the one.",
    "old@example.com is not my email.",
    "No, old@example.com is not my email.",
    "old@example.com, that’s someone else’s.",
    "old@example.com, that’s outdated.",
    "old@example.com, it doesn’t belong to me.",
    "old@example.com, don’t use that one.",
    "old@example.com, forget that.",
    "old@example.com? no, wrong one.",
    "old@example.com used to be mine.",
    "old@example.com belongs to my colleague.",
    "old@example.com is the project manager’s email.",
    "old@example.com, that’s the support address.",
    "old@example.com, that belongs to my company.",
  ])("revokes every explicit direct, anaphoric, historical, or third-party reassignment: %s", (correction) => {
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
    "Actually, other@example.com is not my email.",
    "Actually, other@example.com isn’t my email.",
  ])("never selects a rejected different address and preserves unrelated authority: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "seed@example.net" },
        emailVerification: { value: "seed@example.net", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("seed@example.net");
    expect(result.emailVerification).toEqual({
      value: "seed@example.net",
      source: "typed",
      status: "confirmed",
    });
  });

  it.each([
    "Both first@example.com and second@example.com are mine.",
    "My emails are first@example.com and second@example.com.",
  ])("clears stale authority when the visitor supplies competing owned addresses: %s", (correction) => {
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
    "The project manager email is other@example.com.",
    "The client success manager email is other@example.com.",
  ])("ignores a multiword role-owned address: %s", (correction) => {
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
    "Finance email is finance@example.com.",
    "The finance team email is finance@example.com.",
    "Support team email is support@example.com.",
    "The support desk email is support@example.com.",
    "Supplier contact email is supplier@example.com.",
    "The vendor email is vendor@example.com.",
    "The customer success email is cs@example.com.",
    "The press email is press@example.com.",
    "The accounts receivable email is ar@example.com.",
    "The procurement email is procurement@example.com.",
    "The operations team email is ops@example.com.",
    "The events desk email is events@example.com.",
    "The partnerships team email is partners@example.com.",
    "The community department email is community@example.com.",
    "The venue contact email is venue@example.com.",
    "The general enquiries email is hello@example.com.",
  ])("ignores a department, desk, or vendor-owned address: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual({ value: "old@example.com", source: "typed", status: "confirmed" });
  });

  it.each([
    "My email is new@example.com; finance email is finance@example.com.",
    "My email is new@example.com; the finance team email is finance@example.com.",
    "My email is new@example.com; support team email is support@example.com.",
    "My email is new@example.com; the support desk email is support@example.com.",
    "My email is new@example.com; supplier contact email is supplier@example.com.",
    "My email is new@example.com; the vendor email is vendor@example.com.",
    "My email is new@example.com; the customer success email is cs@example.com.",
    "My email is new@example.com; the press email is press@example.com.",
    "My email is new@example.com; the accounts receivable email is ar@example.com.",
    "My email is new@example.com; the procurement email is procurement@example.com.",
    "My email is new@example.com; the operations team email is ops@example.com.",
    "My email is new@example.com; the events desk email is events@example.com.",
    "My email is new@example.com; the partnerships team email is partners@example.com.",
    "My email is new@example.com; the community department email is community@example.com.",
    "My email is new@example.com; the venue contact email is venue@example.com.",
    "My email is new@example.com; the general enquiries email is hello@example.com.",
  ])("selects the visitor address beside a department, desk, or vendor aside: %s", (correction) => {
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
    "I used to use old2@example.com.",
    "Previously, my email was old2@example.com.",
  ])("keeps an explicitly historical different address irrelevant: %s", (correction) => {
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
    "new@example.com belongs to me.",
    "This address is mine: new@example.com.",
    "new@example.com is the one.",
    "The email belonging to me is new@example.com.",
    "The one to use is new@example.com.",
    "It should be new@example.com.",
    "Use my team email new@example.com.",
    "Please use my team email new@example.com.",
    "Use my operations team email new@example.com.",
    "Use my department email new@example.com.",
    "Please use this contact email new@example.com.",
    "That is my department email new@example.com.",
  ])("accepts an unambiguous direct ownership assertion: %s", (correction) => {
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
    "old@example.com, that’s the email to use.",
    "old@example.com, that’s the email I want.",
    "old@example.com, that’s the email, yes.",
    "old@example.com, that’s the contact email.",
  ])("preserves an address followed by an affirmative anaphoric description: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("old@example.com");
    expect(result.emailVerification).toEqual({ value: "old@example.com", source: "typed", status: "confirmed" });
  });

  it.each([
    "Change the email from old@example.com to new@example.com.",
    "Update my email from old@example.com to new@example.com.",
    "new@example.com should replace old@example.com.",
    "new@example.com replaces old@example.com.",
    "Swap old@example.com for new@example.com.",
    "old@example.com should become new@example.com.",
    "Move from old@example.com to new@example.com.",
    "Make it new@example.com instead of old@example.com.",
  ])("accepts a unique replacement target across natural command syntax: %s", (correction) => {
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
    "My email is new@example.com; other@example.com is the project manager’s email.",
    "My email is new@example.com; the project manager email is other@example.com.",
  ])("selects the visitor address beside a multiword role-owned address: %s", (correction) => {
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
    "Use first@example.com or second@example.com; choose second@example.com.",
    "Either first@example.com or second@example.com works; choose second@example.com.",
    "Either first@example.com or second@example.com works; actually use second@example.com.",
  ])("accepts one explicit final choice after alternatives: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "old@example.com" },
        emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("second@example.com");
    expect(result.emailVerification).toEqual({
      value: "second@example.com",
      source: "typed",
      status: "confirmed",
    });
  });

  it.each([
    "My email is other@example.com, but that’s my colleague’s email.",
    "My email is other@example.com, but it is my old email.",
    "My email is other@example.com; that’s just an example.",
    "My email is other@example.com; that’s the website address.",
    "My email is other@example.com, but that’s the support address.",
    "My email is other@example.com; that belongs to finance.",
  ])("fails closed when a visitor declaration is reclassified later in the same turn: %s", (correction) => {
    const result = appendTypedUserMessage(
      state({
        captured: { ...emptyCapturedLead, email: "seed@example.net" },
        emailVerification: { value: "seed@example.net", source: "typed", status: "confirmed" },
      }),
      correction,
    );

    expect(result.captured.email).toBe("");
    expect(result.emailVerification).toBeUndefined();
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
      { type: "input_audio_buffer.committed", item_id: "audio_exact_confirmation" },
      confirmedState,
    ).state;
    confirmedState = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_exact_confirmation",
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
    expect(route.state.routeRequested).toBeFalsy();
    expect(route.commands).toEqual([
      {
        type: "function_result",
        callId: "call_route_confirmed",
        createResponse: false,
        output: { ok: false, error: "stale_local_edit", segment: "technology" },
      },
    ]);
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
    const confirmationCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_confirm_embedded_readback" },
      withReadback,
    ).state;
    const withConfirmation = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_confirm_embedded_readback",
        transcript: "Yes, correct.",
      },
      confirmationCommitted,
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
    "I heard alpha at example dot com. Your email is beta at example dot com, is that correct?",
    "Your email is beta at example dot com. I may also have heard alpha at example dot com, is that correct?",
    "I heard alpha@example.com. Your email is beta@example.com, is that correct?",
    "I also heard alpha at example dot com at first. Your email is beta at example dot com, correct?",
    "Do not use alpha at example dot com at all. Your email is beta at example dot com, correct?",
    "Your email is beta at example dot com, correct? I also heard alpha at example dot com at first.",
    "I also heard alpha at e x a m p l e dot com at first. Your email is beta at example dot com, correct?",
    "I also heard a l p h a at e x a m p l e dot c o m at first. Your email is beta at example dot com, correct?",
    "alpha at example dot com at first. Beta at example dot com, correct?",
    "Beta at example dot com, correct? alpha at example dot com at first.",
    "I also have alpha at example dot com. Your email is beta at example dot com, correct?",
    "I noted alpha at example dot com earlier. Your email is beta at example dot com, correct?",
    "There was alpha at example dot com before. Your email is beta at example dot com, correct?",
    "Previously alpha at example dot com appeared. Your email is beta at example dot com, correct?",
    "Your email is beta at example dot com, correct? I also have alpha at example dot com.",
    "Contact us at alpha at example dot com. Your email is beta at example dot com, correct?",
    "Reach us at alpha at example dot com. Your email is beta at example dot com, correct?",
    "Visit us at alpha at example dot com. Your email is beta at example dot com, correct?",
    "Read more at oriental dot mereka dot io and alpha at example dot com was also present. Your email is beta at example dot com, correct?",
    "I also have alpha at example dot com for the meeting. Your email is beta at example dot com, correct?",
    "I heard alpha at a b c d e f g h i j k l dot com. Your email is beta at example dot com, correct?",
    "I heard a l p h a at i n t e r n a t i o n a l dot c o m. Your email is beta at example dot com, correct?",
    "I heard alpha at example point com. Your email is beta at example dot com, correct?",
    "I also heard alpha at example.com. Your email is beta at example dot com, correct?",
    "I noted alpha@example dot com earlier. Your email is beta at example dot com, correct?",
    "I heard alpha @ example dot com. Your email is beta at example dot com, correct?",
    "I heard alpha at example . com. Your email is beta at example dot com, correct?",
    "Alpha at example dot one at first. Beta at example dot com, correct?",
    "I got alpha at example dot com. Your email is beta at example dot com, correct?",
    "I captured alpha at example dot com. Your email is beta at example dot com, correct?",
    "I wrote down alpha at example dot com. Your email is beta at example dot com, correct?",
    "Another one was alpha at example dot com. Your email is beta at example dot com, correct?",
    "The other one was alpha at example dot com. Your email is beta at example dot com, correct?",
    "Maybe it was alpha at example dot com. Your email is beta at example dot com, correct?",
    "I remember alpha at example dot com. Your email is beta at example dot com, correct?",
    "I found alpha at example dot com. Your email is beta at example dot com, correct?",
    "The transcript showed alpha at example dot com. Your email is beta at example dot com, correct?",
    "It sounded like alpha at example dot com. Your email is beta at example dot com, correct?",
    "Previously us at example dot com appeared. Your email is beta at example dot com, correct?",
    "There was me at example dot com. Your email is beta at example dot com, correct?",
    "I saw we at example dot com. Your email is beta at example dot com, correct?",
    "It appeared as you at example dot com. Your email is beta at example dot com, correct?",
    "The other was it at example dot com. Your email is beta at example dot com, correct?",
    "I recalled they at example dot com. Your email is beta at example dot com, correct?",
    "I detected them at example dot com. Your email is beta at example dot com, correct?",
    "The audio said will at example dot com. Your email is beta at example dot com, correct?",
    "I heard may at example dot com. Your email is beta at example dot com, correct?",
    "I heard can at example dot com. Your email is beta at example dot com, correct?",
    "The budget contact is alpha at example dot com. Your email is beta at example dot com, correct?",
    "The budget owner is alpha at example dot com. Your email is beta at example dot com, correct?",
    "The budget is handled by alpha at example dot com. Your email is beta at example dot com, correct?",
    "The price contact was alpha at example dot com. Your email is beta at example dot com, correct?",
    "The release owner was alpha at example dot com. Your email is beta at example dot com, correct?",
    "The score reporter is alpha at example dot com. Your email is beta at example dot com, correct?",
    "Workshop at example dot com. Beta at example dot com, correct?",
    "Call at example dot com. Beta at example dot com, correct?",
    "Event at example dot com. Beta at example dot com, correct?",
    "Website at example dot com. Beta at example dot com, correct?",
    "Office at example dot com. Beta at example dot com, correct?",
  ])("rejects confirmation when the assistant read-back contains a competing address: %s", (readback) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_contaminated_readback",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "beta@example.com" },
        emailVerification: { value: "beta@example.com", source: "speech", status: "pending" },
        transcript: [
          { role: "assistant", text: readback },
          { role: "user", text: "Yes, correct." },
        ],
      }),
    );

    expect(result.state.emailVerification?.status).toBe("pending");
    expect(result.commands[0]).toMatchObject({
      output: { ok: false, error: "email_readback_missing", key: "email" },
    });
  });

  it("allows repeated identical read-backs and unrelated assistant context", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_repeated_readback",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "beta@example.com" },
        emailVerification: { value: "beta@example.com", source: "speech", status: "pending" },
        transcript: [
          {
            role: "assistant",
            text: "I have beta at example dot com. The handoff will stay editable. Beta at example dot com, correct?",
          },
          { role: "user", text: "Yes, correct." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "beta@example.com", status: "confirmed" });
  });

  it.each([
    "Your email is beta at example dot com. We will meet at level dot two.",
    "Your email is beta at example dot com. Read more at oriental dot mereka dot io.",
    "Your email is beta at example dot com and we will meet at level dot two.",
    "Your email is beta at example dot com and read more at oriental dot mereka dot io.",
    "Read more at oriental dot mereka dot io. Your email is beta at example dot com, correct?",
    "You can find us at oriental dot mereka dot io. Beta at example dot com, correct?",
    "Your email is beta at example dot com and the budget is at five point two million.",
    "Your email is beta at example dot com and our rating is at four point eight.",
    "Your email is beta at example dot com and the workshop starts at nine dot thirty.",
    "Your email is beta at example dot com and the release is at version dot two.",
    "Your email is beta at example dot com and we are at unit dot four.",
    "Your email is beta at example dot com and see section at appendix dot one.",
    "Your email is beta at example dot com and learn more at oriental dot mereka dot io.",
    "Your email is beta at example dot com and follow us at mereka dot social.",
    "Your email is beta at example dot com and see us at oriental dot mereka dot io.",
    "Your email is beta at example dot com and our office is at oriental dot mereka dot io.",
    "Your email is beta at example dot com and meet us at room dot west.",
    "Your email is beta at example dot com and we are at unit dot alpha.",
    "At room dot west, your email is beta at example dot com, correct?",
    "I have a workshop at room dot west. Your email is beta at example dot com, correct?",
    "Your email is beta at example dot com and we have a call at zoom dot us.",
    "I have a session at hall dot alpha. Your email is beta at example dot com, correct?",
    "Your email is beta at example dot com and we have a booking at table dot blue.",
    "We will not meet at level two. Your email is beta at example dot com, correct?",
    "The workshop is not at level two. Your email is beta at example dot com, correct?",
    "No, the meeting is not Tuesday. Your email is beta at example dot com, correct?",
    "We cannot meet Monday. Your email is beta at example dot com, correct?",
    "The budget is uncertain. Your email is beta at example dot com, correct?",
    "Perhaps we meet Tuesday. Your email is beta at example dot com, correct?",
    "The venue is unclear. Your email is beta at example dot com, correct?",
    "The venue address is unclear. Your email is beta at example dot com, correct?",
    "I cannot verify the building address. Your email is beta at example dot com, correct?",
    "The website address is uncertain. Your email is beta at example dot com, correct?",
    "The support email is not confirmed. Your email is beta at example dot com, correct?",
    "The finance email is tentative. Your email is beta at example dot com, correct?",
    "I doubt the office address is current. Your email is beta at example dot com, correct?",
    "I doubt the workshop starts Monday. Your email is beta at example dot com, correct?",
    "I may be wrong about the room. Your email is beta at example dot com, correct?",
    "The score might be wrong. Your email is beta at example dot com, correct?",
    "The release date is tentative. Your email is beta at example dot com, correct?",
  ])("allows an exact read-back alongside non-email building or website context: %s", (readback) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_contextual_readback",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "beta@example.com" },
        emailVerification: { value: "beta@example.com", source: "speech", status: "pending" },
        transcript: [
          { role: "assistant", text: readback },
          { role: "user", text: "Yes, correct." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ value: "beta@example.com", status: "confirmed" });
  });

  it("cannot confirm and route a contaminated read-back in one response", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_contaminated_batch",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_contaminated_batch",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "beta@example.com" },
        emailVerification: { value: "beta@example.com", source: "speech", status: "pending" },
        transcript: [
          {
            role: "assistant",
            text: "I also heard alpha at example dot com at first. Your email is beta at example dot com, correct?",
          },
          { role: "user", text: "Yes, correct." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ status: "pending" });
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands).toEqual([
      expect.objectContaining({
        type: "function_result",
        callId: "call_confirm_contaminated_batch",
        output: { ok: false, error: "email_readback_missing", key: "email" },
      }),
      expect.objectContaining({
        type: "function_result",
        callId: "call_route_contaminated_batch",
        output: expect.objectContaining({ ok: false, error: "unconfirmed_required_fields" }),
      }),
    ]);
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  it.each([
    "It would be wrong to say your email is beta at example dot com.",
    "I cannot confirm your email is beta at example dot com.",
    "I am not saying your email is beta at example dot com.",
    "I doubt your email is beta at example dot com.",
    "It is incorrect that your email is beta at example dot com.",
    "Do not assume your email is beta at example dot com.",
    "Unless your email is beta at example dot com, we should not proceed.",
    "Your email is beta at example dot com, but that is wrong.",
    "Your email is beta at example dot com, not correct.",
    "I heard beta at example dot com, but do not use that because it is wrong.",
    "I heard beta at example dot com, or maybe not.",
    "Beta at example dot com at first, but not anymore.",
    "Your email is beta at example dot com and that address is incorrect.",
    "Your email is beta at example dot com. Actually that one is wrong.",
    "Your email is beta at example dot com, but it is wrong.",
    "Your email is beta at example dot com, but this is wrong.",
    "Your email is beta at example dot com, but I got that wrong.",
    "Your email is beta at example dot com, though that is wrong.",
    "Your email is beta at example dot com; however, that is wrong.",
    "Your email is beta at example dot com, which is wrong.",
    "Your email is beta at example dot com, but do not use it.",
    "Your email is beta at example dot com, scratch that.",
    "Your email is beta at example dot com, forget that.",
    "Your email is beta at example dot com, ignore that.",
    "Your email is beta at example dot com, no, that is wrong.",
    "Your email is beta at example dot com, sorry, that is wrong.",
    "Your email is beta at example dot com; actually, wrong one.",
    "Your email is beta at example dot com, that is outdated.",
    "Your email is beta at example dot com, that was the old email.",
    "Your email is beta at example dot com, not that one.",
    "Your email is beta at example dot com, that does not belong to you.",
    "Your email is beta at example dot com, thats your old one.",
    "Your email is beta at example dot com, that used to be yours.",
    "Your email is beta at example dot com, correct? Do not use beta at example dot com.",
    "Your email is beta at example dot com, correct? Forget beta at example dot com.",
    "Your email is beta at example dot com, correct? Instead of beta at example dot com.",
    "Your email is beta at example dot com, correct? Not beta at example dot com.",
    "Your email is beta at example dot com, correct? I did not hear beta at example dot com.",
    "Your email is beta at example dot com, correct? You should not use beta at example dot com.",
    "Your email is beta at example dot com, correct? Never use beta at example dot com.",
    "Your email is beta at example dot com, correct? Avoid beta at example dot com.",
    "Your email is beta at example dot com, correct? Please do not send to beta at example dot com.",
    "Your email is beta at example dot com, you should not use that.",
    "Your email is beta at example dot com, please do not use that.",
    "Your email is beta at example dot com, avoid that.",
    "Your email is beta at example dot com, never use that.",
    "Your email is beta at example dot com, that is no longer valid.",
    "Your email is beta at example dot com, that one was a mistake.",
    "Your email is beta at example dot com, that is expired.",
    "Your email is beta at example dot com, that is not yours.",
    "Your email is beta at example dot com, maybe thats wrong.",
    "Your email is beta at example dot com, correct? You must not use beta at example dot com.",
    "Your email is beta at example dot com, correct? You cannot use beta at example dot com.",
    "Your email is beta at example dot com, correct? You can't use beta at example dot com.",
    "Your email is beta at example dot com, correct? No longer use beta at example dot com.",
    "Your email is beta at example dot com, correct? Exclude beta at example dot com.",
    "Your email is beta at example dot com, correct? Discard beta at example dot com.",
    "Your email is beta at example dot com, correct? Reject beta at example dot com.",
    "Your email is beta at example dot com, correct? Remove beta at example dot com.",
    "Your email is beta at example dot com, correct? Do not contact beta at example dot com.",
    "Your email is beta at example dot com, correct? Do not route to beta at example dot com.",
    "Your email is beta at example dot com, correct? Stop using beta at example dot com.",
    "Your email is beta at example dot com, correct? Not supposed to use beta at example dot com.",
    "Your email is beta at example dot com, you cannot use that.",
    "Your email is beta at example dot com, exclude that.",
    "Your email is beta at example dot com, stop using that.",
    "Your email is beta at example dot com, that is invalid.",
    "Your email is beta at example dot com, that is stale.",
    "Your email is beta at example dot com, that is obsolete.",
    "Your email is beta at example dot com, that is deprecated.",
    "Your email is beta at example dot com, that is unconfirmed.",
    "Your email is beta at example dot com, that is tentative.",
    "Your email is beta at example dot com, that one is not active.",
    "Your email is beta at example dot com, that one is old.",
    "It would be wrong to say, your email is beta at example dot com.",
    "I cannot confirm, your email is beta at example dot com.",
    "I am not saying, your email is beta at example dot com.",
    "I doubt, your email is beta at example dot com.",
    "Do not assume, your email is beta at example dot com.",
    "Maybe, your email is beta at example dot com.",
    "Possibly, your email is beta at example dot com.",
    "I am unsure, your email is beta at example dot com.",
    "I cannot verify, your email is beta at example dot com.",
    "I am not convinced, your email is beta at example dot com.",
    "I do not believe, your email is beta at example dot com.",
    "I can't be sure, your email is beta at example dot com.",
    "I cannot guarantee, your email is beta at example dot com.",
    "I question whether, your email is beta at example dot com.",
    "It is doubtful, your email is beta at example dot com.",
    "Unclear, your email is beta at example dot com.",
    "Uncertain, your email is beta at example dot com.",
    "Tentatively, your email is beta at example dot com.",
    "I may be wrong, your email is beta at example dot com.",
    "I could be mistaken, your email is beta at example dot com.",
    "I am not certain, your email is beta at example dot com.",
    "I am hesitant to say, your email is beta at example dot com.",
    "I cannot establish, your email is beta at example dot com.",
    "I am not convinced; Your email is beta at example dot com.",
    "I cannot guarantee. Your email is beta at example dot com.",
    "I can't be sure! Your email is beta at example dot com.",
    "I question whether; Your email is beta at example dot com.",
    "It is doubtful. Your email is beta at example dot com.",
    "Unclear! Your email is beta at example dot com.",
    "Uncertain; Your email is beta at example dot com.",
    "Tentatively. Your email is beta at example dot com.",
    "I may be wrong. Your email is beta at example dot com.",
    "I could be mistaken; Your email is beta at example dot com.",
    "I am not certain! Your email is beta at example dot com.",
    "Hard to say. Your email is beta at example dot com.",
    "I am guessing. Your email is beta at example dot com.",
    "This is my best guess. Your email is beta at example dot com.",
    "Low confidence. Your email is beta at example dot com.",
    "I have low confidence. Your email is beta at example dot com.",
    "Take this with a grain of salt. Your email is beta at example dot com.",
    "I am only guessing. Your email is beta at example dot com.",
    "Without confidence. Your email is beta at example dot com.",
    "I don't know. Your email is beta at example dot com.",
    "I have no idea. Your email is beta at example dot com.",
    "No idea. Your email is beta at example dot com.",
    "I can't tell. Your email is beta at example dot com.",
    "Who knows. Your email is beta at example dot com.",
    "This is speculative. Your email is beta at example dot com.",
    "Pure speculation. Your email is beta at example dot com.",
    "I am speculating. Your email is beta at example dot com.",
    "I have no confidence. Your email is beta at example dot com.",
    "Confidence is low. Your email is beta at example dot com.",
    "Your address is anybody's guess. Your email is beta at example dot com.",
  ])("does not treat a negated or uncertain statement as an exact read-back: %s", (readback) => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "confirm_email",
              call_id: "call_confirm_negated_readback",
              arguments: JSON.stringify({ evidence: "Yes, correct." }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "beta@example.com" },
        emailVerification: { value: "beta@example.com", source: "speech", status: "pending" },
        transcript: [
          { role: "assistant", text: readback },
          { role: "user", text: "Yes, correct." },
        ],
      }),
    );

    expect(result.state.emailVerification).toMatchObject({ status: "pending" });
    expect(result.commands[0]).toMatchObject({ output: { ok: false, error: "email_readback_missing" } });
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
    const confirmationCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: `audio_confirm_${localPart}` },
      withReadback,
    ).state;
    const withConfirmation = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: `audio_confirm_${localPart}`,
        transcript: "Yes, correct.",
      },
      confirmationCommitted,
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
    expect(result.commands).toEqual([]);
    expect(result.state.deferredMutationCalls?.map((call) => call.item.call_id)).toEqual([
      "call_late_authority_conflict",
    ]);
    expect(result.state.deferredRouteCall?.callId).toBe("call_route_before_authority_conflict");
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
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_usage" },
      state(),
    ).state;
    const result = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_usage",
        transcript: "My name is Asha.",
        usage: { total_tokens: 26, input_tokens: 17, output_tokens: 9 },
      },
      committed,
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
    expect(result.commands).toEqual([]);
    expect(result.state.deferredMutationCalls?.map((call) => call.item.call_id)).toEqual([
      `call_${source}_authority_conflict`,
    ]);
    expect(result.state.deferredRouteCall?.callId).toBe(`call_route_after_${source}_authority_conflict`);
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

  it("allows a current response to clear one email without self-tainting", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_field",
              call_id: "call_clear_current_email",
              arguments: JSON.stringify({ key: "email" }),
            },
          ],
        },
      },
      state({
        captured: { ...emptyCapturedLead, email: "person@example.com" },
        emailVerification: { value: "person@example.com", source: "typed", status: "confirmed" },
      }),
    );

    expect(result.state.captured.email).toBe("");
    expect(result.state.emailVerification).toBeUndefined();
    expect(result.commands[0]).toMatchObject({ output: { ok: true, key: "email" } });
  });

  it("does not let an older response clear a newer typed address", () => {
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, state()).state;
    const typed = appendTypedUserMessage(responding, "Use new@example.com.");
    const staleClear = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_stale_clear_all",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      typed,
    );

    expect(staleClear.state.captured.email).toBe("new@example.com");
    expect(staleClear.state.emailVerification).toMatchObject({ source: "typed", status: "confirmed" });
    expect(staleClear.commands).toEqual([
      {
        type: "function_result",
        callId: "call_stale_clear_all",
        createResponse: false,
        output: { ok: false, error: "stale_response", scope: "all" },
      },
    ]);
  });

  it("makes a valid clear-all terminal for its model response", () => {
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_terminal_clear",
              arguments: JSON.stringify({ scope: "all" }),
            },
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_restore_phone",
              arguments: JSON.stringify({ key: "phone", value: "+60 12 345 6789" }),
            },
            {
              type: "message",
              content: [{ type: "output_text", text: "I cleared old@example.com." }],
            },
          ],
        },
      },
      state({ captured: { ...emptyCapturedLead, phone: "+60 11 111 1111" } }),
    );

    expect(result.state.captured).toEqual(emptyCapturedLead);
    expect(result.state.transcript).toEqual([]);
    expect(result.commands).toEqual([
      {
        type: "function_result",
        callId: "call_terminal_clear",
        createResponse: false,
        output: expect.objectContaining({ ok: true, cleared: true }),
      },
      {
        type: "function_result",
        callId: "call_restore_phone",
        createResponse: true,
        output: { ok: false, error: "cleared_response_discarded" },
      },
    ]);
    expect(result.state.handledCallIds).toEqual(["call_terminal_clear", "call_restore_phone"]);

    const replay = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "capture_field",
              call_id: "call_restore_phone",
              arguments: JSON.stringify({ key: "phone", value: "+60 12 345 6789" }),
            },
          ],
        },
      },
      result.state,
    );
    expect(replay.state.captured).toEqual(emptyCapturedLead);
    expect(replay.commands).toEqual([]);
  });

  it("requires a fresh post-clear speech generation before admitting tagged audio", () => {
    const preClearSpeech = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "pre_clear_audio" },
      state({ emailCaptureMode: "adaptive" }),
    ).state;
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_audio_generation",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      preClearSpeech,
    ).state;
    const delayedCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "pre_clear_audio" },
      cleared,
    ).state;
    const delayedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "pre_clear_audio",
        transcript: "My email is old@example.com.",
        email_capture_mode: "adaptive",
      },
      delayedCommit,
    ).state;

    expect(delayedCompletion.captured.email).toBe("");
    expect(delayedCompletion.transcript).toEqual([]);
    expect(delayedCompletion.pendingUserTranscripts).toBe(0);
    expect(delayedCompletion.ignoredUserTranscriptIds).toContain("pre_clear_audio");

    const freshSpeech = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "post_clear_audio" },
      delayedCompletion,
    ).state;
    const freshCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "post_clear_audio" },
      freshSpeech,
    ).state;
    const freshCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "post_clear_audio",
        transcript: "My email is fresh@example.com.",
        email_capture_mode: "adaptive",
      },
      freshCommit,
    ).state;

    expect(freshCompletion.captured.email).toBe("fresh@example.com");
    expect(freshCompletion.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });
  });

  it("does not re-enrol a settled transcription ID after a later clear", () => {
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "settled_before_clear", email_capture_mode: "adaptive" },
      state(),
    ).state;
    const settled = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "settled_before_clear",
        transcript: "My email is old@example.com.",
        email_capture_mode: "adaptive",
      },
      committed,
    ).state;
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_after_settlement",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      appendTypedUserMessage(settled, "Clear everything."),
    ).state;
    const replayedSpeech = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "settled_before_clear" },
      cleared,
    ).state;
    const replayedCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "settled_before_clear" },
      replayedSpeech,
    ).state;
    const replayedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "settled_before_clear",
        transcript: "My email is replay@example.com.",
      },
      replayedCommit,
    ).state;

    expect(replayedCompletion.captured.email).toBe("");
    expect(replayedCompletion.transcript).toEqual([]);
    expect(replayedCompletion.pendingUserTranscripts).toBe(0);
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
      appendTypedUserMessage(
        state({
          captured: { ...emptyCapturedLead, email: "old@example.com" },
          emailVerification: { value: "old@example.com", source: "speech", status: "confirmed" },
          pendingUserTranscripts: 1,
          pendingUserTranscriptIds: ["old-item"],
        }),
        "Clear everything.",
      ),
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
      appendTypedUserMessage(oldCommitted.state, "Clear everything."),
    );
    const newSpeechStarted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "new-item" },
      cleared.state,
    );
    const newCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "new-item" },
      newSpeechStarted.state,
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
      appendTypedUserMessage(oldCommitted.state, "Clear everything."),
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
    const speechStarted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "new-item" },
      cleared,
    ).state;
    const firstCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "new-item" },
      speechStarted,
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

  it("waits for pending transcription before accepting evidence-consistent identity capture", () => {
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

    expect(result.state.captured.email).toBe("");
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "My email is asha at example dot com.",
      },
      result.state,
    );
    expect(settled.state.captured.email).toBe("asha@example.com");
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
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "No." },
      result.state,
    );
    expect(settled.commands[0]).toMatchObject({
      output: { ok: false, error: "stale_local_edit", key: "email" },
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
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "No." },
      result.state,
    );
    expect(settled.commands[0]).toMatchObject({
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
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "No." },
      result.state,
    );
    expect(settled.commands[0]).toMatchObject({
      output: { ok: false, error: "ungrounded_identity_capture", key: "email" },
    });
  });

  it("accepts a pending email only after its transcription supplies authority", () => {
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

    expect(result.state.captured.email).toBe("");
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "My email is new at example dot com.",
      },
      result.state,
    );
    expect(settled.state.captured.email).toBe("new@example.com");
    expect(settled.state.emailVerification).toMatchObject({ status: "confirmed", source: "speech" });
    expect(settled.commands[0]).toMatchObject({
      output: {
        ok: true,
        emailConfirmationRequired: false,
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

    expect(captured.state.captured.email).toBe("");
    expect(captured.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(captured.state.emailVerification).toBeUndefined();
    expect(captured.commands).toEqual([]);

    const transcribed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        email_capture_mode: "adaptive",
        transcript: "My email is asia.lim@example.my.",
      },
      captured.state,
    );
    expect(transcribed.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(transcribed.state.captured.email).toBe("asia.lim@example.my");
    expect(transcribed.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });

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
      appendTypedUserMessage(transcribed.state, "Please send it."),
    );
    expect(routed.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_pending_asr_drift", segment: "technology" },
    ]);
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
    expect(captured.state.captured.email).toBe("");
    expect(captured.state.deferredMutationCalls?.[0]?.itemId).toBe("audio_email");

    const unrelated = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_unrelated",
        email_capture_mode: "adaptive",
        transcript: "The meeting should be at three.",
      },
      captured.state,
    );
    expect(unrelated.state.captured.email).toBe("");
    expect(unrelated.state.deferredMutationCalls?.[0]?.itemId).toBe("audio_email");
    expect(unrelated.state.emailVerification).toBeUndefined();

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
    expect(transcribed.state.captured.email).toBe("asia.lim@example.my");
    expect(transcribed.state.emailVerificationUserTurnSequence).toBe(2);
    expect(transcribed.state.emailVerification).toMatchObject({ status: "confirmed", confidence: "high" });

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
      appendTypedUserMessage(transcribed.state, "Please send it."),
    );
    expect(routed.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_multi_pending_asr_drift", segment: "technology" },
    ]);
  });

  it("rejects capture from a response superseded by a later pending interruption", () => {
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
    expect(captured.state.captured.email).toBe("");
    expect(captured.state.emailGroundingAwaitingTranscript).toBeUndefined();
    expect(captured.commands[0]).toMatchObject({
      type: "function_result",
      createResponse: false,
      output: { ok: false, error: "stale_response", key: "email" },
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
      appendTypedUserMessage(corrected.state, "Please send it."),
    );
    expect(routed.state.routeRequested).toBe(true);
    expect(routed.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_late_correction", segment: "technology" },
    ]);
  });

  it("drains tagged ASR settlements in commit order and makes buffered or settled replays no-ops", () => {
    const oldCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_old", email_capture_mode: "adaptive" },
      state(),
    ).state;
    const newCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_new", email_capture_mode: "adaptive" },
      oldCommitted,
    ).state;
    const newSettledFirst = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_new",
        transcript: "Actually use new@example.com.",
        usage: { total_tokens: 7 },
        email_capture_mode: "adaptive",
      },
      newCommitted,
    ).state;
    const duplicateBuffered = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_new",
        transcript: "Actually use new@example.com.",
        usage: { total_tokens: 7 },
        email_capture_mode: "adaptive",
      },
      newSettledFirst,
    ).state;

    expect(newSettledFirst.transcript).toEqual([]);
    expect(newSettledFirst.pendingUserTranscriptIds).toEqual(["audio_old", "audio_new"]);
    expect(duplicateBuffered).toEqual(newSettledFirst);

    const drained = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_old",
        transcript: "My email is old@example.com.",
        usage: { total_tokens: 5 },
        email_capture_mode: "adaptive",
      },
      duplicateBuffered,
    ).state;

    expect(drained.transcript).toEqual([
      { role: "user", text: "My email is old@example.com." },
      { role: "user", text: "Actually use new@example.com." },
    ]);
    expect(drained.captured.email).toBe("new@example.com");
    expect(drained.emailVerification).toMatchObject({
      value: "new@example.com",
      status: "confirmed",
      confidence: "high",
    });
    expect(drained.pendingUserTranscripts).toBe(0);
    expect(drained.pendingUserTranscriptIds).toEqual([]);
    expect(drained.settledUserTranscriptIds).toEqual(["audio_old", "audio_new"]);
    expect(drained.usage).toMatchObject({ transcriptionCount: 2, transcriptionTokens: 12 });

    const replayedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_old",
        transcript: "My email is replay@example.com.",
        usage: { total_tokens: 99 },
      },
      drained,
    ).state;
    const replayedCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_old" },
      replayedCompletion,
    ).state;
    expect(replayedCompletion).toEqual(drained);
    expect(replayedCommit).toEqual(drained);
  });

  it("uses a failed older ASR item to unblock the next committed correction", () => {
    const oldCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_failed_old", email_capture_mode: "adaptive" },
      state(),
    ).state;
    const newCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_after_failure", email_capture_mode: "adaptive" },
      oldCommitted,
    ).state;
    const newBuffered = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_after_failure",
        transcript: "My email is recovered@example.com.",
        email_capture_mode: "adaptive",
      },
      newCommitted,
    ).state;
    const drained = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.failed", item_id: "audio_failed_old" },
      newBuffered,
    ).state;

    expect(drained.transcript).toEqual([{ role: "user", text: "My email is recovered@example.com." }]);
    expect(drained.captured.email).toBe("recovered@example.com");
    expect(drained.pendingUserTranscripts).toBe(0);
  });

  it("never routes an older address while a newer spoken turn is unresolved", () => {
    const initial = state({
      emailCaptureMode: "adaptive",
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: {
        value: "old@example.com",
        source: "speech",
        status: "confirmed",
        confidence: "high",
      },
    });
    const responseCreated = reduceRealtimeServerEvent({ type: "response.created" }, initial).state;
    const correctionCommitted = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_correction" },
      responseCreated,
    ).state;
    const staleRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_before_correction",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      correctionCommitted,
    );

    expect(staleRoute.state.routeRequested).toBeFalsy();
    expect(staleRoute.commands).toEqual([
      {
        type: "function_result",
        callId: "call_route_before_correction",
        createResponse: false,
        output: { ok: false, error: "stale_response" },
      },
    ]);

    const corrected = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_correction",
        transcript: "Actually use new@example.com.",
        email_capture_mode: "adaptive",
      },
      staleRoute.state,
    ).state;
    const freshRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_correction",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      appendTypedUserMessage(corrected, "Please send it."),
    );
    expect(corrected.captured.email).toBe("new@example.com");
    expect(freshRoute.commands).toEqual([
      { type: "submit_voice", callId: "call_route_after_correction", segment: "technology" },
    ]);

    const pendingBeforeResponse = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_bound_pending" },
      initial,
    ).state;
    const responseBoundToPending = reduceRealtimeServerEvent({ type: "response.created" }, pendingBeforeResponse).state;
    const pendingRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_bound_pending",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responseBoundToPending,
    );
    expect(pendingRoute.state.routeRequested).toBeFalsy();
    expect(pendingRoute.commands).toEqual([]);
    expect(pendingRoute.state.deferredRouteCall).toMatchObject({
      callId: "call_route_bound_pending",
      itemId: "audio_bound_pending",
    });
    const replayedPendingRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_bound_pending",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      pendingRoute.state,
    );
    expect(replayedPendingRoute.commands).toEqual([]);
    expect(replayedPendingRoute.state.deferredRouteCall).toEqual(pendingRoute.state.deferredRouteCall);

    const settledSend = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_bound_pending",
        transcript: "Send it.",
      },
      replayedPendingRoute.state,
    );
    expect(settledSend.state.deferredRouteCall).toBeUndefined();
    expect(settledSend.commands).toEqual([
      { type: "submit_voice", callId: "call_route_bound_pending", segment: "technology" },
    ]);
  });

  it("still rejects evidence-inconsistent capture when its pending transcription settles", () => {
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
    expect(result.commands).toEqual([]);
    const settled = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "We want a demo lab." },
      result.state,
    );
    expect(settled.commands[0]).toMatchObject({
      output: { ok: false, error: "stale_local_edit" },
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

  it.each(["failed", "empty"] as const)("never routes when its bound transcription is %s", (outcome) => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: `audio_route_${outcome}` },
      initial,
    ).state;
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, committed).state;
    const deferred = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: `call_route_${outcome}`,
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responding,
    );
    expect(deferred.commands).toEqual([]);

    const settled = reduceRealtimeServerEvent(
      outcome === "failed"
        ? { type: "conversation.item.input_audio_transcription.failed", item_id: `audio_route_${outcome}` }
        : {
            type: "conversation.item.input_audio_transcription.completed",
            item_id: `audio_route_${outcome}`,
            transcript: "   ",
          },
      deferred.state,
    );
    expect(settled.state.routeRequested).toBeFalsy();
    expect(settled.commands).toEqual([
      {
        type: "function_result",
        callId: `call_route_${outcome}`,
        createResponse: true,
        output: { ok: false, error: "transcription_unavailable", segment: "technology" },
        toolName: "route_to_team",
      },
    ]);
    expect(settled.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  it("does not create a competing response while a sibling route waits for tagged ASR", () => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
    });
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_summary_then_route" },
      initial,
    ).state;
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, committed).state;
    const deferred = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "summarise_lead",
              call_id: "call_summary_before_deferred_route",
              arguments: "{}",
            },
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_deferred_after_summary",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responding,
    );

    expect(deferred.state.deferredRouteCall).toMatchObject({ callId: "call_deferred_after_summary" });
    expect(deferred.commands).toHaveLength(1);
    expect(deferred.commands[0]).toMatchObject({
      type: "function_result",
      callId: "call_summary_before_deferred_route",
      createResponse: false,
    });
  });

  it("fails legacy untagged pending, failed, and empty ASR closed for routing", () => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const pending = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, initial).state;
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, pending).state;
    const pendingRoute = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_legacy_pending_route",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responding,
    );
    expect(pendingRoute.state.routeRequested).toBeFalsy();
    expect(pendingRoute.state.deferredRouteCall).toMatchObject({ callId: "call_legacy_pending_route" });
    expect(pendingRoute.commands).toEqual([]);
    const failedPendingRoute = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.failed" },
      pendingRoute.state,
    );
    expect(failedPendingRoute.state.deferredRouteCall).toBeUndefined();
    expect(failedPendingRoute.commands[0]).toMatchObject({
      type: "function_result",
      createResponse: true,
      output: { ok: false, error: "transcription_unavailable" },
    });

    for (const [index, settlement] of [
      { type: "conversation.item.input_audio_transcription.failed" },
      { type: "conversation.item.input_audio_transcription.completed", transcript: "   " },
    ].entries()) {
      const committed = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, initial).state;
      const settled = reduceRealtimeServerEvent(settlement, committed).state;
      const response = reduceRealtimeServerEvent({ type: "response.created" }, settled).state;
      const route = reduceRealtimeServerEvent(
        {
          type: "response.done",
          response: {
            output: [
              {
                type: "function_call",
                name: "route_to_team",
                call_id: `call_legacy_unavailable_${index}`,
                arguments: JSON.stringify({ segment: "technology" }),
              },
            ],
          },
        },
        response,
      );
      expect(route.state.routeRequested).toBeFalsy();
      expect(route.commands[0]).toMatchObject({ output: { ok: false, error: "transcription_unavailable" } });
    }
  });

  it("cancels an unresolved deferred route when clear-all establishes a new barrier", () => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_route_before_clear" },
      initial,
    ).state;
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, committed).state;
    const deferred = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_before_clear",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responding,
    ).state;
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_deferred_route",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      appendTypedUserMessage(deferred, "Clear everything."),
    );

    expect(cleared.state.deferredRouteCall).toBeUndefined();
    expect(cleared.commands).toEqual([
      expect.objectContaining({
        callId: "call_clear_deferred_route",
        output: expect.objectContaining({ cleared: true }),
      }),
      expect.objectContaining({
        callId: "call_route_before_clear",
        output: { ok: false, error: "stale_response" },
      }),
    ]);
    expect(cleared.state.handledCallIds).toContain("call_route_before_clear");
    const fresh = appendTypedUserMessage(cleared.state, "My email is fresh@example.com. Please send it.");
    const replayed = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_before_clear",
              arguments: JSON.stringify({ segment: "education" }),
            },
          ],
        },
      },
      fresh,
    );
    expect(replayed.commands).toEqual([]);
    expect(replayed.state.routeRequested).toBeFalsy();
  });

  it("keeps failed ASR fail-closed when it settles before the response is created", () => {
    const initial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
    });
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_failed_before_response" },
      initial,
    ).state;
    const failed = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.failed", item_id: "audio_failed_before_response" },
      committed,
    ).state;
    const responding = reduceRealtimeServerEvent({ type: "response.created" }, failed).state;
    const route = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "route_to_team",
              call_id: "call_route_after_failed_asr",
              arguments: JSON.stringify({ segment: "technology" }),
            },
          ],
        },
      },
      responding,
    );

    expect(route.state.routeRequested).toBeFalsy();
    expect(route.commands[0]).toMatchObject({ output: { ok: false, error: "transcription_unavailable" } });
  });

  it("does not let a replayed pre-clear speech generation cross the clear barrier", () => {
    const preClear = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "audio_seen_before_clear" },
      state({ emailCaptureMode: "adaptive" }),
    ).state;
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_seen_generation",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      preClear,
    ).state;
    const replayedStart = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "audio_seen_before_clear" },
      cleared,
    ).state;
    const replayedCommit = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_seen_before_clear" },
      replayedStart,
    ).state;
    const replayedCompletion = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_seen_before_clear",
        transcript: "My email is replay@example.com.",
        email_capture_mode: "adaptive",
      },
      replayedCommit,
    ).state;

    expect(replayedCompletion.captured.email).toBe("");
    expect(replayedCompletion.transcript).toEqual([]);
    expect(replayedCompletion.pendingUserTranscripts).toBe(0);
  });

  it("tombstones an unknown completion before any later commit can legitimise its replay", () => {
    const cleared = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_before_unknown",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      state({ emailCaptureMode: "adaptive" }),
    ).state;
    const unknown = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_unknown_old",
        transcript: "My email is unknown@example.com.",
      },
      cleared,
    ).state;
    const started = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "audio_unknown_old" },
      unknown,
    ).state;
    const committed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "audio_unknown_old" },
      started,
    ).state;
    const replayed = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "audio_unknown_old",
        transcript: "My email is unknown@example.com.",
        email_capture_mode: "adaptive",
      },
      committed,
    ).state;

    expect(unknown.settledUserTranscriptIds).toContain("audio_unknown_old");
    expect(replayed.captured.email).toBe("");
    expect(replayed.transcript).toEqual([]);
  });

  it("retires untagged ASR after one settlement so a replay cannot consume another generation", () => {
    const oldCommitted = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, state()).state;
    const oldCompleted = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "My email is old@example.com." },
      oldCommitted,
    ).state;
    const newCommitted = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed" }, oldCompleted).state;
    const newCompleted = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "Use new@example.com." },
      newCommitted,
    ).state;
    const replay = reduceRealtimeServerEvent(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "My email is old@example.com." },
      newCompleted,
    ).state;

    expect(newCommitted.userTranscriptTrackingExhausted).toBe(true);
    expect(newCompleted.captured.email).toBe("old@example.com");
    expect(replay).toEqual(newCompleted);
  });

  const directAuthorityPaths = ["typed", "tagged", "tagged_with_response"] as const;
  const mutableToolAuthorityCases = [
    {
      tool: "capture_field",
      negative: "Actually, not Alice.",
      positive: "Actually, my name is Alice.",
      arguments: { key: "name", value: "Alice", evidence: "Alice" },
    },
    {
      tool: "capture_fields",
      negative: "Actually, not Alice.",
      positive: "Actually, my name is Alice.",
      arguments: { fields: [{ key: "name", value: "Alice", evidence: "Alice" }] },
    },
    {
      tool: "clear_field",
      negative: "Do not clear my name.",
      positive: "Clear my name.",
      arguments: { key: "name" },
    },
    {
      tool: "clear_fields",
      negative: "Do not clear anything.",
      positive: "Clear everything.",
      arguments: { scope: "all" },
    },
    {
      tool: "set_partner_type",
      negative: "We are not a technology company.",
      positive: "We are a technology company.",
      arguments: { segment: "technology" },
    },
    {
      tool: "route_to_team",
      negative: "Do not send it.",
      positive: "Please send it.",
      arguments: { segment: "technology" },
    },
    {
      tool: "end_call",
      negative: "Do not end the call.",
      positive: "End the call.",
      arguments: { reason: "user_done" },
    },
  ] as const;

  function applyDirectAuthorityTurn(
    initial: VoiceRuntimeState,
    path: (typeof directAuthorityPaths)[number],
    transcript: string,
    itemId: string,
  ) {
    if (path === "typed") return appendTypedUserMessage(initial, transcript);
    let current = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed", item_id: itemId }, initial).state;
    if (path === "tagged_with_response") {
      current = reduceRealtimeServerEvent({ type: "response.created" }, current).state;
    }
    return reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: itemId,
        transcript,
      },
      current,
    ).state;
  }

  function readyMutableToolState(tool: (typeof mutableToolAuthorityCases)[number]["tool"]) {
    return state({
      segment: tool === "set_partner_type" ? "other" : "technology",
      captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
      transcript: [{ role: "user", text: "My name is Alice. Please send it." }],
    });
  }

  function runDirectMutableTool(
    authoritative: VoiceRuntimeState,
    tool: (typeof mutableToolAuthorityCases)[number]["tool"],
    args: object,
    callId: string,
  ) {
    return reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: tool,
              call_id: callId,
              arguments: JSON.stringify(args),
            },
          ],
        },
      },
      authoritative,
    );
  }

  it.each(
    directAuthorityPaths.flatMap((path) => mutableToolAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("gives a current $path refusal authority over direct $toolCase.tool", ({ path, toolCase }) => {
    const itemId = `authority_negative_${path}_${toolCase.tool}`;
    const initial = readyMutableToolState(toolCase.tool);
    const authoritative = applyDirectAuthorityTurn(initial, path, toolCase.negative, itemId);
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: toolCase.tool,
              call_id: `call_${itemId}`,
              arguments: JSON.stringify(toolCase.arguments),
            },
          ],
        },
      },
      authoritative,
    );

    expect(result.state.captured.name).toBe("Bob");
    expect(result.state.captured.email).toBe("ready@example.com");
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "function_result")).toBe(true);
  });

  it.each(
    directAuthorityPaths.flatMap((path) => mutableToolAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("honours a current $path affirmative command for direct $toolCase.tool", ({ path, toolCase }) => {
    const itemId = `authority_positive_${path}_${toolCase.tool}`;
    const initial = readyMutableToolState(toolCase.tool);
    const authoritative = applyDirectAuthorityTurn(initial, path, toolCase.positive, itemId);
    const result = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: toolCase.tool,
              call_id: `call_${itemId}`,
              arguments: JSON.stringify(toolCase.arguments),
            },
          ],
        },
      },
      authoritative,
    );

    if (toolCase.tool === "capture_field" || toolCase.tool === "capture_fields") {
      expect(result.state.captured.name).toBe("Alice");
    } else if (toolCase.tool === "clear_field") {
      expect(result.state.captured.name).toBe("");
      expect(result.state.captured.email).toBe("ready@example.com");
    } else if (toolCase.tool === "clear_fields") {
      expect(result.state.captured).toEqual(emptyCapturedLead);
    } else if (toolCase.tool === "set_partner_type") {
      expect(result.state.segment).toBe("technology");
    } else if (toolCase.tool === "route_to_team") {
      expect(result.commands).toContainEqual({
        type: "submit_voice",
        callId: `call_${itemId}`,
        segment: "technology",
      });
    } else {
      expect(result.commands).toContainEqual({ type: "end_voice", reason: "user_done" });
    }
  });

  const anaphoricAuthorityCases = [
    {
      id: "phone_capture",
      tool: "capture_field",
      prompt: "I heard your phone number as +60123456789. Is that right?",
      arguments: { key: "phone", value: "+60123456789", evidence: "+60123456789" },
    },
    {
      id: "website_batch_capture",
      tool: "capture_fields",
      prompt: "I heard your website as wrong.example. Is that right?",
      arguments: { fields: [{ key: "website", value: "wrong.example", evidence: "wrong.example" }] },
    },
    {
      id: "clear_name",
      tool: "clear_field",
      prompt: "Should I clear your name?",
      arguments: { key: "name" },
    },
    {
      id: "clear_all",
      tool: "clear_fields",
      prompt: "Should I clear everything in the form?",
      arguments: { scope: "all" },
    },
    {
      id: "segment",
      tool: "set_partner_type",
      prompt: "Are you a technology company?",
      arguments: { segment: "technology" },
    },
    {
      id: "route",
      tool: "route_to_team",
      prompt: "Ready for me to send it to the Mereka team?",
      arguments: { segment: "technology" },
    },
    {
      id: "end",
      tool: "end_call",
      prompt: "Should I end the call?",
      arguments: { reason: "user_done" },
    },
  ] as const;

  function conversationalAuthorityState(toolCase: {
    tool: (typeof mutableToolAuthorityCases)[number]["tool"];
    prompt: string;
  }) {
    return state({
      segment: toolCase.tool === "set_partner_type" ? "other" : "technology",
      captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
      transcript: [
        {
          role: "user",
          text: "My name is Alice. My phone is +60123456789 and my website is wrong.example. Please send it.",
        },
        { role: "assistant", text: toolCase.prompt },
      ],
    });
  }

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        ["No.", "Nope.", "Not yet.", "No, don't do it."].map((reply) => ({ path, toolCase, reply })),
      ),
    ),
  )("gives '$reply' authority over $path $toolCase.id confirmation", ({ path, toolCase, reply }) => {
    const itemId = `anaphoric_negative_${path}_${toolCase.id}_${reply.replace(/\W/gu, "_")}`;
    const initial = conversationalAuthorityState(toolCase);
    const authoritative = applyDirectAuthorityTurn(initial, path, reply, itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("resolves a contextual yes for $path $toolCase.id only from its assistant prompt", ({ path, toolCase }) => {
    const itemId = `anaphoric_positive_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState(toolCase);
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    if (toolCase.id === "phone_capture") {
      expect(result.state.captured.phone).toBe("+60123456789");
    } else if (toolCase.id === "website_batch_capture") {
      expect(result.state.captured.website).toBe("wrong.example");
    } else if (toolCase.id === "clear_name") {
      expect(result.state.captured.name).toBe("");
      expect(result.state.captured.email).toBe("ready@example.com");
    } else if (toolCase.id === "clear_all") {
      expect(result.state.captured).toEqual(emptyCapturedLead);
    } else if (toolCase.id === "segment") {
      expect(result.state.segment).toBe("technology");
    } else if (toolCase.id === "route") {
      expect(result.commands).toContainEqual({
        type: "submit_voice",
        callId: `call_${itemId}`,
        segment: "technology",
      });
    } else {
      expect(result.commands).toContainEqual({ type: "end_voice", reason: "user_done" });
    }
  });

  const thirdPartySubjectPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "Is Alice's phone number +60123456789?",
    website_batch_capture: "Is Alice's website wrong.example?",
    clear_name: "Should Alice clear your name?",
    clear_all: "Should Alice clear everything in the form?",
    segment: "Is Alice a technology company?",
    route: "Will Alice send it?",
    end: "Will Alice end the call?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("binds contextual yes to the actor and rejects third-party $path $toolCase.id", ({ path, toolCase }) => {
    const itemId = `third_party_subject_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt: thirdPartySubjectPrompts[toolCase.id] });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const indirectActorCases = [
    {
      tool: "clear_field" as const,
      prompt: "Do you want Alice to ask me to clear your name?",
      arguments: { key: "name" },
    },
    {
      tool: "route_to_team" as const,
      prompt: "Should I ask Alice to send it?",
      arguments: { segment: "technology" },
    },
    {
      tool: "route_to_team" as const,
      prompt: "Do you want Alice to ask me to send it?",
      arguments: { segment: "technology" },
    },
    {
      tool: "end_call" as const,
      prompt: "I will ask Alice to end the call. Is that right?",
      arguments: { reason: "user_done" },
    },
  ];

  it.each(
    directAuthorityPaths.flatMap((path) => indirectActorCases.map((actorCase) => ({ path, actorCase }))),
  )("does not bind an indirect $path $actorCase.tool actor to Reka", ({ path, actorCase }) => {
    const itemId = `indirect_actor_${path}_${actorCase.tool}_${actorCase.prompt.length}`;
    const initial = conversationalAuthorityState(actorCase);
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, actorCase.tool, actorCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const thirdPartyTargetPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "Your name is Bob and Alice's phone number is +60123456789. Is that right?",
    website_batch_capture: "Your name is Bob and Alice's website is wrong.example. Is that right?",
    clear_name: "Should I clear your phone and Alice's name?",
    clear_all: "Should I clear your phone and Alice's form?",
    segment: "Is your name Bob and Alice a technology company?",
    route: "Should I send Alice's form after the details?",
    end: "Should I end Alice's call after our session?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("binds contextual yes to the target and rejects third-party $path $toolCase.id", ({ path, toolCase }) => {
    const itemId = `third_party_target_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt: thirdPartyTargetPrompts[toolCase.id] });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  it.each(directAuthorityPaths)("binds a contextual $path clear to the field governed by the verb", (path) => {
    const itemId = `governed_clear_target_${path}`;
    const initial = conversationalAuthorityState({
      tool: "clear_field",
      prompt: "Should I clear your phone and keep your name?",
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, "clear_field", { key: "name" }, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  it.each(
    directAuthorityPaths.flatMap((path) =>
      ["Should I send this invoice?", "Should I send that document?", "Should I send the invoice?"].map((prompt) => ({
        path,
        prompt,
      })),
    ),
  )("rejects unrelated $path route object: $prompt", ({ path, prompt }) => {
    const itemId = `unrelated_route_target_${path}_${prompt.length}`;
    const initial = conversationalAuthorityState({ tool: "route_to_team", prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, "route_to_team", { segment: "technology" }, `call_${itemId}`);

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  it.each(directAuthorityPaths)("binds a contextual $path route to the requested segment", (path) => {
    const mismatchId = `route_segment_mismatch_${path}`;
    const mismatchInitial = conversationalAuthorityState({
      tool: "route_to_team",
      prompt: "Should I send it to the education team?",
    });
    const mismatchAuthority = applyDirectAuthorityTurn(mismatchInitial, path, "Yes.", mismatchId);
    const mismatch = runDirectMutableTool(
      mismatchAuthority,
      "route_to_team",
      { segment: "technology" },
      `call_${mismatchId}`,
    );
    expect(mismatch.state.routeRequested).toBeFalsy();
    expect(mismatch.commands.some((command) => command.type === "submit_voice")).toBe(false);

    const matchId = `route_segment_match_${path}`;
    const matchInitial = conversationalAuthorityState({
      tool: "route_to_team",
      prompt: "Should I send it to the technology team?",
    });
    const matchAuthority = applyDirectAuthorityTurn(matchInitial, path, "Yes.", matchId);
    const match = runDirectMutableTool(matchAuthority, "route_to_team", { segment: "technology" }, `call_${matchId}`);
    expect(match.commands).toContainEqual({
      type: "submit_voice",
      callId: `call_${matchId}`,
      segment: "technology",
    });

    const shareId = `route_share_destination_match_${path}`;
    const shareInitial = conversationalAuthorityState({
      tool: "route_to_team",
      prompt: "Should I share the form with the Mereka team?",
    });
    const shareAuthority = applyDirectAuthorityTurn(shareInitial, path, "Yes.", shareId);
    const share = runDirectMutableTool(shareAuthority, "route_to_team", { segment: "technology" }, `call_${shareId}`);
    expect(share.commands).toContainEqual({
      type: "submit_voice",
      callId: `call_${shareId}`,
      segment: "technology",
    });

    const viaId = `route_via_destination_match_${path}`;
    const viaInitial = conversationalAuthorityState({
      tool: "route_to_team",
      prompt: "Should I route the form via the Mereka team?",
    });
    const viaAuthority = applyDirectAuthorityTurn(viaInitial, path, "Yes.", viaId);
    const via = runDirectMutableTool(viaAuthority, "route_to_team", { segment: "technology" }, `call_${viaId}`);
    expect(via.commands).toContainEqual({
      type: "submit_voice",
      callId: `call_${viaId}`,
      segment: "technology",
    });

    const unspokenMismatchId = `route_unspoken_segment_mismatch_${path}`;
    const unspokenMismatchInitial = state({
      segment: "other",
      captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
      transcript: [
        { role: "user", text: "My name is Bob." },
        { role: "assistant", text: "Should I send it to the Mereka team?" },
      ],
    });
    const unspokenMismatchAuthority = applyDirectAuthorityTurn(
      unspokenMismatchInitial,
      path,
      "Yes.",
      unspokenMismatchId,
    );
    const unspokenMismatch = runDirectMutableTool(
      unspokenMismatchAuthority,
      "route_to_team",
      { segment: "technology" },
      `call_${unspokenMismatchId}`,
    );
    expect(unspokenMismatch.state.routeRequested).toBeFalsy();
    expect(unspokenMismatch.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  it.each(
    directAuthorityPaths.flatMap((path) =>
      [
        "and your organisation Acme",
        "along with your organisation Acme",
        "plus your organisation Acme",
        "with your organisation Acme",
        "and organisation as Acme",
        "and company as Acme",
        "plus organisation Acme",
        "and the organisation Acme",
        "and business as Acme",
        "plus telephone as Acme",
      ].map((fieldTail) => ({ path, fieldTail })),
    ),
  )("binds a contextual $path capture value before '$fieldTail' to its exact field", ({ path, fieldTail }) => {
    const itemId = `capture_cross_field_value_${path}_${fieldTail.replace(/\s/gu, "_")}`;
    const initial = state({
      captured: { ...emptyCapturedLead, name: "Bob", org: "Acme" },
      transcript: [
        { role: "user", text: "My name is Alice and my organisation is Acme." },
        { role: "assistant", text: `I have your name as Alice, ${fieldTail}. Is that right?` },
      ],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(
      authoritative,
      "capture_field",
      { key: "name", value: "Acme", evidence: "Acme" },
      `call_${itemId}`,
    );

    expect(result.state.captured.name).toBe("Bob");
    expect(result.state.captured.org).toBe("Acme");
  });

  it.each(
    directAuthorityPaths.flatMap((path) =>
      [
        {
          key: "email" as const,
          value: "name@example.com",
          user: "My email is name at example dot com.",
          prompt: "I heard your email as name@example.com. Is that right?",
        },
        {
          key: "org" as const,
          value: "Company Name Studio",
          user: "My organisation is Company Name Studio.",
          prompt: "I heard your organisation as Company Name Studio. Is that right?",
        },
        {
          key: "message" as const,
          value: "our website needs work",
          user: "My message is that our website needs work.",
          prompt: "I heard your message as our website needs work. Is that right?",
        },
        {
          key: "name" as const,
          value: "José",
          user: "My name is José.",
          prompt: "I heard your name as José. Is that right?",
        },
        {
          key: "name" as const,
          value: "Alice",
          user: "My name is Alice.",
          prompt: "Alice, is that your full name?",
        },
      ].map((capture) => ({ path, capture })),
    ),
  )("keeps field-like words inside a confirmed $path $capture.key value", ({ path, capture }) => {
    const itemId = `field_word_inside_value_${path}_${capture.key}`;
    const initial = state({
      transcript: [
        { role: "user", text: capture.user },
        { role: "assistant", text: capture.prompt },
      ],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(
      authoritative,
      "capture_field",
      { key: capture.key, value: capture.value, evidence: capture.value },
      `call_${itemId}`,
    );

    expect(result.state.captured[capture.key]).toBe(capture.value);
  });

  it.each(directAuthorityPaths)("rejects an unknown telephone alias from a $path name capture", (path) => {
    const itemId = `unknown_telephone_alias_${path}`;
    const initial = state({
      captured: { ...emptyCapturedLead, name: "Bob" },
      transcript: [
        { role: "user", text: "My name is Alice and my telephone is 60123456789." },
        { role: "assistant", text: "I have your name as Alice and telephone as 60123456789. Is that right?" },
      ],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(
      authoritative,
      "capture_field",
      { key: "name", value: "60123456789", evidence: "60123456789" },
      `call_${itemId}`,
    );

    expect(result.state.captured.name).toBe("Bob");
  });

  it.each(directAuthorityPaths)("does not let a reverse $path question steal another field's value", (path) => {
    const itemId = `reverse_cross_field_value_${path}`;
    const initial = state({
      captured: { ...emptyCapturedLead, name: "Bob", org: "Acme" },
      transcript: [
        { role: "user", text: "My organisation is Acme." },
        { role: "assistant", text: "Your organisation is Acme — your name?" },
      ],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(
      authoritative,
      "capture_field",
      { key: "name", value: "Acme", evidence: "Acme" },
      `call_${itemId}`,
    );

    expect(result.state.captured.name).toBe("Bob");
    expect(result.state.captured.org).toBe("Acme");
  });

  it.each(
    directAuthorityPaths.flatMap((path) =>
      [
        "Is Alice a technology company alongside your company in design?",
        "Is Alice in technology together with your company in design?",
      ].map((prompt) => ({ path, prompt })),
    ),
  )("binds a contextual $path segment to the visitor in: $prompt", ({ path, prompt }) => {
    const itemId = `segment_owner_clause_${path}_${prompt.length}`;
    const initial = state({
      segment: "other",
      transcript: [
        { role: "user", text: "Alice runs a technology company. We are an education company." },
        { role: "assistant", text: prompt },
      ],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, "set_partner_type", { segment: "technology" }, `call_${itemId}`);

    expect(result.state.segment).toBe("other");
  });

  it.each(directAuthorityPaths)("binds a direct $path segment and route to the visitor's clause", (path) => {
    const segmentId = `direct_segment_owner_${path}`;
    const segmentInitial = state({
      segment: "other",
      transcript: [{ role: "user", text: "We were discussing the form." }],
    });
    const segmentAuthority = applyDirectAuthorityTurn(
      segmentInitial,
      path,
      "Alice is a technology company; we are an education company.",
      segmentId,
    );
    const wrongSegment = runDirectMutableTool(
      segmentAuthority,
      "set_partner_type",
      { segment: "technology" },
      `call_${segmentId}`,
    );
    expect(wrongSegment.state.segment).toBe("other");

    const rightSegment = runDirectMutableTool(
      segmentAuthority,
      "set_partner_type",
      { segment: "education" },
      `call_right_${segmentId}`,
    );
    expect(rightSegment.state.segment).toBe("education");

    const routeId = `direct_route_segment_owner_${path}`;
    const routeInitial = state({
      segment: "technology",
      captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
      transcript: [{ role: "user", text: "My name is Bob." }],
    });
    const routeAuthority = applyDirectAuthorityTurn(
      routeInitial,
      path,
      "Alice is a technology company; we are an education company. Please send it.",
      routeId,
    );
    const wrongRoute = runDirectMutableTool(
      routeAuthority,
      "route_to_team",
      { segment: "technology" },
      `call_${routeId}`,
    );
    expect(wrongRoute.state.routeRequested).toBeFalsy();
    expect(wrongRoute.commands.some((command) => command.type === "submit_voice")).toBe(false);

    const rightRoute = runDirectMutableTool(
      routeAuthority,
      "route_to_team",
      { segment: "education" },
      `call_right_${routeId}`,
    );
    expect(rightRoute.commands).toContainEqual({
      type: "submit_voice",
      callId: `call_right_${routeId}`,
      segment: "education",
    });
  });

  it.each(directAuthorityPaths)("rejects uncertain or reported direct $path segment authority", (path) => {
    const guardedStatements = [
      "Maybe we are a technology company.",
      "Perhaps we are in technology.",
      "Alice asked whether we are a technology company.",
      "Alice said we are a technology company.",
      "Alice said: we are a technology company.",
      "Do you think we are a technology company?",
      "Maybe — we are a technology company.",
      "We are a technology company, maybe.",
      "We are a technology company, not really.",
      "We are a technology company — actually, no.",
      "We are in technology if Alice is right.",
      "We are a technology company, or maybe not.",
      "We are a technology company maybe.",
      "We are in technology I guess.",
      "We are technology but no that is wrong.",
      "We are technology according to Alice.",
      "According to Alice, we are technology.",
      "We are technology or education.",
      "We are technology and education.",
      "We are a technology company, and I think maybe not, but please send it.",
      "We are a technology company, but I don't know. Please send it.",
      "We are a technology company, but I do not know. Please send it.",
      "We are a technology company, but I can't say. Please send it.",
      "We are a technology company, but I don’t really know. Please send it.",
      "We are a technology company, but I don't quite know. Please send it.",
      "We are a technology company, but I can't really tell. Please send it.",
      "We are technology. I changed my mind. Please send it.",
      "We are technology, forget that. Please send it.",
      "We are technology scratch that. Please send it.",
      "We are technology take that back. Please send it.",
      "We are technology. Scratch that statement. Please send it.",
      "We are technology. Scratch that description. Please send it.",
      "We are technology. Scratch that answer. Please send it.",
    ];
    for (const [index, statement] of guardedStatements.entries()) {
      const segmentId = `guarded_direct_segment_${path}_${index}`;
      const segmentInitial = state({
        segment: "other",
        transcript: [{ role: "user", text: "We were discussing the form." }],
      });
      const segmentAuthority = applyDirectAuthorityTurn(segmentInitial, path, statement, segmentId);
      const segmentResult = runDirectMutableTool(
        segmentAuthority,
        "set_partner_type",
        { segment: "technology" },
        `call_${segmentId}`,
      );
      expect(segmentResult.state.segment).toBe("other");

      const routeId = `guarded_direct_route_${path}_${index}`;
      const routeInitial = state({
        segment: "other",
        captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
        emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
        transcript: [{ role: "user", text: "My name is Bob." }],
      });
      const routeAuthority = applyDirectAuthorityTurn(routeInitial, path, `${statement} Please send it.`, routeId);
      const routeResult = runDirectMutableTool(
        routeAuthority,
        "route_to_team",
        { segment: "technology" },
        `call_${routeId}`,
      );
      expect(routeResult.state.routeRequested).toBeFalsy();
      expect(routeResult.commands.some((command) => command.type === "submit_voice")).toBe(false);
    }
  });

  it.each(directAuthorityPaths)("keeps a softened $path route clause separate from a certain segment", (path) => {
    const itemId = `softened_route_clause_${path}`;
    const initial = state({
      segment: "other",
      captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
      emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
      transcript: [{ role: "user", text: "My name is Bob." }],
    });
    const authoritative = applyDirectAuthorityTurn(
      initial,
      path,
      "We are a technology company, and I think you should send it.",
      itemId,
    );
    const segmented = runDirectMutableTool(
      authoritative,
      "set_partner_type",
      { segment: "technology" },
      `call_segment_${itemId}`,
    );
    expect(segmented.state.segment).toBe("technology");

    const routed = runDirectMutableTool(
      authoritative,
      "route_to_team",
      { segment: "technology" },
      `call_route_${itemId}`,
    );
    expect(routed.commands).toContainEqual({
      type: "submit_voice",
      callId: `call_route_${itemId}`,
      segment: "technology",
    });

    for (const [index, statement] of [
      "We are technology. I changed my mind about attending the event. Please send it.",
      "We are technology. Our organisation is Scratch That Records. Please send it.",
      "We are technology. Forget that workshop booking. Please send it.",
    ].entries()) {
      const unrelatedId = `unrelated_segment_retraction_${path}_${index}`;
      const unrelatedAuthority = applyDirectAuthorityTurn(initial, path, statement, unrelatedId);
      const unrelatedSegment = runDirectMutableTool(
        unrelatedAuthority,
        "set_partner_type",
        { segment: "technology" },
        `call_segment_${unrelatedId}`,
      );
      expect(unrelatedSegment.state.segment).toBe("technology");
      const unrelatedRoute = runDirectMutableTool(
        unrelatedAuthority,
        "route_to_team",
        { segment: "technology" },
        `call_route_${unrelatedId}`,
      );
      expect(unrelatedRoute.commands).toContainEqual({
        type: "submit_voice",
        callId: `call_route_${unrelatedId}`,
        segment: "technology",
      });
    }
  });

  it.each(directAuthorityPaths)("honours same-turn $path action retractions", (path) => {
    const retractions = [
      "Actually no.",
      "On second thought, no.",
      "Sorry, no.",
      "Forget that.",
      "Cancel that.",
      "Take that back.",
      "I changed my mind.",
      "Forget this.",
      "Ignore this.",
      "Forget what I said.",
      "Disregard my previous answer.",
      "Take back what I said.",
      "Scratch the last bit.",
      "I retract that.",
      "Strike that.",
      "Forget what I just said.",
      "Forget everything I just said.",
      "Disregard all of that.",
      "Ignore everything I said.",
      "Cancel everything I said.",
      "I take everything back.",
      "I take what I said back.",
    ];
    for (const [index, retraction] of retractions.entries()) {
      const routeId = `route_retraction_${path}_${index}`;
      const routeInitial = state({
        segment: "technology",
        captured: { ...emptyCapturedLead, name: "Bob", email: "ready@example.com" },
        emailVerification: { value: "ready@example.com", source: "typed", status: "confirmed" },
        transcript: [{ role: "user", text: "My name is Bob." }],
      });
      const routeAuthority = applyDirectAuthorityTurn(routeInitial, path, `Please send it. ${retraction}`, routeId);
      const routed = runDirectMutableTool(
        routeAuthority,
        "route_to_team",
        { segment: "technology" },
        `call_${routeId}`,
      );
      expect(routed.commands.some((command) => command.type === "submit_voice")).toBe(false);

      const clearId = `clear_retraction_${path}_${index}`;
      const clearAuthority = applyDirectAuthorityTurn(routeInitial, path, `Clear my name. ${retraction}`, clearId);
      const cleared = runDirectMutableTool(clearAuthority, "clear_field", { key: "name" }, `call_${clearId}`);
      expect(cleared.state.captured.name).toBe("Bob");

      const endId = `end_retraction_${path}_${index}`;
      const endAuthority = applyDirectAuthorityTurn(routeInitial, path, `End the call. ${retraction}`, endId);
      const ended = runDirectMutableTool(endAuthority, "end_call", { reason: "user_done" }, `call_${endId}`);
      expect(ended.commands.some((command) => command.type === "end_voice")).toBe(false);

      const captureId = `capture_retraction_${path}_${index}`;
      const captureAuthority = applyDirectAuthorityTurn(
        routeInitial,
        path,
        `My name is Alice. ${retraction}`,
        captureId,
      );
      const captured = runDirectMutableTool(
        captureAuthority,
        "capture_field",
        { key: "name", value: "Alice", evidence: "Alice" },
        `call_${captureId}`,
      );
      expect(captured.state.captured.name).toBe("Bob");
    }

    const inlineId = `inline_capture_retraction_${path}`;
    const inlineInitial = state({
      captured: { ...emptyCapturedLead, name: "Bob" },
      transcript: [{ role: "user", text: "We were discussing the form." }],
    });
    const inlineAuthority = applyDirectAuthorityTurn(inlineInitial, path, "My name is Alice actually no.", inlineId);
    const inlineCapture = runDirectMutableTool(
      inlineAuthority,
      "capture_field",
      { key: "name", value: "Alice", evidence: "Alice" },
      `call_${inlineId}`,
    );
    expect(inlineCapture.state.captured.name).toBe("Bob");

    const correctedNameId = `corrected_bare_name_${path}`;
    const correctedNameAuthority = applyDirectAuthorityTurn(
      inlineInitial,
      path,
      "My name is Alice. Actually no, Carol.",
      correctedNameId,
    );
    const correctedName = runDirectMutableTool(
      correctedNameAuthority,
      "capture_field",
      { key: "name", value: "Carol", evidence: "Carol" },
      `call_${correctedNameId}`,
    );
    expect(correctedName.state.captured.name).toBe("Carol");

    const chainedCorrectionId = `chained_corrected_name_${path}`;
    const chainedCorrectionAuthority = applyDirectAuthorityTurn(
      inlineInitial,
      path,
      "My name is Alice. Actually no, Carol. I mean Dana.",
      chainedCorrectionId,
    );
    const intermediateCorrection = runDirectMutableTool(
      chainedCorrectionAuthority,
      "capture_field",
      { key: "name", value: "Carol", evidence: "Carol" },
      `call_intermediate_${chainedCorrectionId}`,
    );
    expect(intermediateCorrection.state.captured.name).toBe("Bob");
    const finalCorrection = runDirectMutableTool(
      chainedCorrectionAuthority,
      "capture_field",
      { key: "name", value: "Dana", evidence: "Dana" },
      `call_final_${chainedCorrectionId}`,
    );
    expect(finalCorrection.state.captured.name).toBe("Dana");

    for (const [index, finalCorrectionMarker] of [
      "Wait, Dana.",
      "Um, wait, Dana.",
      "Wait, um, Dana.",
      "Wait, Dana, um.",
      "Wait... Dana.",
      "Wait\nDana.",
      "Wait … Dana.",
      "Well, Dana.",
      "Nope, Dana.",
      "Nah, Dana.",
      "Hold on, Dana.",
      "Hang on, Dana.",
      "Hang on a second, Dana.",
      "Hold on one second... uh... Dana.",
      "Make that Dana.",
      "Use Dana.",
      "Make it Dana.",
      "Change it to Dana.",
      "Replace that with Dana.",
      "That is Dana.",
      "On second thought, Dana.",
      "Thinking again, Dana.",
    ].entries()) {
      const markerId = `correction_discourse_marker_${path}_${index}`;
      const markerAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, Carol. ${finalCorrectionMarker}`,
        markerId,
      );
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const staleField = { key: "name", value: "Carol", evidence: "Carol" };
        const staleArgs = tool === "capture_field" ? staleField : { fields: [staleField] };
        const staleResult = runDirectMutableTool(markerAuthority, tool, staleArgs, `call_stale_${tool}_${markerId}`);
        expect(staleResult.state.captured.name).toBe("Bob");

        const finalField = { key: "name", value: "Dana", evidence: "Dana" };
        const finalArgs = tool === "capture_field" ? finalField : { fields: [finalField] };
        const finalResult = runDirectMutableTool(markerAuthority, tool, finalArgs, `call_final_${tool}_${markerId}`);
        expect(finalResult.state.captured.name, `${path}/${tool}: ${finalCorrectionMarker}`).toBe("Dana");
      }
    }

    for (const [index, uncertainCorrection] of ["Make that Dana?", "Maybe make that Dana."].entries()) {
      const uncertainId = `uncertain_correction_discourse_${path}_${index}`;
      const uncertainAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, Carol. ${uncertainCorrection}`,
        uncertainId,
      );
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const settledField = { key: "name", value: "Carol", evidence: "Carol" };
        const settledArgs = tool === "capture_field" ? settledField : { fields: [settledField] };
        const settledResult = runDirectMutableTool(
          uncertainAuthority,
          tool,
          settledArgs,
          `call_settled_${tool}_${uncertainId}`,
        );
        expect(settledResult.state.captured.name).toBe("Carol");

        const uncertainField = { key: "name", value: "Dana", evidence: "Dana" };
        const uncertainArgs = tool === "capture_field" ? uncertainField : { fields: [uncertainField] };
        const uncertainResult = runDirectMutableTool(
          uncertainAuthority,
          tool,
          uncertainArgs,
          `call_uncertain_${tool}_${uncertainId}`,
        );
        expect(uncertainResult.state.captured.name).toBe("Bob");
      }
    }

    for (const [index, stackedCorrection] of ["Actually, my name is Dana.", "Sorry, call me Dana."].entries()) {
      const stackedId = `stacked_corrected_name_${path}_${index}`;
      const stackedAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, Carol. ${stackedCorrection}`,
        stackedId,
      );
      const staleStacked = runDirectMutableTool(
        stackedAuthority,
        "capture_field",
        { key: "name", value: "Carol", evidence: "Carol" },
        `call_intermediate_${stackedId}`,
      );
      expect(staleStacked.state.captured.name).toBe("Bob");
      const finalStacked = runDirectMutableTool(
        stackedAuthority,
        "capture_field",
        { key: "name", value: "Dana", evidence: "Dana" },
        `call_final_${stackedId}`,
      );
      expect(finalStacked.state.captured.name).toBe("Dana");
    }

    for (const [index, names] of [
      ["Ann", "Anna"],
      ["Sam", "Samantha"],
      ["Ann", "Ann Marie"],
      ["Carol", "dana"],
      ["Carol", "May"],
    ].entries()) {
      const [intermediate, final] = names;
      const overlapId = `overlapping_corrected_name_${path}_${index}`;
      const overlapAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, ${intermediate}. I mean ${final}.`,
        overlapId,
      );
      const staleOverlap = runDirectMutableTool(
        overlapAuthority,
        "capture_field",
        { key: "name", value: intermediate, evidence: intermediate },
        `call_intermediate_${overlapId}`,
      );
      expect(staleOverlap.state.captured.name).toBe("Bob");
      const finalOverlap = runDirectMutableTool(
        overlapAuthority,
        "capture_field",
        { key: "name", value: final, evidence: final },
        `call_final_${overlapId}`,
      );
      expect(finalOverlap.state.captured.name).toBe(final);
    }

    const orgExpansionId = `expanded_corrected_org_${path}`;
    const orgExpansionInitial = state({
      captured: { ...emptyCapturedLead, org: "Existing Org" },
      transcript: [{ role: "user", text: "We were discussing the form." }],
    });
    const orgExpansionAuthority = applyDirectAuthorityTurn(
      orgExpansionInitial,
      path,
      "My organisation is Old Org. Actually no, Acme. I mean Acme Labs.",
      orgExpansionId,
    );
    const intermediateOrg = runDirectMutableTool(
      orgExpansionAuthority,
      "capture_field",
      { key: "org", value: "Acme", evidence: "Acme" },
      `call_intermediate_${orgExpansionId}`,
    );
    expect(intermediateOrg.state.captured.org).toBe("Existing Org");
    const finalOrg = runDirectMutableTool(
      orgExpansionAuthority,
      "capture_field",
      { key: "org", value: "Acme Labs", evidence: "Acme Labs" },
      `call_final_${orgExpansionId}`,
    );
    expect(finalOrg.state.captured.org).toBe("Acme Labs");

    const questionCorrectionId = `question_corrected_name_${path}`;
    const questionCorrectionAuthority = applyDirectAuthorityTurn(
      inlineInitial,
      path,
      "My name is Alice. Actually no, Carol?",
      questionCorrectionId,
    );
    const questionCorrection = runDirectMutableTool(
      questionCorrectionAuthority,
      "capture_field",
      { key: "name", value: "Carol", evidence: "Carol" },
      `call_${questionCorrectionId}`,
    );
    expect(questionCorrection.state.captured.name).toBe("Bob");

    for (const [index, correction] of ["I mean Carol.", "Call me Carol."].entries()) {
      const directCorrectionId = `direct_corrected_name_${path}_${index}`;
      const directCorrectionAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, ${correction}`,
        directCorrectionId,
      );
      const directCorrection = runDirectMutableTool(
        directCorrectionAuthority,
        "capture_field",
        { key: "name", value: "Carol", evidence: "Carol" },
        `call_${directCorrectionId}`,
      );
      expect(directCorrection.state.captured.name).toBe("Carol");
    }

    for (const [index, unrelatedMention] of ["Carol is attending the event.", "Call Carol."].entries()) {
      const unrelatedMentionId = `unrelated_corrected_name_${path}_${index}`;
      const unrelatedMentionAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, ${unrelatedMention}`,
        unrelatedMentionId,
      );
      const unrelatedMentionCapture = runDirectMutableTool(
        unrelatedMentionAuthority,
        "capture_field",
        { key: "name", value: "Carol", evidence: "Carol" },
        `call_${unrelatedMentionId}`,
      );
      expect(unrelatedMentionCapture.state.captured.name).toBe("Bob");
    }

    for (const [index, laterDiscourse] of [
      "Actually, the event is tomorrow.",
      "I mean, the event is tomorrow.",
      "Actually, venue logistics.",
      "Sorry, parking arrangements.",
      "I mean Friday.",
    ].entries()) {
      const discourseId = `later_unrelated_correction_discourse_${path}_${index}`;
      const discourseAuthority = applyDirectAuthorityTurn(
        inlineInitial,
        path,
        `My name is Alice. Actually no, Carol. ${laterDiscourse}`,
        discourseId,
      );
      const discourseCapture = runDirectMutableTool(
        discourseAuthority,
        "capture_field",
        { key: "name", value: "Carol", evidence: "Carol" },
        `call_${discourseId}`,
      );
      expect(discourseCapture.state.captured.name).toBe("Carol");
    }

    for (const [index, correction] of [
      {
        key: "org" as const,
        value: "Acme",
        statement: "My organisation is Old Org. Actually no, we are Acme.",
      },
      {
        key: "org" as const,
        value: "Acme",
        statement: "My organisation is Old Org. Actually no, our organisation is Acme.",
      },
      {
        key: "website" as const,
        value: "new.example",
        statement: "My website is old.example. Actually no, it's new.example.",
      },
      {
        key: "email" as const,
        value: "new@example.com",
        statement: "My email is old@example.com. Actually no, it's new@example.com.",
      },
      {
        key: "email" as const,
        value: "new@example.com",
        statement: "Priya's email is new@example.com. Actually no, new@example.com is mine.",
      },
    ].entries()) {
      const naturalCorrectionId = `natural_corrected_field_${path}_${index}`;
      const naturalCorrectionAuthority = applyDirectAuthorityTurn(
        state({ transcript: [{ role: "user", text: "We were discussing the form." }] }),
        path,
        correction.statement,
        naturalCorrectionId,
      );
      const naturalCorrection = runDirectMutableTool(
        naturalCorrectionAuthority,
        "capture_field",
        { key: correction.key, value: correction.value, evidence: correction.value },
        `call_${naturalCorrectionId}`,
      );
      expect(naturalCorrection.state.captured[correction.key]).toBe(correction.value);
    }

    const replacementEmailId = `retracted_replacement_email_${path}`;
    const replacementEmailInitial = state({
      captured: { ...emptyCapturedLead, email: "old@example.com" },
      emailVerification: { value: "old@example.com", source: "typed", status: "confirmed" },
      transcript: [{ role: "user", text: "We were discussing the form." }],
    });
    const replacementEmailAuthority = applyDirectAuthorityTurn(
      replacementEmailInitial,
      path,
      "My email is new@example.com, forget that.",
      replacementEmailId,
    );
    expect(replacementEmailAuthority.captured.email).toBe("old@example.com");
    expect(replacementEmailAuthority.emailVerification).toEqual(replacementEmailInitial.emailVerification);
    const replacementEmailCapture = runDirectMutableTool(
      replacementEmailAuthority,
      "capture_field",
      { key: "email", value: "new@example.com", evidence: "new@example.com" },
      `call_${replacementEmailId}`,
    );
    expect(replacementEmailCapture.state.captured.email).toBe("old@example.com");

    const reaffirmedEmailId = `reaffirmed_current_retracted_replacement_${path}`;
    const reaffirmedEmailAuthority = applyDirectAuthorityTurn(
      replacementEmailInitial,
      path,
      "old@example.com is still my email. My email is new@example.com, forget that.",
      reaffirmedEmailId,
    );
    expect(reaffirmedEmailAuthority.captured.email).toBe("old@example.com");
    expect(reaffirmedEmailAuthority.emailVerification).toEqual(replacementEmailInitial.emailVerification);

    const currentEmailId = `retracted_current_email_${path}`;
    const currentEmailAuthority = applyDirectAuthorityTurn(
      replacementEmailInitial,
      path,
      "My email is old@example.com, forget that.",
      currentEmailId,
    );
    expect(currentEmailAuthority.captured.email).toBe(path === "typed" ? "" : "old@example.com");
    expect(currentEmailAuthority.emailVerification).toEqual(
      path === "typed" ? undefined : replacementEmailInitial.emailVerification,
    );

    const captureRetractions = [
      "My name is Alice, actually no.",
      "My name is Alice, forget that.",
      "My name is Alice, I changed my mind.",
      "My name is Alice, scratch that.",
    ];
    for (const [index, statement] of captureRetractions.entries()) {
      const itemId = `comma_capture_retraction_${path}_${index}`;
      const authoritative = applyDirectAuthorityTurn(inlineInitial, path, statement, itemId);
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const args =
          tool === "capture_field"
            ? { key: "name", value: "Alice", evidence: "Alice" }
            : { fields: [{ key: "name", value: "Alice", evidence: "Alice" }] };
        const captured = runDirectMutableTool(authoritative, tool, args, `call_${tool}_${itemId}`);
        expect(captured.state.captured.name).toBe("Bob");
      }
    }

    const repeatedRejectedValues = [
      "My name is Alice. Actually no, Alice is wrong.",
      "My name is Alice. Actually no, forget Alice.",
      "My name is Alice. Scratch that, Alice was wrong.",
    ];
    for (const [index, statement] of repeatedRejectedValues.entries()) {
      const itemId = `repeated_rejected_value_${path}_${index}`;
      const authoritative = applyDirectAuthorityTurn(inlineInitial, path, statement, itemId);
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const field = { key: "name", value: "Alice", evidence: "Alice" };
        const args = tool === "capture_field" ? field : { fields: [field] };
        const result = runDirectMutableTool(authoritative, tool, args, `call_${tool}_${itemId}`);
        expect(result.state.captured.name).toBe("Bob");
      }
    }

    const restoredId = `restored_capture_authority_${path}`;
    const restoredAuthority = applyDirectAuthorityTurn(
      inlineInitial,
      path,
      "My name is Alice. Actually no, my name is Alice.",
      restoredId,
    );
    const restored = runDirectMutableTool(
      restoredAuthority,
      "capture_field",
      { key: "name", value: "Alice", evidence: "Alice" },
      `call_${restoredId}`,
    );
    expect(restored.state.captured.name).toBe("Alice");

    const unrelatedRetractionScopes = [
      "My name is Alice. I changed my mind about attending the event.",
      "My name is Alice. Actually no, cancel the workshop booking.",
    ];
    for (const [index, statement] of unrelatedRetractionScopes.entries()) {
      const itemId = `unrelated_retraction_scope_${path}_${index}`;
      const authoritative = applyDirectAuthorityTurn(inlineInitial, path, statement, itemId);
      const result = runDirectMutableTool(
        authoritative,
        "capture_field",
        { key: "name", value: "Alice", evidence: "Alice" },
        `call_${itemId}`,
      );
      expect(result.state.captured.name).toBe("Alice");
    }

    const fieldTargetedRetractions = [
      "My name is Alice. I changed my mind about the name.",
      "My name is Alice. I changed my mind about that name.",
      "My name is Alice. Actually no, cancel the name change.",
      "My name is Alice. Forget the name change.",
      "My name is Alice. Cancel the name update.",
      "My name is Alice. Scratch the name.",
    ];
    for (const [index, statement] of fieldTargetedRetractions.entries()) {
      const itemId = `field_targeted_retraction_${path}_${index}`;
      const authoritative = applyDirectAuthorityTurn(inlineInitial, path, statement, itemId);
      const result = runDirectMutableTool(
        authoritative,
        "capture_field",
        { key: "name", value: "Alice", evidence: "Alice" },
        `call_${itemId}`,
      );
      expect(result.state.captured.name).toBe("Bob");
    }

    const qualifiedObjectCases = [
      {
        key: "name" as const,
        initial: "Bob",
        value: "Alice",
        statement: "My name is Alice. I changed my mind about the event name.",
        expected: "Alice",
      },
      {
        key: "name" as const,
        initial: "Bob",
        value: "Alice",
        statement: "My name is Alice. I changed my mind about the name of the event.",
        expected: "Alice",
      },
      {
        key: "org" as const,
        initial: "Old Org",
        value: "Acme",
        statement: "My organisation is Acme. I changed my mind about the catering company.",
        expected: "Acme",
      },
      {
        key: "website" as const,
        initial: "old.example",
        value: "new.example",
        statement: "My website is new.example. I changed my mind about the domain.",
        expected: "old.example",
      },
      {
        key: "website" as const,
        initial: "old.example",
        value: "new.example",
        statement: "My website is new.example. I changed my mind about the website for the event.",
        expected: "new.example",
      },
      {
        key: "website" as const,
        initial: "old.example",
        value: "new.example",
        statement: "My website is new.example. I changed my mind about our own domain.",
        expected: "old.example",
      },
      {
        key: "email" as const,
        initial: "old@example.com",
        value: "new@example.com",
        statement: "My email is new@example.com. I changed my mind about my personal email.",
        expected: "old@example.com",
      },
      {
        key: "org" as const,
        initial: "Old Org",
        value: "Acme",
        statement: "My organisation is Acme. I changed my mind about the business.",
        expected: "Old Org",
      },
      {
        key: "website" as const,
        initial: "old.example",
        value: "new.example",
        statement: "My website is new.example. I changed my mind about a different domain.",
        expected: "old.example",
      },
      {
        key: "org" as const,
        initial: "Old Org",
        value: "Acme",
        statement: "My organisation is Acme. I changed my mind about another company.",
        expected: "Old Org",
      },
      {
        key: "name" as const,
        initial: "Bob",
        value: "Alice",
        statement: "My name is Alice. I changed my mind about using a different name.",
        expected: "Bob",
      },
      {
        key: "website" as const,
        initial: "old.example",
        value: "new.example",
        statement: "My website is new.example. I changed my mind about our new domain.",
        expected: "old.example",
      },
    ];
    for (const [index, capture] of qualifiedObjectCases.entries()) {
      const itemId = `qualified_retraction_object_${path}_${index}`;
      const initial = state({
        captured: { ...emptyCapturedLead, [capture.key]: capture.initial },
        transcript: [{ role: "user", text: "We were discussing the form." }],
      });
      const authoritative = applyDirectAuthorityTurn(initial, path, capture.statement, itemId);
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const field = { key: capture.key, value: capture.value, evidence: capture.value };
        const args = tool === "capture_field" ? field : { fields: [field] };
        const result = runDirectMutableTool(authoritative, tool, args, `call_${tool}_${itemId}`);
        expect(result.state.captured[capture.key]).toBe(capture.expected);
      }
    }

    const literalRetractionValues = [
      { key: "message" as const, value: "Please cancel that workshop booking." },
      { key: "message" as const, value: "I changed my mind about the event date." },
      { key: "message" as const, value: "Actually no, the event is postponed." },
      { key: "org" as const, value: "Scratch That Records" },
    ];
    for (const [index, capture] of literalRetractionValues.entries()) {
      const itemId = `literal_retraction_value_${path}_${index}`;
      const authoritative = applyDirectAuthorityTurn(
        state({ transcript: [{ role: "user", text: "We were discussing the form." }] }),
        path,
        `My ${capture.key === "org" ? "organisation" : "message"} is: ${capture.value}`,
        itemId,
      );
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const field = { key: capture.key, value: capture.value, evidence: capture.value };
        const args = tool === "capture_field" ? field : { fields: [field] };
        const result = runDirectMutableTool(authoritative, tool, args, `call_${tool}_${itemId}`);
        expect(result.state.captured[capture.key]).toBe(capture.value);
      }
    }

    const swallowedRetractions = [
      { key: "name" as const, value: "Alice actually no" },
      { key: "name" as const, value: "Alice scratch that name" },
      { key: "message" as const, value: "Book Tuesday actually no" },
      { key: "org" as const, value: "Acme scratch that" },
      { key: "org" as const, value: "Acme forget that company" },
      { key: "phone" as const, value: "60123456789 cancel that number" },
    ];
    for (const [index, capture] of swallowedRetractions.entries()) {
      const itemId = `swallowed_retraction_${path}_${index}`;
      const initial = state({
        captured: { ...emptyCapturedLead, ...(capture.key === "name" ? { name: "Bob" } : {}) },
        transcript: [{ role: "user", text: "We were discussing the form." }],
      });
      const authoritative = applyDirectAuthorityTurn(
        initial,
        path,
        `My ${capture.key === "org" ? "organisation" : capture.key} is ${capture.value}.`,
        itemId,
      );
      for (const tool of ["capture_field", "capture_fields"] as const) {
        const field = { key: capture.key, value: capture.value, evidence: capture.value };
        const args = tool === "capture_field" ? field : { fields: [field] };
        const result = runDirectMutableTool(authoritative, tool, args, `call_${tool}_${itemId}`);
        expect(result.state.captured[capture.key]).toBe(capture.key === "name" ? "Bob" : "");
      }
    }
  });

  it.each(
    directAuthorityPaths.flatMap((path) =>
      [
        "Should I send it to your competitor?",
        "Should I send it to Alice?",
        "Should I send it to the venue?",
        "Should I send it to Mereka's competitor?",
        "Should I share the form with your competitor?",
        "Should I share the form with Alice?",
        "Should I share the form with the venue?",
        "Should I share the form with Mereka's competitor?",
        "Should I route the form via your competitor?",
        "Should I route the form via Alice?",
        "Should I route the form through the venue?",
        "Should I route the form through Mereka's competitor?",
      ].map((prompt) => ({ path, prompt })),
    ),
  )("does not rewrite an unrelated $path route destination: $prompt", ({ path, prompt }) => {
    const itemId = `unrelated_route_destination_${path}_${prompt.length}`;
    const initial = conversationalAuthorityState({ tool: "route_to_team", prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, "route_to_team", { segment: "technology" }, `call_${itemId}`);

    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
  });

  const negativeConfirmationPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "That phone number is not +60123456789, correct?",
    website_batch_capture: "That website is not wrong.example, correct?",
    clear_name: "You do not want me to clear your name, correct?",
    clear_all: "You do not want me to clear everything in the form, correct?",
    segment: "You are not a technology company, correct?",
    route: "You do not want me to send it yet, correct?",
    end: "You do not want me to end the call, correct?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("does not invert a negative $path $toolCase.id proposition when the user says yes", ({ path, toolCase }) => {
    const itemId = `negative_prompt_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({
      ...toolCase,
      prompt: negativeConfirmationPrompts[toolCase.id],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const contractedNegativeConfirmationPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "That phone number hasn't been confirmed as +60123456789. Is that right?",
    website_batch_capture: "That website hasn't been confirmed as wrong.example. Is that right?",
    clear_name: "You didn't ask me to clear your name. Is that right?",
    clear_all: "You didn't ask me to clear everything in the form. Is that right?",
    segment: "You haven't said you are a technology company. Is that right?",
    route: "You didn't ask me to send it. Is that right?",
    end: "You didn't ask me to end the call. Is that right?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("does not invert a contracted-negative $path $toolCase.id proposition", ({ path, toolCase }) => {
    const itemId = `contracted_negative_prompt_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({
      ...toolCase,
      prompt: contractedNegativeConfirmationPrompts[toolCase.id],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const lexicalRefusalPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string, string]
  > = {
    phone_capture: [
      "You declined to save your phone as +60123456789. Is that right?",
      "You refused to let me save your phone as +60123456789. Is that right?",
      "You said no to saving your phone as +60123456789. Is that right?",
    ],
    website_batch_capture: [
      "You declined to save your website as wrong.example. Is that right?",
      "You refused to let me save your website as wrong.example. Is that right?",
      "You said no to saving your website as wrong.example. Is that right?",
    ],
    clear_name: [
      "You declined to have me clear your name. Is that right?",
      "You refused to let me clear your name. Is that right?",
      "You said no to clearing your name. Is that right?",
    ],
    clear_all: [
      "You declined to have me clear everything. Is that right?",
      "You refused to let me clear everything. Is that right?",
      "You said no to clearing everything. Is that right?",
    ],
    segment: [
      "You declined to classify this as technology. Is that right?",
      "You refused to classify this as technology. Is that right?",
      "You said no to classifying this as technology. Is that right?",
    ],
    route: [
      "You declined to have me send it. Is that right?",
      "You refused to let me send it. Is that right?",
      "You said no to sending it. Is that right?",
    ],
    end: [
      "You declined to have me end the call. Is that right?",
      "You refused to let me end the call. Is that right?",
      "You said no to ending the call. Is that right?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        lexicalRefusalPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("does not invert a lexical refusal for $path $toolCase.id", ({ path, toolCase, prompt }) => {
    const itemId = `lexical_refusal_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const historicalConfirmationPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string, string]
  > = {
    phone_capture: [
      "You used to have +60123456789 as your phone number. Is that right?",
      "Your phone number was previously +60123456789. Is that right?",
      "Back then, your phone number was +60123456789. Is that right?",
    ],
    website_batch_capture: [
      "You used to have wrong.example as your website. Is that right?",
      "Your website was previously wrong.example. Is that right?",
      "Back then, your website was wrong.example. Is that right?",
    ],
    clear_name: [
      "You used to want me to clear your name. Is that right?",
      "You previously wanted me to clear your name. Is that right?",
      "Back then, you wanted me to clear your name. Is that right?",
    ],
    clear_all: [
      "You used to want me to clear everything. Is that right?",
      "You previously wanted me to clear everything. Is that right?",
      "Back then, you wanted me to clear everything. Is that right?",
    ],
    segment: [
      "You used to be a technology company. Is that right?",
      "You were previously a technology company. Is that right?",
      "Back then, you were a technology company. Is that right?",
    ],
    route: [
      "You used to want me to send it. Is that right?",
      "You previously wanted me to send it. Is that right?",
      "Back then, you wanted me to send it. Is that right?",
    ],
    end: [
      "You used to want me to end the call. Is that right?",
      "You previously wanted me to end the call. Is that right?",
      "Back then, you wanted me to end the call. Is that right?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        historicalConfirmationPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("does not treat historical $path $toolCase.id state as current authority", ({ path, toolCase, prompt }) => {
    const itemId = `historical_prompt_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const alternativeConfirmationPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string]
  > = {
    phone_capture: ["Is your phone something other than +60123456789?", "Is your phone +60123456789 or +60987654321?"],
    website_batch_capture: [
      "Is your website something other than wrong.example?",
      "Is your website wrong.example or right.example?",
    ],
    clear_name: ["Should I leave your name as-is rather than clear it?", "Should I keep your name or clear it?"],
    clear_all: [
      "Should I keep everything instead of clear all fields?",
      "Should I keep everything or clear all fields?",
    ],
    segment: ["Are you in education rather than technology?", "Are you in education or technology?"],
    route: ["Should I keep this as a draft instead of send it?", "Should I keep this as a draft or send it?"],
    end: ["Should I keep the call open instead of end it?", "Should I continue or end the call?"],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        alternativeConfirmationPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("does not let yes choose an alternative in $path $toolCase.id: $prompt", ({ path, toolCase, prompt }) => {
    const itemId = `alternative_prompt_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const opposedConfirmationPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "Is your phone +60987654321, as opposed to +60123456789?",
    website_batch_capture: "Is your website right.example, as opposed to wrong.example?",
    clear_name: "Should I clear your phone, as opposed to your name?",
    clear_all: "Should I clear your name, as opposed to everything in the form?",
    segment: "Are you an education company, as opposed to technology?",
    route: "Should I clear the form, as opposed to send it?",
    end: "Should I continue, as opposed to end the call?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("does not let yes choose the opposed $path $toolCase.id alternative", ({ path, toolCase }) => {
    const itemId = `opposed_prompt_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({
      ...toolCase,
      prompt: opposedConfirmationPrompts[toolCase.id],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const contrastSynonymPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string, string]
  > = {
    phone_capture: [
      "Is your phone +60987654321 versus +60123456789?",
      "Is your phone +60987654321 vs. +60123456789?",
      "Is your phone +60987654321 in contrast to +60123456789?",
    ],
    website_batch_capture: [
      "Is your website right.example versus wrong.example?",
      "Is your website right.example vs. wrong.example?",
      "Is your website right.example compared with wrong.example?",
    ],
    clear_name: [
      "Should I clear your phone versus your name?",
      "Should I clear your phone vs. your name?",
      "Should I clear your phone in contrast to your name?",
    ],
    clear_all: [
      "Should I clear your name versus everything?",
      "Should I clear your name vs. everything?",
      "Should I clear your name compared with everything?",
    ],
    segment: [
      "Are you in education versus technology?",
      "Are you in education vs. technology?",
      "Are you in education in contrast to technology?",
    ],
    route: [
      "Should I clear the form versus send it?",
      "Should I clear the form vs. send it?",
      "Should I clear the form compared with send it?",
    ],
    end: [
      "Should I continue versus end the call?",
      "Should I continue vs. end the call?",
      "Should I continue in contrast to end the call?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        contrastSynonymPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("does not let yes choose a contrastive $path $toolCase.id alternative", ({ path, toolCase, prompt }) => {
    const itemId = `contrast_synonym_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const differentQuestionPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "Before I save your phone as +60123456789, should I update your name first?",
    website_batch_capture: "Before I save your website as wrong.example, should I update your name first?",
    clear_name: "Before I clear your name, should I save a copy first?",
    clear_all: "Before I clear all fields, should I save a copy first?",
    segment: "Before I classify this as technology, should I clarify your goals first?",
    route: "Before I send it, should I update your name first?",
    end: "Before I end the call, do you need anything else?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("binds yes to the actual $path question, not an earlier $toolCase.id cue", ({ path, toolCase }) => {
    const itemId = `different_question_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({
      ...toolCase,
      prompt: differentQuestionPrompts[toolCase.id],
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const whQuestionPrompts: Record<(typeof anaphoricAuthorityCases)[number]["id"], string> = {
    phone_capture: "Your phone is +60123456789: whose number is that?",
    website_batch_capture: "Your website is wrong.example: whose site is that?",
    clear_name: "Clear your name: who asked for that?",
    clear_all: "Clear everything: who asked for that?",
    segment: "Technology: who handles it?",
    route: "Send it: who handles the follow-up?",
    end: "End the call: who confirms that?",
  };

  it.each(
    directAuthorityPaths.flatMap((path) => anaphoricAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("does not treat yes to a $path wh-question as $toolCase.id authority", ({ path, toolCase }) => {
    const itemId = `wh_question_yes_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt: whQuestionPrompts[toolCase.id] });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const unsafeGenericReadbackPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string]
  > = {
    phone_capture: [
      "I can save your phone as +60123456789. Your name is Alice. Is that right?",
      "You are still unsure whether the phone number is +60123456789. Is that right?",
    ],
    website_batch_capture: [
      "I can save your website as wrong.example. Your name is Alice. Is that right?",
      "You are still unsure whether the website is wrong.example. Is that right?",
    ],
    clear_name: [
      "I can clear your name. Your phone is +60123456789. Is that right?",
      "You want me to wait before I clear your name. Is that right?",
    ],
    clear_all: [
      "I can clear all fields. Your phone is +60123456789. Is that right?",
      "You want me to wait before I clear everything. Is that right?",
    ],
    segment: [
      "I can classify this as technology. Your phone is +60123456789. Is that right?",
      "You are unsure whether technology is the right segment. Is that right?",
    ],
    route: [
      "I can send it. Your phone is +60123456789. Is that right?",
      "You want me to wait before I send it. Is that right?",
    ],
    end: [
      "I can end the call. Your phone is +60123456789. Is that right?",
      "You want me to wait before I end the call. Is that right?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        unsafeGenericReadbackPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("does not let generic yes misbind $path $toolCase.id: $prompt", ({ path, toolCase, prompt }) => {
    const itemId = `unsafe_generic_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const crossClauseGenericReadbackPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string]
  > = {
    phone_capture: [
      "I can save your phone as +60123456789; your name is Alice. Is that right?",
      "I can save your phone as +60123456789, your name is Alice. Is that right?",
    ],
    website_batch_capture: [
      "I can save your website as wrong.example; your name is Alice. Is that right?",
      "I can save your website as wrong.example, your name is Alice. Is that right?",
    ],
    clear_name: [
      "I can clear your name; your phone is +60123456789. Is that right?",
      "I can clear your name, your phone is +60123456789. Is that right?",
    ],
    clear_all: [
      "I can clear everything; your phone is +60123456789. Is that right?",
      "I can clear everything, your phone is +60123456789. Is that right?",
    ],
    segment: [
      "I can classify this as technology; your phone is +60123456789. Is that right?",
      "I can classify this as technology, your phone is +60123456789. Is that right?",
    ],
    route: [
      "I can send it; your phone is +60123456789. Is that right?",
      "I can send it, your phone is +60123456789. Is that right?",
    ],
    end: [
      "I can end the call; your phone is +60123456789. Is that right?",
      "I can end the call, your phone is +60123456789. Is that right?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        crossClauseGenericReadbackPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("binds generic yes to the immediate $path clause, not an earlier $toolCase.id cue", ({
    path,
    toolCase,
    prompt,
  }) => {
    const itemId = `cross_clause_generic_yes_${path}_${toolCase.id}_${prompt.includes(";") ? "semicolon" : "comma"}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const strongBoundaryGenericReadbackPrompts: Record<
    (typeof anaphoricAuthorityCases)[number]["id"],
    readonly [string, string, string]
  > = {
    phone_capture: [
      "I can save your phone as +60123456789 — contact Bob. Is that right?",
      "I can save your phone as +60123456789: contact Bob. Is that right?",
      "I can save your phone as +60123456789\nContact Bob. Is that right?",
    ],
    website_batch_capture: [
      "I can save your website as wrong.example — contact Bob. Is that right?",
      "I can save your website as wrong.example: contact Bob. Is that right?",
      "I can save your website as wrong.example\nContact Bob. Is that right?",
    ],
    clear_name: [
      "I can clear your name — contact Bob. Is that right?",
      "I can clear your name: contact Bob. Is that right?",
      "I can clear your name\nContact Bob. Is that right?",
    ],
    clear_all: [
      "I can clear everything — contact Bob. Is that right?",
      "I can clear everything: contact Bob. Is that right?",
      "I can clear everything\nContact Bob. Is that right?",
    ],
    segment: [
      "I can classify this as technology — contact Bob. Is that right?",
      "I can classify this as technology: contact Bob. Is that right?",
      "I can classify this as technology\nContact Bob. Is that right?",
    ],
    route: [
      "I can send it — contact Bob. Is that right?",
      "I can send it: contact Bob. Is that right?",
      "I can send it\nContact Bob. Is that right?",
    ],
    end: [
      "I can end the call — contact Bob. Is that right?",
      "I can end the call: contact Bob. Is that right?",
      "I can end the call\nContact Bob. Is that right?",
    ],
  };

  it.each(
    directAuthorityPaths.flatMap((path) =>
      anaphoricAuthorityCases.flatMap((toolCase) =>
        strongBoundaryGenericReadbackPrompts[toolCase.id].map((prompt) => ({ path, toolCase, prompt })),
      ),
    ),
  )("binds generic yes after a strong boundary to its immediate $path clause", ({ path, toolCase, prompt }) => {
    const itemId = `strong_boundary_generic_yes_${path}_${toolCase.id}_${prompt.length}`;
    const initial = conversationalAuthorityState({ ...toolCase, prompt });
    const authoritative = applyDirectAuthorityTurn(initial, path, "Yes.", itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  const pendingCaptureAuthorityCases = [
    {
      id: "name",
      tool: "capture_field",
      prompt: "Should I save your name as Alice?",
      arguments: { key: "name", value: "Alice", evidence: "Alice" },
      expectedKey: "name",
      expectedValue: "Alice",
    },
    {
      id: "phone",
      tool: "capture_field",
      prompt: "I heard your phone number as +60123456789. Is that right?",
      arguments: { key: "phone", value: "+60123456789", evidence: "+60123456789" },
      expectedKey: "phone",
      expectedValue: "+60123456789",
    },
    {
      id: "website_batch",
      tool: "capture_fields",
      prompt: "I heard your website as wrong.example. Is that right?",
      arguments: { fields: [{ key: "website", value: "wrong.example", evidence: "wrong.example" }] },
      expectedKey: "website",
      expectedValue: "wrong.example",
    },
  ] as const;
  const pendingCapturePaths = ["pending_tagged", "pending_tagged_with_response"] as const;

  it.each(
    pendingCapturePaths.flatMap((path) =>
      pendingCaptureAuthorityCases.flatMap((toolCase) =>
        [
          { reply: "No.", accepted: false },
          { reply: "Yes.", accepted: true },
        ].map((outcome) => ({ path, toolCase, ...outcome })),
      ),
    ),
  )("waits for $path $toolCase.id ASR before applying reply '$reply'", ({ path, toolCase, reply, accepted }) => {
    const itemId = `pending_capture_${path}_${toolCase.id}_${accepted ? "yes" : "no"}`;
    const initial = conversationalAuthorityState({ ...toolCase, tool: toolCase.tool });
    let pending = reduceRealtimeServerEvent({ type: "input_audio_buffer.committed", item_id: itemId }, initial).state;
    if (path === "pending_tagged_with_response") {
      pending = reduceRealtimeServerEvent({ type: "response.created" }, pending).state;
    }
    const deferred = runDirectMutableTool(pending, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(deferred.commands).toEqual([]);
    expect(deferred.state.captured).toEqual(initial.captured);
    expect(deferred.state.deferredMutationCalls).toHaveLength(1);

    const settled = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: itemId,
        transcript: reply,
      },
      deferred.state,
    );
    expect(settled.state.captured[toolCase.expectedKey]).toBe(
      accepted ? toolCase.expectedValue : initial.captured[toolCase.expectedKey],
    );
    expect(settled.state.deferredMutationCalls ?? []).toEqual([]);
  });

  const wrongAuthorityCases = [
    {
      id: "capture_name_from_phone_command",
      tool: "capture_field",
      current: "Clear my phone.",
      arguments: { key: "name", value: "Alice", evidence: "Alice" },
    },
    {
      id: "capture_website_from_phone_command",
      tool: "capture_fields",
      current: "My phone is +60123456789.",
      arguments: { fields: [{ key: "website", value: "wrong.example", evidence: "wrong.example" }] },
    },
    {
      id: "clear_name_from_phone_command",
      tool: "clear_field",
      current: "Clear my phone.",
      arguments: { key: "name" },
    },
    {
      id: "clear_all_from_name_command",
      tool: "clear_fields",
      current: "Clear my name.",
      arguments: { scope: "all" },
    },
    {
      id: "technology_from_education_statement",
      tool: "set_partner_type",
      current: "We are an education company.",
      arguments: { segment: "technology" },
    },
    {
      id: "route_from_clear_command",
      tool: "route_to_team",
      current: "Clear my name.",
      arguments: { segment: "technology" },
    },
    {
      id: "end_from_clear_command",
      tool: "end_call",
      current: "Clear my name.",
      arguments: { reason: "user_done" },
    },
  ] as const;

  it.each(
    directAuthorityPaths.flatMap((path) => wrongAuthorityCases.map((toolCase) => ({ path, toolCase }))),
  )("does not apply $path $toolCase.id across an action or target boundary", ({ path, toolCase }) => {
    const itemId = `wrong_authority_${path}_${toolCase.id}`;
    const initial = conversationalAuthorityState({
      ...anaphoricAuthorityCases[0],
      tool: toolCase.tool,
    });
    const authoritative = applyDirectAuthorityTurn(initial, path, toolCase.current, itemId);
    const result = runDirectMutableTool(authoritative, toolCase.tool, toolCase.arguments, `call_${itemId}`);

    expect(result.state.captured).toEqual(initial.captured);
    expect(result.state.segment).toBe(initial.segment);
    expect(result.state.routeRequested).toBeFalsy();
    expect(result.commands.some((command) => command.type === "submit_voice")).toBe(false);
    expect(result.commands.some((command) => command.type === "end_voice")).toBe(false);
  });

  it("bounds tagged transcript identity, outcomes, and buffered PII for the whole session", () => {
    let runtime = state();
    for (let index = 0; index < 257; index += 1) {
      runtime = reduceRealtimeServerEvent(
        { type: "input_audio_buffer.committed", item_id: `audio_bounded_${index}` },
        runtime,
      ).state;
      runtime = reduceRealtimeServerEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `audio_bounded_${index}`,
          transcript: `Turn ${index}`,
        },
        runtime,
      ).state;
    }

    expect(runtime.userTranscriptTrackingExhausted).toBe(true);
    expect(runtime.observedUserSpeechStartIds).toHaveLength(256);
    expect(runtime.settledUserTranscriptIds).toHaveLength(256);
    expect(Object.keys(runtime.settledUserTranscriptOutcomes ?? {})).toHaveLength(256);
    expect(runtime.pendingUserTranscriptIds ?? []).toHaveLength(0);
    expect(Object.keys(runtime.settledUserTranscriptBuffer ?? {})).toHaveLength(0);
  });

  it("fails closed instead of evicting a clear-barrier transcript tombstone", () => {
    let runtime = reduceRealtimeServerEvent(
      {
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              name: "clear_fields",
              call_id: "call_clear_before_tombstone_cap",
              arguments: JSON.stringify({ scope: "all" }),
            },
          ],
        },
      },
      state({ emailCaptureMode: "adaptive" }),
    ).state;
    for (let index = 0; index < 256; index += 1) {
      runtime = reduceRealtimeServerEvent(
        {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: `unknown_${index}`,
          transcript: "Old private transcript.",
        },
        runtime,
      ).state;
    }
    runtime = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "legitimate_after_cap" },
      runtime,
    ).state;
    runtime = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.committed", item_id: "legitimate_after_cap" },
      runtime,
    ).state;
    runtime = reduceRealtimeServerEvent(
      {
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "legitimate_after_cap",
        transcript: "My email is legitimate@example.com.",
        email_capture_mode: "adaptive",
      },
      runtime,
    ).state;
    const replayed = reduceRealtimeServerEvent(
      { type: "input_audio_buffer.speech_started", item_id: "unknown_0" },
      runtime,
    ).state;

    expect(runtime.userTranscriptTrackingExhausted).toBe(true);
    expect(runtime.settledUserTranscriptIds).toHaveLength(256);
    expect(runtime.settledUserTranscriptIds).toContain("unknown_0");
    expect(runtime.captured.email).toBe("");
    expect(replayed.settledUserTranscriptIds).toContain("unknown_0");
  });
});
