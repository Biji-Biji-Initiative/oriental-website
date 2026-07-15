import { describe, expect, it } from "vitest";
import {
  asksVisitorForEmail,
  inputPolicyForAssistantText,
  resolveVoiceRuntimeProfile,
} from "@/lib/voice/runtime-profile";

describe("voice runtime profiles", () => {
  it("keeps baseline as the safe rollback for unknown configuration", () => {
    expect(resolveVoiceRuntimeProfile(undefined).id).toBe("baseline");
    expect(resolveVoiceRuntimeProfile("not-a-profile").id).toBe("baseline");
    expect(resolveVoiceRuntimeProfile("'instant-v1'").id).toBe("instant-v1");
  });

  it("uses high semantic VAD normally and low VAD for patient capture", () => {
    const profile = resolveVoiceRuntimeProfile("instant-v1");
    expect(profile.defaultInputPolicy).toBe("fast");
    expect(profile.turnDetection.fast).toMatchObject({ type: "semantic_vad", eagerness: "high" });
    expect(profile.turnDetection.patient).toMatchObject({ type: "semantic_vad", eagerness: "low" });
  });

  it("switches to patient capture only for deterministic email requests", () => {
    const profile = resolveVoiceRuntimeProfile("instant-v1");
    expect(inputPolicyForAssistantText("What's the best email address for the handoff?", profile)).toBe("patient");
    expect(inputPolicyForAssistantText("The team will follow up by email.", profile)).toBe("fast");
    expect(asksVisitorForEmail("Could you repeat your email, please?")).toBe(true);
    expect(asksVisitorForEmail("Your email has been captured.")).toBe(false);
  });

  it("never changes VAD policy in the baseline profile", () => {
    const profile = resolveVoiceRuntimeProfile("baseline");
    expect(inputPolicyForAssistantText("Please spell your email address.", profile)).toBe("baseline");
  });
});
