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
