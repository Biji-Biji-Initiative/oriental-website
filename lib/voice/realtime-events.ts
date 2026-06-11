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

export type VoiceRuntimeError = { eventId?: string; message: string; code?: string };

export type VoiceRuntimeState = {
  segment: SegmentId;
  captured: CapturedLead;
  transcript: VoiceTranscriptEntry[];
  handledCallIds?: string[];
  routeRequested?: boolean;
  usage?: VoiceRuntimeUsage;
  rateLimits?: Array<Record<string, unknown>>;
  errors?: VoiceRuntimeError[];
  pendingUserTranscripts?: number;
  activeResponse?: boolean;
  /** Streaming caption of what the assistant is saying right now. */
  assistantDraft?: string;
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

const BENIGN_VOICE_ERROR_CODES = new Set([
  "response_cancel_not_active",
  "conversation_already_has_active_response",
  "input_audio_buffer_commit_empty",
]);

export function isBenignVoiceError(error: VoiceRuntimeError) {
  if (error.code && BENIGN_VOICE_ERROR_CODES.has(error.code)) return true;
  const message = error.message.toLowerCase();
  return message.includes("cancellation failed") || message.includes("no active response");
}

/** Record a message the visitor typed into the live chat as a user transcript turn. */
export function appendTypedUserMessage(state: VoiceRuntimeState, text: string): VoiceRuntimeState {
  return appendTranscript(state, "user", text);
}

export function reduceRealtimeServerEvent(
  event: RealtimeServerEvent,
  current: VoiceRuntimeState,
): { state: VoiceRuntimeState; commands: RealtimeClientCommand[] } {
  const commands: RealtimeClientCommand[] = [];
  let state = current;
  const eventTranscript = asString(event.transcript);

  if (event.type === "response.output_audio_transcript.delta") {
    const delta = asString(event.delta);
    if (delta) state = { ...state, assistantDraft: (state.assistantDraft ?? "") + delta };
  }

  const transcriptText = eventTranscript ?? getOutputText(event.item);
  if (event.type === "response.output_audio_transcript.done" && transcriptText) {
    state = appendTranscript(state, "assistant", transcriptText);
    state = { ...state, assistantDraft: "" };
  }

  if (event.type === "input_audio_buffer.committed") {
    state = { ...state, pendingUserTranscripts: (state.pendingUserTranscripts ?? 0) + 1 };
  }

  if (
    event.type === "conversation.item.input_audio_transcription.completed" ||
    event.type === "conversation.item.input_audio_transcription.failed"
  ) {
    state = { ...state, pendingUserTranscripts: Math.max(0, (state.pendingUserTranscripts ?? 0) - 1) };
  }

  if (event.type === "conversation.item.input_audio_transcription.completed" && eventTranscript) {
    state = appendTranscript(state, "user", eventTranscript);
    state = accumulateUsage(state, "transcription", event.usage);
  }

  if (event.type === "response.created") {
    state = { ...state, activeResponse: true };
  }

  if (event.type === "response.done") {
    state = accumulateUsage(state, "response", event.response?.usage);
    // Clearing the draft here also drops captions of a cancelled response.
    state = { ...state, activeResponse: false, assistantDraft: "" };
  }

  if (event.type === "rate_limits.updated" && Array.isArray(event.rate_limits)) {
    state = { ...state, rateLimits: event.rate_limits };
  }

  if (event.type === "error") {
    state = {
      ...state,
      errors: [
        ...(state.errors ?? []),
        {
          eventId: asString(event.error?.event_id) ?? asString(event.event_id),
          message: asString(event.error?.message) ?? asString(event.error?.code) ?? "unknown",
          code: asString(event.error?.code),
        },
      ],
    };
  }

  const items = event.type === "response.done" && Array.isArray(event.response?.output) ? event.response.output : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
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
  if (
    typeof item.name !== "string" ||
    typeof item.call_id !== "string" ||
    state.handledCallIds?.includes(item.call_id)
  ) {
    return { state, commands: [] };
  }

  const args = parseArguments(item.arguments);
  let next = { ...state, handledCallIds: [...(state.handledCallIds ?? []), item.call_id] };
  let output: Record<string, unknown> = { ok: true };
  let createResponse = true;
  const commands: RealtimeClientCommand[] = [];

  switch (item.name) {
    case "set_partner_type": {
      const segment = toSegmentId(args.segment);
      output = segment ? { ok: true, segment } : { ok: false, error: "invalid_segment" };
      if (segment) next = { ...next, segment };
      break;
    }
    case "capture_field": {
      const key = toCapturedKey(args.key);
      const value = typeof args.value === "string" ? args.value.trim() : "";
      const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
      const mode = args.mode === "append" ? "append" : "replace";
      if (!key || !value) {
        output = { ok: false, error: "invalid_field" };
        break;
      }

      const normalizedValue = key === "org" ? normalizeOrganisation(value) : value;
      const existing = next.captured[key];
      if (key !== "message" && existing.trim() && normalizeEvidence(existing) === normalizeEvidence(normalizedValue)) {
        output = { ok: true, key, mode: "replace", captured: next.captured };
        break;
      }

      const grounding = validateCaptureGrounding(
        key,
        normalizedValue,
        evidence,
        next.transcript,
        (next.pendingUserTranscripts ?? 0) > 0,
      );
      if (!grounding.ok) {
        output = { ok: false, error: grounding.error, key, value: normalizedValue };
        break;
      }

      const nextValue =
        key === "message" && mode === "append" ? appendBrief(existing, normalizedValue) : normalizedValue;
      next = { ...next, captured: { ...next.captured, [key]: nextValue } };
      output = { ok: true, key, mode, captured: next.captured };
      break;
    }
    case "clear_field": {
      const key = toCapturedKey(args.key);
      if (key) {
        next = { ...next, captured: { ...next.captured, [key]: "" } };
        output = { ok: true, key, captured: next.captured };
      } else {
        output = { ok: false, error: "invalid_field" };
      }
      break;
    }
    case "summarise_lead": {
      const missingFields = getMissingFields(next.captured);
      output = {
        ok: true,
        segment: next.segment,
        captured: next.captured,
        ready: missingFields.length === 0,
        missingFields,
        missingFieldLabels: getMissingFieldLabels(missingFields),
        routeRequested: next.routeRequested ?? false,
      };
      break;
    }
    case "route_to_team": {
      const segment = toSegmentId(args.segment);
      if (!segment) {
        output = { ok: false, error: "invalid_segment" };
        break;
      }

      next = { ...next, segment };
      const missingFields = getMissingFields(next.captured);
      if (missingFields.length > 0) {
        output = {
          ok: false,
          ready: false,
          segment: next.segment,
          missingFields,
          missingFieldLabels: getMissingFieldLabels(missingFields),
          captured: next.captured,
        };
      } else if (next.routeRequested) {
        output = { ok: false, error: "route_already_requested", segment: next.segment };
      } else {
        next = { ...next, routeRequested: true };
        commands.push({ type: "submit_voice", callId: item.call_id, segment: next.segment });
        return { state: next, commands };
      }
      break;
    }
    case "wait_for_user": {
      output = { ok: true, waited: true };
      createResponse = false;
      break;
    }
    case "end_call": {
      const reason = args.reason === "user_cancelled" ? "user_cancelled" : "user_done";
      output = { ok: true, ended: true, reason };
      createResponse = false;
      commands.push({ type: "end_voice", reason });
      break;
    }
    default: {
      output = { ok: false, error: "unknown_tool" };
      break;
    }
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getOutputText(item: RealtimeOutputItem | undefined) {
  const content = Array.isArray(item?.content) ? item.content : [];
  return content
    .map((part) => asString(part?.transcript) ?? asString(part?.text) ?? "")
    .filter((text) => text.length > 0)
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

/**
 * How much ASR spelling drift grounding tolerates per key, as a fraction of
 * the evidence length. The realtime model hears audio directly while the
 * transcript comes from a separate ASR pass, so proper nouns routinely
 * diverge ("Khazanah" vs "Cazana"). Email stays strictest because a wrong
 * email breaks the follow-up; organisation is most forgiving because the
 * handoff panel shows it and the visitor can edit it.
 */
const GROUNDING_TOLERANCE: Record<Exclude<keyof CapturedLead, "message">, number> = {
  email: 0.13,
  name: 0.25,
  org: 0.34,
};

function validateCaptureGrounding(
  key: keyof CapturedLead,
  value: string,
  evidence: string,
  transcript: VoiceTranscriptEntry[],
  transcriptionPending: boolean,
): { ok: true } | { ok: false; error: string } {
  if (key === "message") return { ok: true };
  if (!evidence) return { ok: false, error: "ungrounded_identity_capture" };
  const tolerance = GROUNDING_TOLERANCE[key];

  const recentUserText = transcript
    .filter((entry) => entry.role === "user")
    .slice(-6)
    .map((entry) => entry.text)
    .join(" ");
  const normalizedUserText = normalizeEvidence(recentUserText);
  const normalizedEvidence = normalizeEvidence(evidence);
  if (normalizedEvidence.length < 2) {
    return { ok: false, error: "ungrounded_identity_capture" };
  }

  // Whisper transcription can land after the model's function call; while a user
  // turn is still transcribing, trust evidence that is consistent with the value.
  const evidenceGrounded = approxIncludes(normalizedUserText, normalizedEvidence, tolerance);
  if (!evidenceGrounded && !transcriptionPending) {
    return { ok: false, error: "ungrounded_identity_capture" };
  }

  if (key === "org" && normalizeEvidence(value) === "individual") {
    // "Individual" is our label for "no organisation"; the user never says the word itself.
    return { ok: true };
  }

  const valueForms = normalizedValueForms(key, value);
  if (!evidenceGrounded) {
    return valueForms.some((form) => approxIncludes(normalizedEvidence, form, tolerance))
      ? { ok: true }
      : { ok: false, error: "ungrounded_identity_capture" };
  }

  if (
    valueForms.some(
      (form) =>
        approxIncludes(normalizedEvidence, form, tolerance) || approxIncludes(normalizedUserText, form, tolerance),
    )
  ) {
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

/** Exact containment, falling back to tolerance-bounded approximate containment. */
function approxIncludes(haystack: string, needle: string, tolerance: number) {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  // Below 4 characters a single edit can turn one word into another; stay exact.
  if (needle.length < 4) return false;
  const maxEdits = Math.max(1, Math.floor(needle.length * tolerance));
  return approxSubstringDistance(haystack, needle) <= maxEdits;
}

/**
 * Smallest edit distance between `needle` and any substring of `haystack`
 * (semi-global alignment: skipped haystack prefix/suffix is free).
 */
function approxSubstringDistance(haystack: string, needle: string): number {
  if (!needle.length) return 0;
  if (!haystack.length) return needle.length;
  let previous: number[] = new Array(haystack.length + 1).fill(0);
  let current: number[] = new Array(haystack.length + 1).fill(0);
  for (let i = 1; i <= needle.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= haystack.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (needle[i - 1] === haystack[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous.reduce((min, cell) => Math.min(min, cell), needle.length);
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
    .some((entry) => approxIncludes(normalizeEvidence(entry.text), form, GROUNDING_TOLERANCE.org));
}

function normalizeEvidence(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function getMissingFields(captured: CapturedLead) {
  return (Object.keys(capturedFieldLabels) as Array<keyof CapturedLead>).filter((key) => !captured[key].trim());
}

const capturedFieldLabels: Record<keyof CapturedLead, string> = {
  name: "name",
  email: "email",
  org: "organisation",
  message: "brief",
};

function getMissingFieldLabels(fields: Array<keyof CapturedLead>) {
  return fields.map((field) => capturedFieldLabels[field]);
}
