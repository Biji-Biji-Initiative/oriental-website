import { describe, expect, it } from "vitest";
import {
  emptyFieldProvenance,
  fieldProvenanceCounts,
  provenanceForInitialCaptured,
  recordCapturedChanges,
  summarizeFieldProvenance,
} from "@/lib/voice/interaction-attribution";
import { emptyCapturedLead } from "@/lib/voice/realtime-events";

describe("intake interaction attribution", () => {
  it("records prefill, voice, form correction, and mixed completion without values", () => {
    const prefilled = { ...emptyCapturedLead, email: "person@example.com" };
    let provenance = provenanceForInitialCaptured(prefilled);
    const voiceCaptured = { ...prefilled, name: "Asha", message: "A youth programme" };
    provenance = recordCapturedChanges(prefilled, voiceCaptured, provenance, "voice");
    const corrected = { ...voiceCaptured, email: "person+team@example.com" };
    provenance = recordCapturedChanges(voiceCaptured, corrected, provenance, "form");

    const summary = summarizeFieldProvenance(corrected, provenance);
    expect(summary.email).toMatchObject({
      method: "mixed",
      lastInput: "form",
      correctionCount: 1,
    });
    expect(summary.name.method).toBe("voice");
    expect(summary.message.method).toBe("voice");
    expect(JSON.stringify(summary)).not.toContain("example.com");
    expect(fieldProvenanceCounts(summary)).toEqual({
      completed: 3,
      voice: 2,
      manual: 0,
      mixed: 1,
      corrected: 1,
    });
  });

  it("counts a form typing session once rather than once per keystroke", () => {
    let captured = { ...emptyCapturedLead };
    let provenance = emptyFieldProvenance();
    for (const email of ["a", "as", "ash", "asha@example.com"]) {
      const next = { ...captured, email };
      provenance = recordCapturedChanges(captured, next, provenance, "form", "continuous");
      captured = next;
    }

    expect(summarizeFieldProvenance(captured, provenance).email).toMatchObject({
      method: "form",
      editCount: 1,
      correctionCount: 0,
    });
  });

  it("counts same-modality atomic corrections without treating them as keystrokes", () => {
    const initial = { ...emptyCapturedLead, email: "first@example.com" };
    const provenance = recordCapturedChanges(
      initial,
      { ...initial, email: "corrected@example.com" },
      provenanceForInitialCaptured(initial, "voice"),
      "voice",
      "atomic",
    );

    expect(summarizeFieldProvenance({ ...initial, email: "corrected@example.com" }, provenance).email).toMatchObject({
      method: "voice",
      editCount: 2,
      correctionCount: 1,
    });
  });

  it("marks cleared fields without retaining their former value", () => {
    const captured = { ...emptyCapturedLead, org: "Mereka" };
    const provenance = recordCapturedChanges(
      captured,
      { ...captured, org: "" },
      provenanceForInitialCaptured(captured),
      "voice",
    );
    expect(summarizeFieldProvenance({ ...captured, org: "" }, provenance).org).toMatchObject({
      method: "unknown",
      lastInput: "voice",
      clearCount: 1,
    });
  });
});
