export const VOICE_MODEL_CELLS = ["control", "candidate"] as const;
export const VOICE_REASONING_CELLS = ["low", "minimal"] as const;

export type VoiceModelCell = (typeof VOICE_MODEL_CELLS)[number];
export type VoiceReasoningCell = (typeof VOICE_REASONING_CELLS)[number];

export type VoiceExperimentConfig = {
  model: string;
  modelCell: VoiceModelCell;
  reasoningCell: VoiceReasoningCell;
  reasoningEffort: VoiceReasoningCell;
};

export type VoiceExperimentDimension = "runtime" | "model" | "reasoning";

export function activeVoiceExperimentDimensions(input: {
  runtimeProfile?: string | null;
  modelCell?: string | null;
  reasoningCell?: string | null;
}): VoiceExperimentDimension[] {
  const dimensions: VoiceExperimentDimension[] = [];
  if (unquote(input.runtimeProfile) === "instant-v1") dimensions.push("runtime");
  if (unquote(input.modelCell) === "candidate") dimensions.push("model");
  if (unquote(input.reasoningCell) === "minimal") dimensions.push("reasoning");
  return dimensions;
}

export function resolveVoiceExperimentConfig(input: {
  modelCell?: string | null;
  controlModel: string;
  candidateModel: string;
  reasoningCell?: string | null;
}): VoiceExperimentConfig {
  const requestedModelCell = unquote(input.modelCell);
  const modelCell: VoiceModelCell = requestedModelCell === "candidate" ? "candidate" : "control";
  const requestedReasoning = unquote(input.reasoningCell);
  const reasoningCell: VoiceReasoningCell = requestedReasoning === "minimal" ? "minimal" : "low";
  return {
    model: modelCell === "candidate" ? input.candidateModel : input.controlModel,
    modelCell,
    reasoningCell,
    reasoningEffort: reasoningCell,
  };
}

function unquote(value: string | null | undefined) {
  return value?.trim().replace(/^['"\\]+|['"\\]+$/g, "");
}
