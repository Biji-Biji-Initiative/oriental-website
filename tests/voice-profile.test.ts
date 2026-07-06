import { describe, expect, it } from "vitest";
import { openingVoiceInstruction } from "@/components/voice-agent/voice-dialog-copy";
import { buildVoiceInstructions, VOICE_PROFILE, VOICE_TOOLS } from "@/lib/voice/profile";

describe("voice profile", () => {
  it("builds an editable prompt from structured profile fields", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("# Role and Objective");
    expect(prompt).toContain("# Tools");
    expect(prompt).toContain("# Unclear Audio");
    expect(prompt).toContain("# Sample Phrases");
    expect(prompt).toContain("Accent target: natural Malaysian English from Kuala Lumpur");
    expect(prompt).toContain("You are Reka");
    expect(prompt).toContain("Do not call yourself Mereka");
    expect(prompt).toContain("Do not say 'I'll capture that cleanly'");
    expect(prompt).toContain("You can update the visible handoff panel by calling capture_field");
    expect(prompt).toContain("Treat non-empty typed fields there as user-provided details");
    expect(prompt).toContain("call route_to_team immediately");
    expect(prompt).toContain("one compact quality pass");
    expect(prompt).toContain("or I can send it now");
    expect(prompt).toContain("Never do this quality pass more than once");
    expect(prompt).toContain("do not wait for optional fields");
    expect(prompt).toContain("call end_call");
    expect(prompt).toContain("not grounded");
    expect(prompt).toContain("A valid email is the only hard blocker");
    expect(prompt).toContain("# Website Knowledge Base");
    expect(prompt).toContain("Academy of Tomorrow learning studios");
    expect(prompt).toContain("Academy of Tomorrow Learning Studios");
    expect(prompt).toContain("Technology Showcase & Demo Spaces");
    expect(prompt).toContain("Mission-Aligned Tenants");
    expect(prompt).toContain("Education & Programme Partners");
    expect(prompt).toContain("Technology & Innovation Partners");
    expect(prompt).toContain("Community & Cultural Partners");
    expect(prompt).toContain("Technology Showcase & Demo Lab");
    expect(prompt).toContain("Type A: 250–300 sq ft");
    expect(prompt).toContain("Furniture or workstations");
    expect(prompt).toContain("A 2-month deposit is required");
    expect(prompt).toContain("Full floor: ~2,800–3,000 sq ft");
    expect(prompt).toContain("Public Programme & Event Spaces");
    expect(prompt).toContain("Launch Public Partner Interest Call: June – July 2026");
    expect(prompt).toContain("Never invent prices.");
    expect(prompt).toContain("tenancy: Tenancy -> Chewi, Tenancy Lead");
  });

  it("keeps the dialed-back register and drops the heavy-Manglish anchors", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("never a caricature or forced accent");
    expect(prompt).toContain("optional seasoning");
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

  it("keeps the Realtime tool surface narrow and explicit", () => {
    expect(VOICE_TOOLS.map((tool) => tool.name)).toEqual([
      "set_partner_type",
      "capture_field",
      "clear_field",
      "summarise_lead",
      "route_to_team",
      "wait_for_user",
      "end_call",
    ]);
  });
});
