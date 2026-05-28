import { describe, expect, it } from "vitest";
import { buildVoiceInstructions, VOICE_PROFILE, VOICE_TOOLS } from "@/lib/voice/profile";

describe("voice profile", () => {
  it("builds an editable prompt from structured profile fields", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("# Role and Objective");
    expect(prompt).toContain("# Tools");
    expect(prompt).toContain("# Unclear Audio");
    expect(prompt).toContain("# Sample Phrases");
    expect(prompt).toContain("distinctive KL ecosystem host");
    expect(prompt).toContain("not grounded");
    expect(prompt).toContain("Required fields are name, email, organisation, and a short brief.");
    expect(prompt).toContain("Never invent prices.");
    expect(prompt).toContain("tenancy: Tenancy -> Chewi, Tenancy Lead");
  });

  it("keeps the Realtime tool surface narrow and explicit", () => {
    expect(VOICE_TOOLS.map((tool) => tool.name)).toEqual([
      "set_partner_type",
      "capture_field",
      "clear_field",
      "summarise_lead",
      "route_to_team",
      "wait_for_user",
    ]);
  });
});
