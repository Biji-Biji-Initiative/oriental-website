import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";
import { lookupOrientalKnowledge } from "@/lib/voice/knowledge";
import { extractExplicitVisitorEmail } from "@/lib/voice/tentative-extraction";

export type CapturedLead = {
  name: string;
  email: string;
  org: string;
  phone: string;
  website: string;
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

export type VoiceEmailVerification = {
  value: string;
  source: "prefill" | "speech" | "typed";
  status: "confirmed" | "pending";
};

export type VoiceRuntimeState = {
  segment: SegmentId;
  captured: CapturedLead;
  transcript: VoiceTranscriptEntry[];
  handledCallIds?: string[];
  routeRequested?: boolean;
  usage?: VoiceRuntimeUsage;
  rateLimits?: Array<Record<string, unknown>>;
  errors?: VoiceRuntimeError[];
  emailVerification?: VoiceEmailVerification;
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

export function responseHasFunctionCall(event: RealtimeServerEvent): boolean {
  return (
    event.type === "response.done" &&
    Array.isArray(event.response?.output) &&
    event.response.output.some((item) => item?.type === "function_call")
  );
}

export const emptyCapturedLead: CapturedLead = {
  name: "",
  email: "",
  org: "",
  phone: "",
  website: "",
  message: "",
};

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

export function isVoiceCaptureIntegrityIssue(error: VoiceRuntimeError): boolean {
  return error.code === "voice_capture_rejected" || error.code === "voice_email_unconfirmed";
}

/** Record a message the visitor typed into the live chat as a user transcript turn. */
export function appendTypedUserMessage(state: VoiceRuntimeState, text: string): VoiceRuntimeState {
  return applyTentativeEmail(appendTranscript(state, "user", text), text, "typed");
}

export function confirmedEmailVerification(
  value: string,
  source: Extract<VoiceEmailVerification["source"], "prefill" | "typed">,
): VoiceEmailVerification | undefined {
  const email = value.trim();
  return email ? { value: email, source, status: "confirmed" } : undefined;
}

export function isVoiceEmailConfirmed(state: Pick<VoiceRuntimeState, "captured" | "emailVerification">): boolean {
  const email = state.captured.email.trim().toLowerCase();
  const verification = state.emailVerification;
  return Boolean(
    email &&
      verification?.status === "confirmed" &&
      verification.value.trim().toLowerCase() === email &&
      isLikelyEmail(email),
  );
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
    state = applyTentativeEmail(state, eventTranscript, "speech");
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
      ].slice(-20),
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
  let next: VoiceRuntimeState = { ...state, handledCallIds: [...(state.handledCallIds ?? []), item.call_id] };
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
      const capture = applyCaptureField(args, next.captured, next.transcript, (next.pendingUserTranscripts ?? 0) > 0);
      if (!capture.ok) {
        output = capture.output;
        break;
      }
      next = applyCaptureResult(next, capture);
      output = captureOutput(capture, next);
      break;
    }
    case "capture_fields": {
      const fields = Array.isArray(args.fields) ? args.fields : [];
      if (fields.length < 1 || fields.length > 6) {
        output = { ok: false, error: "invalid_field_batch" };
        break;
      }
      const seen = new Set<keyof CapturedLead>();
      let captured = next.captured;
      const applied: Array<{ key: keyof CapturedLead; mode: "append" | "replace" }> = [];
      let failure: { index: number; output: Record<string, unknown> } | null = null;
      for (const [index, field] of fields.entries()) {
        const fieldArgs = field && typeof field === "object" && !Array.isArray(field) ? field : {};
        const key = toCapturedKey((fieldArgs as Record<string, unknown>).key);
        if (key && seen.has(key)) {
          failure = { index, output: { ok: false, error: "duplicate_field", key } };
          break;
        }
        if (key) seen.add(key);
        const capture = applyCaptureField(
          fieldArgs as Record<string, unknown>,
          captured,
          next.transcript,
          (next.pendingUserTranscripts ?? 0) > 0,
        );
        if (!capture.ok) {
          failure = { index, output: capture.output };
          break;
        }
        captured = capture.captured;
        applied.push({ key: capture.key, mode: capture.mode });
      }
      if (failure) {
        output = { ok: false, error: "atomic_capture_rejected", failedIndex: failure.index, detail: failure.output };
        break;
      }
      const emailApplied = applied.some((field) => field.key === "email");
      next = {
        ...next,
        captured,
        ...(emailApplied
          ? { emailVerification: pendingSpokenEmailVerification(captured.email, next.emailVerification) }
          : {}),
      };
      output = {
        ok: true,
        fields: applied,
        captured,
        ...(emailApplied ? { emailConfirmationRequired: !isVoiceEmailConfirmed(next) } : {}),
      };
      break;
    }
    case "confirm_email": {
      const confirmation = confirmCapturedEmail(args, next, (next.pendingUserTranscripts ?? 0) > 0);
      if (!confirmation.ok) {
        output = confirmation.output;
        break;
      }
      next = { ...next, emailVerification: confirmation.verification };
      output = {
        ok: true,
        key: "email",
        confirmed: true,
        captured: next.captured,
        emailVerification: confirmation.verification,
      };
      break;
    }
    case "lookup_oriental": {
      output = lookupOrientalKnowledge(args);
      break;
    }
    case "clear_field": {
      const key = toCapturedKey(args.key);
      if (key) {
        next = {
          ...next,
          captured: { ...next.captured, [key]: "" },
          ...(key === "email" ? { emailVerification: undefined } : {}),
        };
        output = { ok: true, key, captured: next.captured };
      } else {
        output = { ok: false, error: "invalid_field" };
      }
      break;
    }
    case "summarise_lead": {
      const missingFields = getMissingFields(next.captured);
      const invalidFields = getInvalidFields(next.captured);
      const unconfirmedFields = getUnconfirmedFields(next);
      output = {
        ok: true,
        segment: next.segment,
        captured: next.captured,
        ready: missingFields.length === 0 && invalidFields.length === 0 && unconfirmedFields.length === 0,
        missingFields,
        missingFieldLabels: getMissingFieldLabels(missingFields),
        invalidFields,
        invalidFieldLabels: getMissingFieldLabels(invalidFields),
        unconfirmedFields,
        unconfirmedFieldLabels: getMissingFieldLabels(unconfirmedFields),
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
      const invalidFields = getInvalidFields(next.captured);
      const unconfirmedFields = getUnconfirmedFields(next);
      if (missingFields.length > 0 || invalidFields.length > 0 || unconfirmedFields.length > 0) {
        output = {
          ok: false,
          ready: false,
          segment: next.segment,
          error:
            invalidFields.length > 0
              ? "invalid_required_fields"
              : missingFields.length > 0
                ? "missing_required_fields"
                : "unconfirmed_required_fields",
          missingFields,
          missingFieldLabels: getMissingFieldLabels(missingFields),
          invalidFields,
          invalidFieldLabels: getMissingFieldLabels(invalidFields),
          ...(unconfirmedFields.length > 0
            ? {
                unconfirmedFields,
                unconfirmedFieldLabels: getMissingFieldLabels(unconfirmedFields),
              }
            : {}),
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

  next = recordObservableToolFailure(next, item, output);

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
  if (role === "assistant" && previous?.role === "assistant") {
    if (trimmed.startsWith(previous.text)) {
      return { ...state, transcript: [...state.transcript.slice(0, -1), { role, text: trimmed }] };
    }
    if (previous.text.startsWith(trimmed)) return state;
  }
  return { ...state, transcript: [...state.transcript, { role, text: trimmed }] };
}

function applyTentativeEmail(state: VoiceRuntimeState, text: string, source: "speech" | "typed"): VoiceRuntimeState {
  if (state.captured.email.trim()) return state;
  const email = extractExplicitVisitorEmail(text);
  if (!email) return state;
  return {
    ...state,
    captured: { ...state.captured, email },
    emailVerification:
      source === "typed" ? { value: email, source, status: "confirmed" } : { value: email, source, status: "pending" },
  };
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
  return value === "name" ||
    value === "email" ||
    value === "org" ||
    value === "phone" ||
    value === "website" ||
    value === "message"
    ? value
    : null;
}

type AppliedCapture = {
  ok: true;
  key: keyof CapturedLead;
  mode: "append" | "replace";
  captured: CapturedLead;
};

function applyCaptureResult(state: VoiceRuntimeState, capture: AppliedCapture): VoiceRuntimeState {
  if (capture.key !== "email") return { ...state, captured: capture.captured };
  return {
    ...state,
    captured: capture.captured,
    emailVerification: pendingSpokenEmailVerification(capture.captured.email, state.emailVerification),
  };
}

function captureOutput(capture: AppliedCapture, state: VoiceRuntimeState): Record<string, unknown> {
  return {
    ok: true,
    key: capture.key,
    mode: capture.mode,
    captured: capture.captured,
    ...(capture.key === "email" ? { emailConfirmationRequired: !isVoiceEmailConfirmed(state) } : {}),
  };
}

function pendingSpokenEmailVerification(
  email: string,
  existing: VoiceEmailVerification | undefined,
): VoiceEmailVerification {
  if (
    existing?.status === "confirmed" &&
    existing.source !== "speech" &&
    existing.value.trim().toLowerCase() === email.trim().toLowerCase()
  ) {
    return existing;
  }
  return { value: email.trim(), source: "speech", status: "pending" };
}

function applyCaptureField(
  args: Record<string, unknown>,
  captured: CapturedLead,
  transcript: VoiceTranscriptEntry[],
  transcriptionPending: boolean,
): AppliedCapture | { ok: false; output: Record<string, unknown> } {
  const key = toCapturedKey(args.key);
  const value = typeof args.value === "string" ? args.value.trim() : "";
  const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
  const mode = args.mode === "append" ? "append" : "replace";
  if (!key || !value) return { ok: false, output: { ok: false, error: "invalid_field" } };

  const normalizedValue = key === "org" ? normalizeOrganisation(value) : value;
  if (key === "email" && !isLikelyEmail(normalizedValue)) {
    return { ok: false, output: { ok: false, error: "invalid_email", key } };
  }
  const existing = captured[key];
  const duplicateCapture =
    key === "email"
      ? existing.trim().toLowerCase() === normalizedValue.toLowerCase()
      : Boolean(existing.trim()) && normalizeEvidence(existing) === normalizeEvidence(normalizedValue);
  if (!FREE_TEXT_CAPTURE_KEYS.has(key) && duplicateCapture) {
    return { ok: true, key, mode: "replace", captured };
  }

  const grounding = validateCaptureGrounding(key, normalizedValue, evidence, transcript, transcriptionPending);
  if (!grounding.ok) {
    return {
      ok: false,
      output: { ok: false, error: grounding.error, key, value: normalizedValue },
    };
  }

  const nextValue = key === "message" && mode === "append" ? appendBrief(existing, normalizedValue) : normalizedValue;
  return { ok: true, key, mode, captured: { ...captured, [key]: nextValue } };
}

/** Fields the model captures verbatim without identity grounding. */
const FREE_TEXT_CAPTURE_KEYS = new Set<keyof CapturedLead>(["message", "phone", "website"]);

/** Only a reachable email is required to route; everything else is optional. */
const REQUIRED_CAPTURED_FIELDS: Array<keyof CapturedLead> = ["email"];

/**
 * How much ASR spelling drift grounding tolerates per key, as a fraction of
 * the evidence length. The realtime model hears audio directly while the
 * transcript comes from a separate ASR pass, so proper nouns routinely
 * diverge ("Khazanah" vs "Cazana"). Email stays strictest because a wrong
 * email breaks the follow-up; organisation is most forgiving because the
 * handoff panel shows it and the visitor can edit it.
 */
const GROUNDING_TOLERANCE: Record<"name" | "org", number> = {
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
  if (key === "message" || key === "phone" || key === "website") return { ok: true };
  if (!evidence) return { ok: false, error: "ungrounded_identity_capture" };
  if (key === "email") return validateEmailCaptureGrounding(value, evidence, transcript, transcriptionPending);
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

function validateEmailCaptureGrounding(
  value: string,
  evidence: string,
  transcript: VoiceTranscriptEntry[],
  transcriptionPending: boolean,
): { ok: true } | { ok: false; error: string } {
  const email = value.trim().toLowerCase();
  const canonicalEvidence = canonicalizeEmailSpeech(evidence);
  if (!canonicalEvidence.includes(email)) return { ok: false, error: "ungrounded_identity_capture" };
  if (transcriptionPending) return { ok: true };

  const recentUserText = transcript
    .filter((entry) => entry.role === "user")
    .slice(-6)
    .map((entry) => entry.text)
    .join(" ");
  return canonicalizeEmailSpeech(recentUserText).includes(email)
    ? { ok: true }
    : { ok: false, error: "ungrounded_identity_capture" };
}

function canonicalizeEmailSpeech(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/\bat\s+sign\b/gu, " @ ")
    .replace(/\b(at)\b/gu, " @ ")
    .replace(/\b(dot|point)\b/gu, " . ")
    .replace(/\b(underscore)\b/gu, " _ ")
    .replace(/\b(dash|hyphen)\b/gu, " - ")
    .replace(/\b(plus)\b/gu, " + ")
    .replace(/[^\p{Letter}\p{Number}@._+-]+/gu, "");
}

function confirmCapturedEmail(
  args: Record<string, unknown>,
  state: VoiceRuntimeState,
  transcriptionPending: boolean,
): { ok: true; verification: VoiceEmailVerification } | { ok: false; output: Record<string, unknown> } {
  const email = state.captured.email.trim();
  const pending = state.emailVerification;
  if (!email || !pending || pending.status !== "pending" || pending.value.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, output: { ok: false, error: "email_confirmation_not_pending", key: "email" } };
  }

  const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
  if (!isExplicitEmailConfirmation(evidence)) {
    return { ok: false, output: { ok: false, error: "email_confirmation_not_explicit", key: "email" } };
  }
  const latestAssistant = state.transcript.filter((entry) => entry.role === "assistant").at(-1)?.text ?? "";
  if (!canonicalizeEmailSpeech(latestAssistant).includes(email.toLowerCase())) {
    return { ok: false, output: { ok: false, error: "email_readback_missing", key: "email" } };
  }
  const latestUser = state.transcript.filter((entry) => entry.role === "user").at(-1)?.text ?? "";
  if (!transcriptionPending && !normalizeEvidence(latestUser).includes(normalizeEvidence(evidence))) {
    return { ok: false, output: { ok: false, error: "ungrounded_email_confirmation", key: "email" } };
  }
  return { ok: true, verification: { value: email, source: "speech", status: "confirmed" } };
}

const EXPLICIT_EMAIL_CONFIRMATIONS = new Set([
  "yes",
  "yescorrect",
  "yesitscorrect",
  "yesthatscorrect",
  "yesthatsright",
  "yeah",
  "yeahcorrect",
  "yeahsendit",
  "yep",
  "correct",
  "thatscorrect",
  "thatsright",
  "right",
  "betul",
  "yabetul",
  "benar",
  "tepat",
  "okaysendit",
  "yesendit",
  "yessendit",
]);

function isExplicitEmailConfirmation(value: string): boolean {
  return EXPLICIT_EMAIL_CONFIRMATIONS.has(normalizeEvidence(value));
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

const OBSERVABLE_TOOL_FAILURES = new Set([
  "atomic_capture_rejected",
  "email_confirmation_not_explicit",
  "email_confirmation_not_pending",
  "email_readback_missing",
  "invalid_email",
  "ungrounded_email_confirmation",
  "ungrounded_identity_capture",
  "unconfirmed_required_fields",
]);

function recordObservableToolFailure(
  state: VoiceRuntimeState,
  item: RealtimeOutputItem,
  output: Record<string, unknown>,
): VoiceRuntimeState {
  if (output.ok !== false) return state;
  const detail = output.detail && typeof output.detail === "object" ? (output.detail as Record<string, unknown>) : null;
  const error = typeof detail?.error === "string" ? detail.error : typeof output.error === "string" ? output.error : "";
  if (!OBSERVABLE_TOOL_FAILURES.has(error)) return state;
  const key = typeof detail?.key === "string" ? detail.key : typeof output.key === "string" ? output.key : undefined;
  const issue: VoiceRuntimeError = {
    eventId: item.call_id,
    code: error === "unconfirmed_required_fields" ? "voice_email_unconfirmed" : "voice_capture_rejected",
    message: [item.name ?? "unknown_tool", error, key].filter(Boolean).join(":"),
  };
  return { ...state, errors: [...(state.errors ?? []), issue].slice(-20) };
}

function getMissingFields(captured: CapturedLead) {
  return REQUIRED_CAPTURED_FIELDS.filter((key) => !captured[key].trim());
}

function getUnconfirmedFields(state: Pick<VoiceRuntimeState, "captured" | "emailVerification">) {
  return isLikelyEmail(state.captured.email) && !isVoiceEmailConfirmed(state)
    ? (["email"] as Array<keyof CapturedLead>)
    : [];
}

function getInvalidFields(captured: CapturedLead): Array<keyof CapturedLead> {
  const invalid: Array<keyof CapturedLead> = [];
  const email = captured.email.trim();
  if (email && !isLikelyEmail(email)) invalid.push("email");
  return invalid;
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const capturedFieldLabels: Record<keyof CapturedLead, string> = {
  name: "name",
  email: "email",
  org: "organisation",
  phone: "phone",
  website: "website or socials",
  message: "brief",
};

function getMissingFieldLabels(fields: Array<keyof CapturedLead>) {
  return fields.map((field) => capturedFieldLabels[field]);
}
