import { describe, expect, it } from "vitest";
import { activeVoiceExperimentDimensions, resolveVoiceExperimentConfig } from "@/lib/voice/experiments";

describe("voice experiment cells", () => {
  it("defaults to the measured control cell", () => {
    expect(
      resolveVoiceExperimentConfig({
        controlModel: "gpt-realtime-2",
        candidateModel: "gpt-realtime-2.1",
      }),
    ).toEqual({
      model: "gpt-realtime-2",
      modelCell: "control",
      reasoningCell: "low",
      reasoningEffort: "low",
    });
  });

  it("selects model and reasoning independently from VAD and voice", () => {
    expect(
      resolveVoiceExperimentConfig({
        modelCell: "'candidate'",
        controlModel: "gpt-realtime-2",
        candidateModel: "gpt-realtime-2.1",
        reasoningCell: "minimal",
      }),
    ).toEqual({
      model: "gpt-realtime-2.1",
      modelCell: "candidate",
      reasoningCell: "minimal",
      reasoningEffort: "minimal",
    });
  });

  it("falls back safely for unknown cell labels", () => {
    const config = resolveVoiceExperimentConfig({
      modelCell: "global-latest",
      controlModel: "gpt-realtime-2",
      candidateModel: "gpt-realtime-2.1",
      reasoningCell: "high",
    });
    expect(config.modelCell).toBe("control");
    expect(config.reasoningCell).toBe("low");
  });

  it("identifies every active non-control experiment dimension", () => {
    expect(
      activeVoiceExperimentDimensions({
        runtimeProfile: "instant-v1",
        modelCell: "candidate",
        reasoningCell: "minimal",
      }),
    ).toEqual(["runtime", "model", "reasoning"]);
    expect(
      activeVoiceExperimentDimensions({
        runtimeProfile: "baseline",
        modelCell: "control",
        reasoningCell: "low",
      }),
    ).toEqual([]);
  });
});
