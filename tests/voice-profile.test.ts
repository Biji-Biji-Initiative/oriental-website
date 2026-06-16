import { describe, expect, it } from "vitest";
import { buildVoiceInstructions, VOICE_PROFILE, VOICE_TOOLS } from "@/lib/voice/profile";

describe("voice profile", () => {
  it("builds an editable prompt from structured profile fields", () => {
    const prompt = buildVoiceInstructions(VOICE_PROFILE);
    expect(prompt).toContain("# Role and Objective");
    expect(prompt).toContain("# Tools");
    expect(prompt).toContain("# Unclear Audio");
    expect(prompt).toContain("# Sample Phrases");
    expect(prompt).toContain("Accent target: contemporary Malaysian English from Kuala Lumpur");
    expect(prompt).toContain("You are Reka");
    expect(prompt).toContain("Do not call yourself Mereka");
    expect(prompt).toContain("Do not say 'I'll capture that cleanly'");
    expect(prompt).toContain("You can update the visible handoff panel by calling capture_field");
    expect(prompt).toContain("Treat non-empty typed fields there as user-provided details");
    expect(prompt).toContain("call route_to_team immediately");
    expect(prompt).toContain("call end_call");
    expect(prompt).toContain("not grounded");
    expect(prompt).toContain("A valid email is the only required field");
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
      "end_call",
    ]);
  });
});
