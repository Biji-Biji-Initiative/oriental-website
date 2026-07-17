import type { CapturedLead } from "@/lib/voice/realtime-events";

export const VOICE_ENTRY_POINTS = [
  "hero_primary",
  "hero_updates",
  "hero_updates_followup",
  "nav_desktop",
  "nav_mobile",
  "keyboard_shortcut",
  "voice_rail",
  "ecosystem",
  "facilities",
  "partners",
  "closing_cta",
  "footer_cta",
  "faq_cta",
  "unknown",
] as const;

export type VoiceEntryPoint = (typeof VOICE_ENTRY_POINTS)[number];
export const VOICE_ENTRY_METHODS = ["voice_button", "form", "email_capture", "unknown"] as const;
export type VoiceEntryMethod = (typeof VOICE_ENTRY_METHODS)[number];

export const SUBMISSION_METHODS = ["handoff_button", "voice_command", "email_capture_button"] as const;
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];
export type FieldInputMethod = "voice" | "form" | "chat" | "prefill";
export type FieldCompletionMethod = FieldInputMethod | "mixed" | "unknown";
export type FieldChangeKind = "atomic" | "continuous";

export const CAPTURED_LEAD_KEYS = [
  "name",
  "email",
  "org",
  "phone",
  "website",
  "message",
] as const satisfies readonly (keyof CapturedLead)[];

export type FieldProvenanceEntry = {
  firstInput?: FieldInputMethod;
  lastInput?: FieldInputMethod;
  inputs: FieldInputMethod[];
  editCount: number;
  correctionCount: number;
  clearCount: number;
};

export type FieldProvenance = Record<keyof CapturedLead, FieldProvenanceEntry>;

export type FieldProvenanceSummary = Record<
  keyof CapturedLead,
  {
    method: FieldCompletionMethod;
    lastInput?: FieldInputMethod;
    editCount: number;
    correctionCount: number;
    clearCount: number;
  }
>;

export function emptyFieldProvenance(): FieldProvenance {
  const entry = (): FieldProvenanceEntry => ({
    inputs: [],
    editCount: 0,
    correctionCount: 0,
    clearCount: 0,
  });
  return {
    name: entry(),
    email: entry(),
    org: entry(),
    phone: entry(),
    website: entry(),
    message: entry(),
  };
}

export function provenanceForInitialCaptured(
  captured: CapturedLead,
  input: FieldInputMethod = "prefill",
): FieldProvenance {
  return recordCapturedChanges(emptyCapturedLeadForAttribution(), captured, emptyFieldProvenance(), input);
}

/**
 * Record only bounded input-source counters. Field values are used for the
 * comparison in memory and never copied into the telemetry object.
 */
export function recordCapturedChanges(
  previous: CapturedLead,
  next: CapturedLead,
  current: FieldProvenance | undefined,
  input: FieldInputMethod,
  changeKind: FieldChangeKind = "atomic",
): FieldProvenance {
  const provenance = cloneFieldProvenance(current ?? emptyFieldProvenance());
  for (const key of CAPTURED_LEAD_KEYS) {
    if (previous[key] === next[key]) continue;
    const before = previous[key].trim();
    const after = next[key].trim();
    const entry = provenance[key];
    if (!after) {
      entry.clearCount = Math.min(100, entry.clearCount + 1);
      entry.lastInput = input;
      continue;
    }
    const beginsInputSession = entry.lastInput !== input;
    if (!entry.firstInput) entry.firstInput = input;
    entry.lastInput = input;
    if (!entry.inputs.includes(input)) entry.inputs.push(input);
    // A continuous input is an onChange stream, so its keystrokes form one
    // bounded edit session. Atomic captures are committed values from a tool,
    // paste, or other one-shot action: even the same modality can correct its
    // prior value and must be counted as a distinct edit.
    const beginsEdit = changeKind === "atomic" || beginsInputSession || entry.editCount === 0;
    if (beginsEdit) entry.editCount = Math.min(100, entry.editCount + 1);
    if (beginsEdit && before && before !== after) entry.correctionCount = Math.min(100, entry.correctionCount + 1);
  }
  return provenance;
}

export function summarizeFieldProvenance(
  captured: CapturedLead,
  provenance: FieldProvenance | undefined,
): FieldProvenanceSummary {
  const source = provenance ?? emptyFieldProvenance();
  return Object.fromEntries(
    CAPTURED_LEAD_KEYS.map((key) => {
      const entry = source[key];
      const method: FieldCompletionMethod = !captured[key].trim()
        ? "unknown"
        : entry.inputs.length === 1
          ? (entry.inputs[0] ?? "unknown")
          : entry.inputs.length > 1
            ? "mixed"
            : "unknown";
      return [
        key,
        {
          method,
          lastInput: entry.lastInput,
          editCount: entry.editCount,
          correctionCount: entry.correctionCount,
          clearCount: entry.clearCount,
        },
      ];
    }),
  ) as FieldProvenanceSummary;
}

export function fieldProvenanceCounts(summary: FieldProvenanceSummary) {
  return Object.values(summary).reduce(
    (counts, field) => {
      if (field.method !== "unknown") counts.completed += 1;
      if (field.method === "voice") counts.voice += 1;
      if (field.method === "form" || field.method === "chat") counts.manual += 1;
      if (field.method === "mixed") counts.mixed += 1;
      if (field.correctionCount > 0) counts.corrected += 1;
      return counts;
    },
    { completed: 0, voice: 0, manual: 0, mixed: 0, corrected: 0 },
  );
}

function cloneFieldProvenance(current: FieldProvenance): FieldProvenance {
  return Object.fromEntries(
    CAPTURED_LEAD_KEYS.map((key) => [key, { ...current[key], inputs: [...current[key].inputs] }]),
  ) as FieldProvenance;
}

function emptyCapturedLeadForAttribution(): CapturedLead {
  return { name: "", email: "", org: "", phone: "", website: "", message: "" };
}
