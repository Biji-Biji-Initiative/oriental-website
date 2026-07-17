import { describe, expect, it } from "vitest";
import { openingVoiceInstruction } from "@/components/voice-agent/voice-dialog-copy";
import { buildVoiceInstructions, VOICE_PROFILE, VOICE_TOOLS } from "@/lib/voice/profile";

describe("voice profile", () => {
  it("builds a compact reflex prompt with facts behind a read-only tool", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("# Role and Objective");
    expect(prompt).toContain("# Tool Contract");
    expect(prompt).toContain("# Conversation Reflex");
    expect(prompt).toContain("You are Reka");
    expect(prompt).toContain("never call yourself Mereka");
    expect(prompt).toContain("Oriental Building is the physical building and Mereka's future location");
    expect(prompt).toContain("Never call the organisation or team Oriental");
    expect(prompt).toContain("Never use the phrase 'quick one'");
    expect(prompt).toContain("capture_fields");
    expect(prompt).not.toMatch(/\bcapture_field\b/);
    expect(prompt).toContain("lookup_oriental");
    expect(prompt).toContain("call route_to_team immediately");
    expect(prompt).toContain("or I can send it now");
    expect(prompt).toContain("Do not wait for optional fields");
    expect(prompt).toContain("call end_call");
    expect(prompt).toContain("A valid email is the only hard blocker");
    expect(prompt).not.toContain("# Website Knowledge Base");
    expect(prompt).not.toContain("Type A: 250–300 sq ft");
    expect(prompt.length).toBeLessThan(7_000);
    expect(prompt).toContain("tenancy: Tenancy -> Chewi, Tenancy Lead");
  });

  it("keeps the dialed-back register and drops the heavy-Manglish anchors", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("never caricatured");
    expect(prompt).not.toContain("Hi hi");
    expect(prompt).not.toContain("Aiyo");
    expect(prompt).not.toContain("Settle lah");
    expect(prompt).not.toContain("Manglish is your home register");

    for (const knownVisitor of [false, true]) {
      const opener = openingVoiceInstruction(knownVisitor);
      expect(opener).toContain("never forced or caricatured");
      expect(opener).not.toContain("Hi hi");
      expect(opener).not.toContain("Manglish inflection");
    }
  });

  it("keeps strict rollback copy while adaptive mode removes the blanket checkpoint", () => {
    const strict = buildVoiceInstructions(VOICE_PROFILE);
    const adaptive = buildVoiceInstructions(VOICE_PROFILE, undefined, undefined, "adaptive");

    expect(strict).toContain("read it back and use confirm_email");
    expect(adaptive).toContain("without asking for a separate yes");
    expect(adaptive).toContain("ask the visitor to type it there");
    expect(adaptive).not.toContain("read it back and use confirm_email");
  });

  it("keeps the Realtime tool surface narrow and explicit", () => {
    expect(VOICE_TOOLS.map((tool) => tool.name)).toEqual([
      "set_partner_type",
      "capture_fields",
      "lookup_oriental",
      "confirm_email",
      "clear_field",
      "clear_fields",
      "summarise_lead",
      "route_to_team",
      "wait_for_user",
      "end_call",
    ]);
  });
});
