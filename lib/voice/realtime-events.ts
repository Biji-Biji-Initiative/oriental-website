import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";

export type CapturedLead = {
  name: string;
  email: string;
  org: string;
  message: string;
};

export type VoiceTranscriptEntry = {
  role: "assistant" | "user";
  text: string;
};

export type VoiceRuntimeUsage = {
  responseCount: number;
  responseTokens: number;
  responseInputTokens: number;
  responseOutputTokens: number;
  responseCachedTokens: number;
  transcriptionCount: number;
  transcriptionTokens: number;
  transcriptionInputTokens: number;
  transcriptionOutputTokens: number;
};

export type VoiceRuntimeState = {
  segment: SegmentId;
  captured: CapturedLead;
  transcript: VoiceTranscriptEntry[];
  handledCallIds?: string[];
  routeRequested?: boolean;
  usage?: VoiceRuntimeUsage;
  rateLimits?: Array<Record<string, unknown>>;
  errors?: Array<{ eventId?: string; message: string }>;
};

export type RealtimeClientCommand =
  | {
      type: "function_result";
      callId: string;
      createResponse: boolean;
      output: Record<string, unknown>;
    }
  | { type: "submit_voice"; callId: string; segment: SegmentId }
  | { type: "end_voice"; reason: "user_done" | "user_cancelled" };

type RealtimeContentPart = {
  type?: string;
  text?: string;
  transcript?: string;
};

type RealtimeOutputItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: RealtimeContentPart[];
};

type RealtimeUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    cached_tokens?: number;
  };
};

export type RealtimeServerEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  event_id?: string;
  error?: { message?: string; code?: string; event_id?: string };
  rate_limits?: Array<Record<string, unknown>>;
  usage?: RealtimeUsage;
  item?: RealtimeOutputItem;
  response?: { output?: RealtimeOutputItem[]; usage?: RealtimeUsage };
};

export const emptyCapturedLead: CapturedLead = { name: "", email: "", org: "", message: "" };

export const emptyVoiceUsage: VoiceRuntimeUsage = {
  responseCount: 0,
  responseTokens: 0,
  responseInputTokens: 0,
  responseOutputTokens: 0,
  responseCachedTokens: 0,
  transcriptionCount: 0,
  transcriptionTokens: 0,
  transcriptionInputTokens: 0,
  transcriptionOutputTokens: 0,
};

export function reduceRealtimeServerEvent(
  event: RealtimeServerEvent,
  current: VoiceRuntimeState,
): { state: VoiceRuntimeState; commands: RealtimeClientCommand[] } {
  const commands: RealtimeClientCommand[] = [];
  let state = current;

  const transcriptText = event.transcript ?? getOutputText(event.item);
  if (event.type === "response.output_audio_transcript.done" && transcriptText) {
    state = appendTranscript(state, "assistant", transcriptText);
  }

  if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
    state = appendTranscript(state, "user", event.transcript);
    state = accumulateUsage(state, "transcription", event.usage);
  }

  if (event.type === "response.done") {
    state = accumulateUsage(state, "response", event.response?.usage);
  }

  if (event.type === "rate_limits.updated" && event.rate_limits) {
    state = { ...state, rateLimits: event.rate_limits };
  }

  if (event.type === "error") {
    state = {
      ...state,
      errors: [
        ...(state.errors ?? []),
        {
          eventId: event.error?.event_id ?? event.event_id,
          message: event.error?.message ?? event.error?.code ?? "unknown",
        },
      ],
    };
  }

  const items = event.type === "response.done" ? (event.response?.output ?? []) : [];
  for (const item of items) {
    const text = getOutputText(item);
    if (text) state = appendTranscript(state, "assistant", text);
    if (item.type === "function_call") {
      const reduced = applyFunctionCall(item, state);
      state = reduced.state;
      commands.push(...reduced.commands);
    }
  }

  return { state, commands };
}

function applyFunctionCall(
  item: RealtimeOutputItem,
  state: VoiceRuntimeState,
): { state: VoiceRuntimeState; commands: RealtimeClientCommand[] } {
  if (!item.name || !item.call_id || state.handledCallIds?.includes(item.call_id)) {
    return { state, commands: [] };
  }

  const args = parseArguments(item.arguments);
  let next = { ...state, handledCallIds: [...(state.handledCallIds ?? []), item.call_id] };
  let output: Record<string, unknown> = { ok: true };
  let createResponse = true;
  const commands: RealtimeClientCommand[] = [];

  if (item.name === "set_partner_type") {
    const segment = toSegmentId(args.segment);
    if (segment) {
      next = { ...next, segment };
      output = { ok: true, segment };
    } else {
      output = { ok: false, error: "invalid_segment" };
    }
  }

  if (item.name === "capture_field") {
    const key = toCapturedKey(args.key);
    const value = typeof args.value === "string" ? args.value.trim() : "";
    const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
    const mode = args.mode === "append" ? "append" : "replace";
    if (key && value) {
      const normalizedValue = key === "org" ? normalizeOrganisation(value) : value;
      const grounding = validateCaptureGrounding(key, normalizedValue, evidence, next.transcript);
      if (!grounding.ok) {
        output = { ok: false, error: grounding.error, key, value: normalizedValue };
      } else {
        const existing = next.captured[key];
        const nextValue =
          key === "message" && mode === "append" ? appendBrief(existing, normalizedValue) : normalizedValue;
        next = { ...next, captured: { ...next.captured, [key]: nextValue } };
        output = { ok: true, key, mode, captured: next.captured };
      }
    } else {
      output = { ok: false, error: "invalid_field" };
    }
  }

  if (item.name === "clear_field") {
    const key = toCapturedKey(args.key);
    if (key) {
      next = { ...next, captured: { ...next.captured, [key]: "" } };
      output = { ok: true, key, captured: next.captured };
    } else {
      output = { ok: false, error: "invalid_field" };
    }
  }

  if (item.name === "summarise_lead") {
    output = { ok: true, segment: next.segment, captured: next.captured };
  }

  if (item.name === "route_to_team") {
    const segment = toSegmentId(args.segment);
    if (!segment) {
      output = { ok: false, error: "invalid_segment" };
    } else {
      next = { ...next, segment };
      const missingFields = getMissingFields(next.captured);
      if (missingFields.length > 0) {
        output = { ok: false, ready: false, segment: next.segment, missingFields };
      } else if (next.routeRequested) {
        output = { ok: false, error: "route_already_requested", segment: next.segment };
      } else {
        next = { ...next, routeRequested: true };
        commands.push({ type: "submit_voice", callId: item.call_id, segment: next.segment });
        return { state: next, commands };
      }
    }
  }

  if (item.name === "wait_for_user") {
    output = { ok: true, waited: true };
    createResponse = false;
  }

  if (item.name === "end_call") {
    const reason = args.reason === "user_cancelled" ? "user_cancelled" : "user_done";
    output = { ok: true, ended: true, reason };
    createResponse = false;
    commands.push({ type: "end_voice", reason });
  }

  if (
    ![
      "set_partner_type",
      "capture_field",
      "clear_field",
      "summarise_lead",
      "route_to_team",
      "wait_for_user",
      "end_call",
    ].includes(item.name)
  ) {
    output = { ok: false, error: "unknown_tool" };
  }

  return {
    state: next,
    commands: [{ type: "function_result", callId: item.call_id, createResponse, output }, ...commands],
  };
}

function appendTranscript(
  state: VoiceRuntimeState,
  role: VoiceTranscriptEntry["role"],
  text: string,
): VoiceRuntimeState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const previous = state.transcript.at(-1);
  if (previous?.role === role && previous.text === trimmed) return state;
  return { ...state, transcript: [...state.transcript, { role, text: trimmed }] };
}

function accumulateUsage(
  state: VoiceRuntimeState,
  kind: "response" | "transcription",
  usage: RealtimeUsage | undefined,
): VoiceRuntimeState {
  if (!usage) return state;
  const current = state.usage ?? emptyVoiceUsage;
  if (kind === "response") {
    return {
      ...state,
      usage: {
        ...current,
        responseCount: current.responseCount + 1,
        responseTokens: current.responseTokens + numberValue(usage.total_tokens),
        responseInputTokens: current.responseInputTokens + numberValue(usage.input_tokens),
        responseOutputTokens: current.responseOutputTokens + numberValue(usage.output_tokens),
        responseCachedTokens: current.responseCachedTokens + numberValue(usage.input_token_details?.cached_tokens),
      },
    };
  }

  return {
    ...state,
    usage: {
      ...current,
      transcriptionCount: current.transcriptionCount + 1,
      transcriptionTokens: current.transcriptionTokens + numberValue(usage.total_tokens),
      transcriptionInputTokens: current.transcriptionInputTokens + numberValue(usage.input_tokens),
      transcriptionOutputTokens: current.transcriptionOutputTokens + numberValue(usage.output_tokens),
    },
  };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getOutputText(item: RealtimeOutputItem | undefined) {
  return (item?.content ?? [])
    .map((part) => part.transcript ?? part.text)
    .filter((text): text is string => Boolean(text))
    .join("");
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function toSegmentId(value: unknown): SegmentId | null {
  return typeof value === "string" && SEGMENT_IDS.includes(value as SegmentId) ? (value as SegmentId) : null;
}

function toCapturedKey(value: unknown): keyof CapturedLead | null {
  return value === "name" || value === "email" || value === "org" || value === "message" ? value : null;
}

function validateCaptureGrounding(
  key: keyof CapturedLead,
  value: string,
  evidence: string,
  transcript: VoiceTranscriptEntry[],
): { ok: true } | { ok: false; error: string } {
  if (key === "message") return { ok: true };
  if (!evidence) return { ok: false, error: "ungrounded_identity_capture" };

  const recentUserText = transcript
    .filter((entry) => entry.role === "user")
    .slice(-6)
    .map((entry) => entry.text)
    .join(" ");
  const normalizedUserText = normalizeEvidence(recentUserText);
  const normalizedEvidence = normalizeEvidence(evidence);

  if (normalizedEvidence.length < 2 || !normalizedUserText.includes(normalizedEvidence)) {
    return { ok: false, error: "ungrounded_identity_capture" };
  }

  const valueForms = normalizedValueForms(key, value);
  if (valueForms.some((form) => normalizedEvidence.includes(form) || normalizedUserText.includes(form))) {
    return { ok: true };
  }

  if (
    key === "org" &&
    userAskedAssistantToWriteIt(transcript) &&
    valueForms.some((form) => hasRecentOrganisationEvidence(form, transcript))
  ) {
    return { ok: true };
  }

  return { ok: false, error: "ungrounded_identity_capture" };
}

function normalizedValueForms(key: keyof CapturedLead, value: string) {
  const forms = [normalizeEvidence(value)];
  if (key === "email") forms.push(normalizeEvidence(spokenEmailForm(value)));
  if (key === "org" && normalizeEvidence(value) === "mereka") {
    forms.push("moreika", "merika", "merekaah", "merekaa");
  }
  return forms.filter((form) => form.length >= 2);
}

function spokenEmailForm(value: string) {
  return value
    .toLowerCase()
    .replaceAll("@", " at ")
    .replaceAll(".", " dot ")
    .replaceAll("-", " dash ")
    .replaceAll("_", " underscore ")
    .replaceAll("+", " plus ");
}

function appendBrief(existing: string, addition: string) {
  const current = existing.trim();
  const next = addition.trim();
  if (!current) return next;
  if (!next) return current;
  if (normalizeEvidence(current).includes(normalizeEvidence(next))) return current;
  return `${current}\n\n${next}`;
}

function normalizeOrganisation(value: string) {
  const normalized = normalizeEvidence(value);
  if (["mereka", "moreika", "merika", "merekaah", "merekaa"].includes(normalized)) return "Mereka";
  return value.trim();
}

function userAskedAssistantToWriteIt(transcript: VoiceTranscriptEntry[]) {
  return transcript
    .filter((entry) => entry.role === "user")
    .slice(-4)
    .some((entry) => {
      const text = normalizeEvidence(entry.text);
      return (
        text.includes("youwriteitin") ||
        text.includes("youputitin") ||
        text.includes("isikan") ||
        text.includes("tuliskan")
      );
    });
}

function hasRecentOrganisationEvidence(form: string, transcript: VoiceTranscriptEntry[]) {
  return transcript
    .filter((entry) => entry.role === "user")
    .slice(-8)
    .some((entry) => normalizeEvidence(entry.text).includes(form));
}

function normalizeEvidence(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function getMissingFields(captured: CapturedLead) {
  return (["name", "email", "org", "message"] as const).filter((key) => !captured[key]);
}
