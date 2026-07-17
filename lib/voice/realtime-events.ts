import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";
import {
  resolveVoiceEmailCaptureMode,
  type VoiceEmailCaptureConfidence,
  type VoiceEmailCaptureMode,
} from "@/lib/voice/email-capture-policy";
import type { FieldProvenance } from "@/lib/voice/interaction-attribution";
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

export type VoiceRuntimeRateLimit = {
  name: string;
  limit: number;
  remaining: number;
  reset_seconds: number;
};

export type VoiceEmailVerification = {
  value: string;
  source: "prefill" | "speech" | "typed";
  status: "confirmed" | "pending";
  confidence?: VoiceEmailCaptureConfidence;
};

export type VoiceRuntimeState = {
  segment: SegmentId;
  captured: CapturedLead;
  transcript: VoiceTranscriptEntry[];
  handledCallIds?: string[];
  routeRequested?: boolean;
  usage?: VoiceRuntimeUsage;
  rateLimits?: VoiceRuntimeRateLimit[];
  errors?: VoiceRuntimeError[];
  emailVerification?: VoiceEmailVerification;
  /** PII-free source/correction counters for each captured field. */
  fieldProvenance?: FieldProvenance;
  emailVerificationUserTurnSequence?: number;
  emailVerificationIgnoredTranscriptIds?: string[];
  emailCaptureMode?: VoiceEmailCaptureMode;
  pendingUserTranscripts?: number;
  pendingUserTranscriptIds?: string[];
  activeResponseTranscriptBinding?: { pending: boolean; itemId?: string };
  activeResponseStaleForEmail?: boolean;
  emailGroundingAwaitingTranscript?: { value: string; userTurnCount: number; itemId?: string };
  /** Legacy untagged transcriptions committed before clear-all. */
  ignoredPendingTranscripts?: number;
  /** Tagged transcriptions committed before clear-all that must not restore erased PII. */
  ignoredUserTranscriptIds?: string[];
  /** After clear-all, accept only uniquely tagged transcriptions seen in a new commit event. */
  requireCommittedUserTranscriptIds?: boolean;
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
  item_id?: string;
  event_id?: string;
  error?: { message?: string; code?: string; event_id?: string };
  rate_limits?: unknown[];
  usage?: RealtimeUsage;
  item?: RealtimeOutputItem;
  response?: { output?: RealtimeOutputItem[]; usage?: RealtimeUsage };
  /** Server-resolved policy copied onto data-channel events by the client. */
  email_capture_mode?: VoiceEmailCaptureMode;
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
  return (
    error.code === "voice_capture_rejected" ||
    error.code === "voice_capture_rejected_email" ||
    error.code === "voice_email_unconfirmed"
  );
}

/** Record a message the visitor typed into the live chat as a user transcript turn. */
export function appendTypedUserMessage(state: VoiceRuntimeState, text: string): VoiceRuntimeState {
  return applyUserEmailUpdate(appendTranscript(state, "user", text), text, "typed");
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
  let state = event.email_capture_mode
    ? { ...current, emailCaptureMode: resolveVoiceEmailCaptureMode(event.email_capture_mode) }
    : current;
  state = invalidateSupersededEmailVerification(state);
  const eventTranscript = asString(event.transcript);
  const settlesUserTranscription =
    event.type === "conversation.item.input_audio_transcription.completed" ||
    event.type === "conversation.item.input_audio_transcription.failed";
  const settledTranscriptId = asString(event.item_id);
  const pendingTranscriptIds = state.pendingUserTranscriptIds ?? [];
  const ignoredTranscriptIds = state.ignoredUserTranscriptIds ?? [];
  const settlesPendingId = Boolean(settledTranscriptId && pendingTranscriptIds.includes(settledTranscriptId));
  const ignoresSettledId = Boolean(settledTranscriptId && ignoredTranscriptIds.includes(settledTranscriptId));
  const ignoresUnknownSettledId = Boolean(
    settlesUserTranscription &&
      state.requireCommittedUserTranscriptIds &&
      settledTranscriptId &&
      !settlesPendingId &&
      !ignoresSettledId,
  );
  const ignoresLegacySettledTranscript =
    settlesUserTranscription &&
    !settledTranscriptId &&
    (Boolean(state.requireCommittedUserTranscriptIds) || (state.ignoredPendingTranscripts ?? 0) > 0);
  const settlesLegacyPendingTranscript =
    settlesUserTranscription &&
    !settledTranscriptId &&
    !ignoresLegacySettledTranscript &&
    (state.pendingUserTranscripts ?? 0) > 0;
  const ignoreSettledTranscription = ignoresSettledId || ignoresUnknownSettledId || ignoresLegacySettledTranscript;

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
    const committedTranscriptId = asString(event.item_id);
    const duplicateOrIgnoredId = Boolean(
      committedTranscriptId &&
        [...(state.pendingUserTranscriptIds ?? []), ...(state.ignoredUserTranscriptIds ?? [])].includes(
          committedTranscriptId,
        ),
    );
    const unsafeUntaggedCommit = Boolean(state.requireCommittedUserTranscriptIds && !committedTranscriptId);
    if (!duplicateOrIgnoredId && !unsafeUntaggedCommit) {
      state = {
        ...state,
        pendingUserTranscripts: (state.pendingUserTranscripts ?? 0) + 1,
        ...(committedTranscriptId
          ? { pendingUserTranscriptIds: [...(state.pendingUserTranscriptIds ?? []), committedTranscriptId] }
          : {}),
      };
    }
  }

  if (settlesUserTranscription) {
    state = {
      ...state,
      pendingUserTranscripts:
        settlesPendingId || settlesLegacyPendingTranscript
          ? Math.max(0, (state.pendingUserTranscripts ?? 0) - 1)
          : state.pendingUserTranscripts,
      pendingUserTranscriptIds: settledTranscriptId
        ? pendingTranscriptIds.filter((id) => id !== settledTranscriptId)
        : pendingTranscriptIds,
      ignoredPendingTranscripts: ignoresLegacySettledTranscript
        ? Math.max(0, (state.ignoredPendingTranscripts ?? 0) - 1)
        : state.ignoredPendingTranscripts,
      // Keep tagged tombstones for the rest of this voice session. A duplicate
      // completion or a protocol-invalid ID reuse must never restore cleared PII.
      ignoredUserTranscriptIds: ignoredTranscriptIds,
    };
  }

  if (
    event.type === "conversation.item.input_audio_transcription.completed" &&
    eventTranscript &&
    !ignoreSettledTranscription
  ) {
    const completionPredatesVerification = Boolean(
      event.item_id && state.emailVerificationIgnoredTranscriptIds?.includes(event.item_id),
    );
    state = appendTranscript(state, "user", eventTranscript);
    state = completionPredatesVerification
      ? {
          ...state,
          emailVerificationUserTurnSequence: countUserTurns(state.transcript),
          emailVerificationIgnoredTranscriptIds: state.emailVerificationIgnoredTranscriptIds?.filter(
            (id) => id !== event.item_id,
          ),
        }
      : reconcileCompletedEmailTranscription(state, eventTranscript, event.item_id);
    state = accumulateUsage(state, "transcription", event.usage);
  }
  if (
    event.type === "conversation.item.input_audio_transcription.failed" &&
    ((state.emailGroundingAwaitingTranscript?.itemId &&
      event.item_id === state.emailGroundingAwaitingTranscript.itemId) ||
      (!state.emailGroundingAwaitingTranscript?.itemId && (state.pendingUserTranscripts ?? 0) === 0))
  ) {
    state = { ...state, emailGroundingAwaitingTranscript: undefined };
  }

  if (event.type === "response.created") {
    state = {
      ...state,
      activeResponse: true,
      activeResponseStaleForEmail: false,
      activeResponseTranscriptBinding: {
        pending: (state.pendingUserTranscripts ?? 0) > 0,
        itemId: state.pendingUserTranscriptIds?.at(-1),
      },
    };
  }

  if (event.type === "response.done") {
    state = accumulateUsage(state, "response", event.response?.usage);
    // Clearing the draft here also drops captions of a cancelled response.
    state = { ...state, activeResponse: false, assistantDraft: "" };
  }

  if (event.type === "rate_limits.updated" && Array.isArray(event.rate_limits)) {
    state = { ...state, rateLimits: event.rate_limits.flatMap(normalizeRealtimeRateLimit).slice(0, 20) };
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
  if (responseContainsAuthoritativeEmailConflict(items, state)) {
    state = { ...state, activeResponseStaleForEmail: true };
  }
  const orderedItems = [
    ...items.filter((item) => item?.name !== "route_to_team"),
    ...items.filter((item) => item?.name === "route_to_team"),
  ];
  for (const item of orderedItems) {
    if (!item || typeof item !== "object") continue;
    const text = getOutputText(item);
    if (text) state = appendTranscript(state, "assistant", text);
    if (item.type === "function_call") {
      const reduced = applyFunctionCall(item, state);
      state = reduced.state;
      commands.push(...reduced.commands);
    }
  }

  if (event.type === "response.done") {
    state = { ...state, activeResponseTranscriptBinding: undefined, activeResponseStaleForEmail: undefined };
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
  const staleForEmail = responsePredatesEmailVerification(next);

  switch (item.name) {
    case "set_partner_type": {
      const segment = toSegmentId(args.segment);
      output = segment ? { ok: true, segment } : { ok: false, error: "invalid_segment" };
      if (segment) next = { ...next, segment };
      break;
    }
    case "capture_field": {
      if (
        toCapturedKey(args.key) === "email" &&
        (staleForEmail || captureWouldReplaceAuthoritativeEmail(next, args.value))
      ) {
        next = { ...next, activeResponseStaleForEmail: true };
        output = { ok: false, error: "stale_response", key: "email" };
        createResponse = false;
        break;
      }
      const capture = applyCaptureField(args, next.captured, next.transcript, transcriptionPendingForCapture(next));
      if (!capture.ok) {
        const invalidated = invalidateRejectedEmailReplacement(next, args);
        next = invalidated.state;
        output = emailCaptureRecovery(capture.output, toCapturedKey(args.key) === "email", invalidated.invalidated);
        break;
      }
      next = applyCaptureResult(next, capture);
      output = captureOutput(capture, next);
      break;
    }
    case "capture_fields": {
      const fields = Array.isArray(args.fields) ? args.fields : [];
      if (
        fields.some(
          (field) =>
            field &&
            typeof field === "object" &&
            !Array.isArray(field) &&
            toCapturedKey((field as Record<string, unknown>).key) === "email" &&
            (staleForEmail || captureWouldReplaceAuthoritativeEmail(next, (field as Record<string, unknown>).value)),
        )
      ) {
        next = { ...next, activeResponseStaleForEmail: true };
        output = { ok: false, error: "stale_response", key: "email" };
        createResponse = false;
        break;
      }
      if (fields.length < 1 || fields.length > 6) {
        output = { ok: false, error: "invalid_field_batch" };
        break;
      }
      const seen = new Set<keyof CapturedLead>();
      let captured = next.captured;
      const applied: Array<{ key: keyof CapturedLead; mode: "append" | "replace" }> = [];
      let emailConfidence: VoiceEmailCaptureConfidence | undefined;
      let emailTranscriptionPending = false;
      let emailInvalidated = false;
      const rejected: Array<{ index: number; output: Record<string, unknown> }> = [];
      let duplicateFailure: { index: number; output: Record<string, unknown> } | null = null;
      for (const [index, field] of fields.entries()) {
        const fieldArgs = field && typeof field === "object" && !Array.isArray(field) ? field : {};
        const key = toCapturedKey((fieldArgs as Record<string, unknown>).key);
        if (key && seen.has(key)) {
          duplicateFailure = { index, output: { ok: false, error: "duplicate_field", key } };
          break;
        }
        if (key) seen.add(key);
        const capture = applyCaptureField(
          fieldArgs as Record<string, unknown>,
          captured,
          next.transcript,
          transcriptionPendingForCapture(next),
        );
        if (!capture.ok) {
          rejected.push({ index, output: capture.output });
          if (key === "email") {
            const invalidated = invalidateRejectedEmailReplacement(
              { ...next, captured },
              fieldArgs as Record<string, unknown>,
            );
            captured = invalidated.state.captured;
            emailInvalidated ||= invalidated.invalidated;
          }
          continue;
        }
        captured = capture.captured;
        if (capture.key === "email") {
          emailConfidence = capture.emailConfidence;
          emailTranscriptionPending = capture.emailTranscriptionPending ?? false;
        }
        applied.push({ key: capture.key, mode: capture.mode });
      }
      if (duplicateFailure) {
        output = {
          ok: false,
          error: "invalid_field_batch",
          failedIndex: duplicateFailure.index,
          detail: duplicateFailure.output,
        };
        break;
      }
      const emailApplied = applied.some((field) => field.key === "email");
      next = {
        ...next,
        captured,
        ...(emailInvalidated
          ? {
              emailVerification: undefined,
              emailVerificationUserTurnSequence: undefined,
              emailVerificationIgnoredTranscriptIds: undefined,
              emailGroundingAwaitingTranscript: undefined,
            }
          : emailApplied
            ? {
                emailVerification: spokenEmailVerification(
                  captured.email,
                  next.emailVerification,
                  next.emailCaptureMode,
                  emailConfidence,
                ),
                emailVerificationUserTurnSequence: countUserTurns(next.transcript),
                emailVerificationIgnoredTranscriptIds: undefined,
                emailGroundingAwaitingTranscript: emailTranscriptionPending
                  ? {
                      value: captured.email,
                      userTurnCount: countUserTurns(next.transcript),
                      itemId: pendingTranscriptIdForCapture(next),
                    }
                  : undefined,
              }
            : {}),
      };
      output =
        rejected.length > 0
          ? {
              ok: false,
              error: "partial_capture",
              fields: applied,
              rejectedFields: rejected,
              detail: rejected[0]?.output,
              captured,
              retry: rejected.some((entry) => entry.output.key === "email")
                ? "Keep accepted fields. Highlight the visible email field now; do not request another spoken spelling."
                : "Keep the accepted fields. Retry or clarify only the rejected fields.",
              ...(rejected.some((entry) => entry.output.key === "email")
                ? {
                    nextAction:
                      "Tell the visitor the email field is ready for typing, then continue their idea without focusing on email.",
                    previousEmailInvalidated: emailInvalidated,
                  }
                : {}),
              ...(emailApplied ? emailConfirmationInstructions(next) : {}),
            }
          : {
              ok: true,
              fields: applied,
              captured,
              ...(emailApplied ? emailConfirmationInstructions(next) : {}),
            };
      break;
    }
    case "confirm_email": {
      if (staleForEmail) {
        output = { ok: false, error: "stale_response", key: "email" };
        createResponse = false;
        break;
      }
      const confirmation = confirmCapturedEmail(args, next, transcriptionPendingForCapture(next));
      if (!confirmation.ok) {
        output = confirmation.output;
        break;
      }
      next = {
        ...next,
        emailVerification: confirmation.verification,
        emailVerificationUserTurnSequence: countUserTurns(next.transcript),
        emailVerificationIgnoredTranscriptIds: undefined,
        emailGroundingAwaitingTranscript: undefined,
      };
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
      if (staleForEmail && key === "email") {
        output = { ok: false, error: "stale_response", key: "email" };
        createResponse = false;
        break;
      }
      if (key) {
        next = {
          ...next,
          captured: { ...next.captured, [key]: "" },
          ...(key === "email"
            ? {
                emailVerification: undefined,
                emailVerificationUserTurnSequence: undefined,
                emailVerificationIgnoredTranscriptIds: undefined,
                emailGroundingAwaitingTranscript: undefined,
              }
            : {}),
        };
        output = { ok: true, key, captured: next.captured };
      } else {
        output = { ok: false, error: "invalid_field" };
      }
      break;
    }
    case "clear_fields": {
      if (args.scope !== "all") {
        output = { ok: false, error: "invalid_clear_scope" };
        break;
      }
      const clearedFields = CAPTURED_LEAD_KEYS.filter((key) => Boolean(next.captured[key].trim()));
      const pendingUserTranscriptIds = next.pendingUserTranscriptIds ?? [];
      const ignoredPendingTranscripts = Math.max(
        0,
        (next.pendingUserTranscripts ?? 0) - pendingUserTranscriptIds.length,
      );
      next = {
        ...next,
        captured: { ...emptyCapturedLead },
        emailVerification: undefined,
        emailVerificationUserTurnSequence: undefined,
        emailVerificationIgnoredTranscriptIds: undefined,
        emailGroundingAwaitingTranscript: undefined,
        routeRequested: false,
        transcript: [],
        assistantDraft: "",
        pendingUserTranscripts: 0,
        pendingUserTranscriptIds: [],
        ignoredPendingTranscripts,
        ignoredUserTranscriptIds: [
          ...(next.ignoredUserTranscriptIds ?? []),
          ...pendingUserTranscriptIds.filter((id) => !(next.ignoredUserTranscriptIds ?? []).includes(id)),
        ].slice(-100),
        requireCommittedUserTranscriptIds: true,
      };
      output = { ok: true, cleared: true, clearedFields, captured: next.captured };
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
      if (staleForEmail) {
        output = { ok: false, error: "stale_response" };
        createResponse = false;
        break;
      }
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

function applyUserEmailUpdate(state: VoiceRuntimeState, text: string, source: "speech" | "typed"): VoiceRuntimeState {
  const currentEmail = state.captured.email.trim();
  const correctedLiteral = hasEmailCorrectionLanguage(text) ? getLiteralEmailMentions(text).at(-1)?.email : undefined;
  const email = correctedLiteral ?? extractExplicitVisitorEmail(text);
  if (!email) {
    if (!currentEmail || (!hasOwnedEmailReplacementIntent(text) && !hasShortContextualEmailCorrection(state, text))) {
      return state;
    }
    return {
      ...state,
      captured: { ...state.captured, email: "" },
      emailVerification: undefined,
      emailVerificationUserTurnSequence: undefined,
      emailVerificationIgnoredTranscriptIds: undefined,
      emailGroundingAwaitingTranscript: undefined,
      activeResponseStaleForEmail:
        source === "typed" && state.activeResponse ? true : state.activeResponseStaleForEmail,
    };
  }
  if (email.toLowerCase() === currentEmail.toLowerCase()) return state;
  const adaptiveSpeech = source === "speech" && state.emailCaptureMode === "adaptive";
  return {
    ...state,
    captured: { ...state.captured, email },
    emailVerificationUserTurnSequence: countUserTurns(state.transcript),
    emailVerificationIgnoredTranscriptIds: source === "typed" ? [...(state.pendingUserTranscriptIds ?? [])] : undefined,
    activeResponseStaleForEmail: source === "typed" && state.activeResponse ? true : state.activeResponseStaleForEmail,
    emailVerification:
      source === "typed"
        ? { value: email, source, status: "confirmed" }
        : {
            value: email,
            source,
            status: adaptiveSpeech ? "confirmed" : "pending",
            ...(adaptiveSpeech ? { confidence: "high" as const } : {}),
          },
  };
}

function reconcileCompletedEmailTranscription(
  state: VoiceRuntimeState,
  text: string,
  completedItemId: string | undefined,
): VoiceRuntimeState {
  const awaiting = state.emailGroundingAwaitingTranscript;
  const email = state.captured.email.trim().toLowerCase();
  if (!awaiting || awaiting.value.trim().toLowerCase() !== email) {
    if (
      state.emailVerification?.status === "confirmed" &&
      (state.emailVerification.source === "typed" || state.emailVerification.source === "prefill")
    ) {
      return state;
    }
    return applyUserEmailUpdate(state, text, "speech");
  }
  const matchesAwaitedTranscript = awaiting.itemId
    ? completedItemId === awaiting.itemId
    : countUserTurns(state.transcript) === awaiting.userTurnCount + 1;
  if (!matchesAwaitedTranscript) return state;

  const settled = {
    ...state,
    emailGroundingAwaitingTranscript: undefined,
    emailVerificationUserTurnSequence: countUserTurns(state.transcript),
  };
  const hasEmailCue = /@|\b(?:e-?mail|email address)\b|\b(?:at|dot|point|underscore|dash|hyphen|plus)\b/i.test(text);
  const maxAsrEdits = email.length >= 10 ? Math.min(3, Math.max(1, Math.floor(email.length * 0.18))) : 0;
  const exactPendingCapture = turnContainsExactEmail(text, email);
  const supportsPendingCapture =
    exactPendingCapture || (hasEmailCue && spokenEmailSubstitutionDistance(text, email) <= maxAsrEdits);
  const explicitlySupersedesPendingCapture =
    emailTurnRejectsTarget(text, email) ||
    (hasContextualEmailCorrection(text, email) && hasEmailCorrectionLanguage(text)) ||
    (hasOrderedEmailSelectionCue(text) && emailTurnSelectsDifferentAddress(text, email));
  if (explicitlySupersedesPendingCapture && emailCorrectionInvalidates(text, email)) {
    return {
      ...settled,
      emailVerification: undefined,
      emailVerificationUserTurnSequence: undefined,
      emailVerificationIgnoredTranscriptIds: undefined,
    };
  }
  if (supportsPendingCapture) {
    const confidence: VoiceEmailCaptureConfidence = exactPendingCapture ? "high" : "medium";
    return {
      ...settled,
      emailVerification: spokenEmailVerification(
        email,
        settled.emailVerification,
        settled.emailCaptureMode,
        confidence,
      ),
    };
  }
  return emailCorrectionInvalidates(text, email)
    ? {
        ...settled,
        emailVerification: undefined,
        emailVerificationUserTurnSequence: undefined,
        emailVerificationIgnoredTranscriptIds: undefined,
      }
    : settled;
}

function countUserTurns(transcript: VoiceTranscriptEntry[]) {
  return transcript.reduce((count, entry) => count + (entry.role === "user" ? 1 : 0), 0);
}

function invalidateSupersededEmailVerification(state: VoiceRuntimeState): VoiceRuntimeState {
  const email = state.captured.email.trim();
  const verification = state.emailVerification;
  if (!email || verification?.status !== "confirmed") return state;
  const userTurns = state.transcript.filter((entry) => entry.role === "user");
  const verifiedAt = state.emailVerificationUserTurnSequence;
  const newerUserTurns = verifiedAt === undefined ? userTurns.slice(-1) : userTurns.slice(verifiedAt);
  const latestUserText = newerUserTurns.at(-1)?.text ?? "";
  if (!latestUserText) return state;
  if (!emailCorrectionInvalidates(latestUserText, email)) return state;
  return {
    ...state,
    emailVerification: undefined,
    emailVerificationUserTurnSequence: undefined,
    emailVerificationIgnoredTranscriptIds: undefined,
  };
}

function emailCorrectionInvalidates(text: string, email: string) {
  let decision: "none" | "current" | "different" | "ambiguous" = "none";
  for (const clause of getEmailDecisionClauses(text)) {
    const clauseDecision = resolveEmailClauseSelection(clause, email);
    if (clauseDecision !== "none") decision = clauseDecision;
  }
  return decision === "different" || decision === "ambiguous";
}

function resolveEmailClauseSelection(
  clause: string,
  currentEmail: string,
): "none" | "current" | "different" | "ambiguous" {
  const current = currentEmail.trim().toLowerCase();
  const hasOwnership = hasExplicitEmailOwnershipContext(clause);
  const hasPrimaryContactOwnership = hasPrimaryContactOwnershipContext(clause);
  const hasSelectionCue = hasOrderedEmailSelectionCue(clause);
  if (hasHistoricalEmailContext(clause) && !hasSelectionCue) return "none";
  const webOnly = hasExplicitNonEmailWebContext(clause) && !hasOwnership && !hasSelectionCue;
  if (webOnly) return "none";
  if (hasSecondaryEmailContext(clause) && !hasPrimaryContactOwnership && !hasSelectionCue) return "none";

  const literalMentions = getLiteralEmailMentions(clause);
  const literalResolution = resolveLiteralEmailSelection(clause, current);
  if (literalResolution === "current") {
    return emailTurnSelectsTarget(clause, current) ||
      hasPrimaryContactOwnership ||
      literalClauseRejectsDifferentAddress(clause, current) ||
      emailClauseAffirmsAddress(clause)
      ? "current"
      : "none";
  }
  if (literalResolution !== "none") return literalResolution;

  if (emailTurnRejectsTarget(clause, current)) return "different";

  const containsCurrent = turnContainsExactEmail(clause, current);
  if (containsCurrent) {
    if (emailTurnOffersAlternatives(clause) && !postAlternativeSelectionText(clause)) return "none";
    const following = getFollowingEmailDisposition(clause, current);
    if (following === "supersedes") return "different";
    if (emailTurnSelectsTarget(clause, current)) return "current";
    if (hasPrecedingSpokenEmailAddress(clause, current)) return "different";
    if (hasSelectionCue) return "different";
    if (hasPrimaryContactOwnership || emailClauseAffirmsAddress(clause)) return "current";
    return "none";
  }

  const containsSpokenAddress = containsSpokenEmailShape(clause);
  if (literalMentions.length === 0 && !containsSpokenAddress) {
    return hasContextualEmailCorrection(clause, current) && hasEmailCorrectionLanguage(clause) ? "different" : "none";
  }
  if (!containsSpokenAddress) return "none";
  if (emailTurnOffersAlternatives(clause) && !postAlternativeSelectionText(clause)) return "different";
  if (emailClauseRejectsOnlyMention(clause) && !hasSelectionCue) return "none";
  return "different";
}

function getEmailDecisionClauses(text: string) {
  return text
    .split(
      /(?:[;.!?]+\s+|\s+[—–-]\s*(?=(?:actually|i\s+meant|correction|use|choose|select|prefer|keep|go\s+with|switch\s+to))|\s+\b(?:but|however|whereas|while)\b\s+|[,;]?\s+(?:and\s+)?(?:now|currently)\s+|,\s*then\s+|,\s*(?=[^,]{0,120}\b(?:is\s+(?:the\s+)?current|(?:my\s+)?new\s+(?:e-?mail|address)))|\s+and\s+(?=(?:my\s+)?new\s+(?:e-?mail|address))|,\s*(?:and\s+)?(?=(?:actually|i\s+meant|correction)\b|(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|e-?mail\b|contact\b|reach\b))|\s+and\s+(?=(?:actually|i\s+meant|correction)\b|(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|e-?mail\b|contact\b|reach\b)))/i,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function hasSecondaryEmailContext(text: string) {
  return /\b(?:billing|invoice|invoices|accounts?|reference|sample|support|website|web\s*site|url|homepage|site|as\s+(?:an\s+)?example|for\s+example|old\s+e-?mail\s+was|old\s+address|previous\s+(?:e-?mail|address)|former\s+(?:e-?mail|address)|historical\s+(?:e-?mail|address)|used\s+to\s+be|was\s+the\s+(?:old|previous|former)\s+address)\b/i.test(
    text,
  );
}

function hasHistoricalEmailContext(text: string) {
  return /\b(?:used\s+to\s+be|i\s+used|we\s+used|right\s+before|until\s+(?:today|yesterday|now|then)|back\s+then|archive|archived|old\s+e-?mail\s+was|old\s+address|previous\s+(?:e-?mail|address)|former\s+(?:e-?mail|address)|historical\s+(?:e-?mail|address)|was\s+the\s+(?:old|previous|former)\s+address)\b/i.test(
    text,
  );
}

function hasPrimaryContactOwnershipContext(text: string) {
  return /\b(?:my\s+e-?mail|my\s+contact\s+address|contact\s+me|reach\s+me|for\s+my\s+(?:e-?mail|contact)|as\s+my\s+contact\s+address|as\s+(?:the\s+)?contact\s+e-?mail)\b/i.test(
    text,
  );
}

function emailClauseRejectsOnlyMention(text: string) {
  return /\b(?:no|not|do\s+not\s+use|don't\s+use|dont\s+use|instead\s+of|rather\s+than|bukan)\b/i.test(text);
}

function literalClauseRejectsDifferentAddress(text: string, currentEmail: string) {
  const current = currentEmail.trim().toLowerCase();
  const normalizedText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  return getLiteralEmailMentions(text).some(
    (mention) =>
      mention.email !== current &&
      getLiteralEmailMentionDisposition(normalizedText, mention.start, mention.email.length) === "rejected",
  );
}

function emailClauseAffirmsAddress(text: string) {
  return /\b(?:yes|correct|right|that'?s\s+(?:correct|right)|it\s+is)\b/i.test(text);
}

const CAPTURED_LEAD_KEYS = Object.keys(emptyCapturedLead) as Array<keyof CapturedLead>;

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

function normalizeRealtimeRateLimit(value: unknown): VoiceRuntimeRateLimit[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const name = asString(record.name)?.trim();
  const limit = boundedNonnegativeNumber(record.limit, 1_000_000);
  const remaining = boundedNonnegativeNumber(record.remaining, 1_000_000);
  const resetSeconds = boundedNonnegativeNumber(record.reset_seconds, 86_400);
  if (!name || name.length > 80 || limit === null || remaining === null || resetSeconds === null) return [];
  return [{ name, limit, remaining, reset_seconds: resetSeconds }];
}

function boundedNonnegativeNumber(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
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
  emailConfidence?: VoiceEmailCaptureConfidence;
  emailTranscriptionPending?: boolean;
};

function applyCaptureResult(state: VoiceRuntimeState, capture: AppliedCapture): VoiceRuntimeState {
  if (capture.key !== "email") return { ...state, captured: capture.captured };
  return {
    ...state,
    captured: capture.captured,
    emailVerification: spokenEmailVerification(
      capture.captured.email,
      state.emailVerification,
      state.emailCaptureMode,
      capture.emailConfidence,
    ),
    emailVerificationUserTurnSequence: countUserTurns(state.transcript),
    emailVerificationIgnoredTranscriptIds: undefined,
    emailGroundingAwaitingTranscript: capture.emailTranscriptionPending
      ? {
          value: capture.captured.email,
          userTurnCount: countUserTurns(state.transcript),
          itemId: pendingTranscriptIdForCapture(state),
        }
      : undefined,
  };
}

function captureOutput(capture: AppliedCapture, state: VoiceRuntimeState): Record<string, unknown> {
  return {
    ok: true,
    key: capture.key,
    mode: capture.mode,
    captured: capture.captured,
    ...(capture.key === "email" ? emailConfirmationInstructions(state) : {}),
  };
}

function pendingTranscriptIdForCapture(state: VoiceRuntimeState) {
  const binding = state.activeResponseTranscriptBinding;
  if (binding) {
    return binding.pending && binding.itemId && state.pendingUserTranscriptIds?.includes(binding.itemId)
      ? binding.itemId
      : undefined;
  }
  return state.pendingUserTranscriptIds?.at(-1);
}

function transcriptionPendingForCapture(state: VoiceRuntimeState) {
  const binding = state.activeResponseTranscriptBinding;
  if (!binding) return (state.pendingUserTranscripts ?? 0) > 0;
  if (!binding.pending) return false;
  return binding.itemId
    ? Boolean(state.pendingUserTranscriptIds?.includes(binding.itemId))
    : (state.pendingUserTranscripts ?? 0) > 0;
}

function responsePredatesEmailVerification(state: VoiceRuntimeState) {
  const itemId = state.activeResponseTranscriptBinding?.itemId;
  return Boolean(
    state.activeResponseStaleForEmail || (itemId && state.emailVerificationIgnoredTranscriptIds?.includes(itemId)),
  );
}

function captureWouldReplaceAuthoritativeEmail(state: VoiceRuntimeState, value: unknown) {
  const verification = state.emailVerification;
  if (
    verification?.status !== "confirmed" ||
    (verification.source !== "typed" && verification.source !== "prefill") ||
    typeof value !== "string"
  ) {
    return false;
  }
  return value.trim().toLowerCase() !== verification.value.trim().toLowerCase();
}

function responseContainsAuthoritativeEmailConflict(items: RealtimeOutputItem[], state: VoiceRuntimeState) {
  return items.some((item) => {
    if (item?.type !== "function_call") return false;
    const args = parseArguments(item.arguments);
    if (item.name === "clear_field") return toCapturedKey(args.key) === "email";
    if (item.name === "capture_field") {
      return toCapturedKey(args.key) === "email" && captureWouldReplaceAuthoritativeEmail(state, args.value);
    }
    if (item.name !== "capture_fields" || !Array.isArray(args.fields)) return false;
    return args.fields.some(
      (field) =>
        field &&
        typeof field === "object" &&
        !Array.isArray(field) &&
        toCapturedKey((field as Record<string, unknown>).key) === "email" &&
        captureWouldReplaceAuthoritativeEmail(state, (field as Record<string, unknown>).value),
    );
  });
}

function emailConfirmationInstructions(
  state: Pick<VoiceRuntimeState, "captured" | "emailVerification" | "emailCaptureMode">,
): Record<string, unknown> {
  if (isVoiceEmailConfirmed(state)) {
    if (state.emailCaptureMode !== "adaptive" || state.emailVerification?.source !== "speech")
      return { emailConfirmationRequired: false };
    return {
      emailConfirmationRequired: false,
      emailCaptureMode: "adaptive",
      emailConfidence: state.emailVerification.confidence ?? "medium",
      nextAction:
        "The address is visible and editable. Briefly acknowledge it and continue without asking for a separate confirmation.",
    };
  }
  if (state.emailCaptureMode === "adaptive") {
    return {
      emailConfirmationRequired: false,
      emailCheckRequired: true,
      emailCaptureMode: "adaptive",
      emailConfidence: state.emailVerification?.confidence ?? "medium",
      nextAction:
        "The address is highlighted in the visible editor. Ask the visitor to check or edit it there once, then continue their idea. Do not read it back or start a spelling loop.",
    };
  }
  return {
    emailConfirmationRequired: true,
    emailReadback: spokenEmailForm(state.captured.email),
    nextAction: "Read emailReadback verbatim now, ask if it is exactly correct, and wait for the visitor's answer.",
  };
}

function spokenEmailVerification(
  email: string,
  existing: VoiceEmailVerification | undefined,
  mode: VoiceEmailCaptureMode | undefined,
  confidence: VoiceEmailCaptureConfidence | undefined,
): VoiceEmailVerification {
  if (
    existing?.status === "confirmed" &&
    (existing.source !== "speech" || mode === "adaptive") &&
    existing.value.trim().toLowerCase() === email.trim().toLowerCase()
  ) {
    return existing;
  }
  if (mode === "adaptive" && confidence === "high") {
    return { value: email.trim(), source: "speech", status: "confirmed", confidence: confidence ?? "medium" };
  }
  return {
    value: email.trim(),
    source: "speech",
    status: "pending",
    ...(mode === "adaptive" && confidence ? { confidence } : {}),
  };
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
  if (key !== "email" && !FREE_TEXT_CAPTURE_KEYS.has(key) && duplicateCapture) {
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
  return {
    ok: true,
    key,
    mode,
    captured: { ...captured, [key]: nextValue },
    ...(key === "email"
      ? {
          emailConfidence: grounding.emailConfidence ?? "medium",
          emailTranscriptionPending: transcriptionPending,
        }
      : {}),
  };
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
): { ok: true; emailConfidence?: VoiceEmailCaptureConfidence } | { ok: false; error: string } {
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

  const valueForms = normalizedValueForms(key, value);
  // The Realtime model hears native audio while the independent transcript can
  // land later or spell proper nouns differently. A self-consistent model value
  // may be drafted during that window; the visible form remains editable.
  const evidenceGrounded = approxIncludes(normalizedUserText, normalizedEvidence, tolerance);

  if (key === "org" && normalizeEvidence(value) === "individual") {
    // "Individual" is our label for "no organisation"; the user never says the word itself.
    const evidenceDeclinesOrganisation = /(?:noorganisation|noorganization|justme|individual)/.test(normalizedEvidence);
    return evidenceDeclinesOrganisation && (evidenceGrounded || transcriptionPending)
      ? { ok: true }
      : { ok: false, error: "ungrounded_identity_capture" };
  }

  if (
    key === "org" &&
    userAskedAssistantToWriteIt(transcript) &&
    valueForms.some((form) => hasRecentOrganisationEvidence(form, transcript))
  ) {
    return { ok: true };
  }

  const evidenceSupportsValue = valueForms.some((form) => approxIncludes(normalizedEvidence, form, tolerance));
  if (!evidenceSupportsValue) return { ok: false, error: "ungrounded_identity_capture" };
  if (transcriptionPending) return { ok: true };

  if (evidenceGrounded || valueForms.some((form) => approxIncludes(normalizedUserText, form, tolerance)))
    return { ok: true };

  // Names are especially vulnerable to ASR phonetic spelling. Only widen the
  // tolerance when the transcript explicitly says a name and still resembles
  // what the native-audio model heard; an unrelated invented name stays blocked.
  if (
    key === "name" &&
    hasExplicitNameCue(recentUserText) &&
    valueForms.some((form) => resemblesExplicitName(recentUserText, form))
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
): { ok: true; emailConfidence: VoiceEmailCaptureConfidence } | { ok: false; error: string } {
  const email = value.trim().toLowerCase();
  // Very short addresses have no room for approximate matching: changing one
  // character can change the mailbox or domain completely (g@b.com != g@g.com).
  const maxAsrEdits = email.length >= 10 ? Math.min(3, Math.max(1, Math.floor(email.length * 0.18))) : 0;
  const evidenceLiteralEmails = getLiteralEmailMentions(evidence);
  const evidenceHasEmailCue = containsSpokenEmailShape(evidence) || /@|\be-?mail\b/i.test(evidence);
  const evidenceSupportsEmail =
    evidenceLiteralEmails.length > 0
      ? evidenceLiteralEmails.some((mention) => mention.email === email)
      : turnContainsExactEmail(evidence, email) ||
        (evidenceHasEmailCue && spokenEmailSubstitutionDistance(evidence, email) <= maxAsrEdits);
  if (!evidenceSupportsEmail) return { ok: false, error: "ungrounded_identity_capture" };

  // A typed turn and a trailing microphone transcription can race each other.
  // Accept an exact recent match unless a newer user turn carries another
  // address or correction language; that keeps the race smooth without letting
  // an old address override a genuine correction.
  const recentUserTurns = transcript.filter((entry) => entry.role === "user").slice(-6);
  const recentUserText = recentUserTurns.at(-1)?.text ?? "";
  const completedTurnsCarryEmailDecision = recentUserTurns.some(
    (entry) =>
      getLiteralEmailMentions(entry.text).length > 0 ||
      containsSpokenEmailShape(entry.text) ||
      hasContextualEmailCorrection(entry.text, email),
  );
  if (transcriptionPending && !completedTurnsCarryEmailDecision) {
    return { ok: true, emailConfidence: "medium" };
  }
  const hasEmailCue = /@|\b(?:e-?mail|email address)\b|\b(?:at|dot|point|underscore|dash|hyphen|plus)\b/i.test(
    recentUserText,
  );
  const recentLiteralEmails = getLiteralEmailMentions(recentUserText);
  const spokenSubstitutionDistance = spokenEmailSubstitutionDistance(recentUserText, email);
  const boundedAsrSupport = hasEmailCue && spokenSubstitutionDistance <= maxAsrEdits;
  if (turnContainsExactEmail(recentUserText, email) && !supersedesRecentEmailGrounding(recentUserText, email)) {
    return { ok: true, emailConfidence: transcriptionPending ? "medium" : "high" };
  }
  const matchingTurnIndex = recentUserTurns.findLastIndex(
    (entry) => turnContainsExactEmail(entry.text, email) && !supersedesRecentEmailGrounding(entry.text, email),
  );
  if (
    matchingTurnIndex >= 0 &&
    recentUserTurns.slice(matchingTurnIndex + 1).every((entry) => !supersedesRecentEmailGrounding(entry.text, email))
  ) {
    return { ok: true, emailConfidence: transcriptionPending ? "medium" : "high" };
  }
  const latestTurnSupersedes = supersedesRecentEmailGrounding(recentUserText, email);
  const explicitlyReplaces =
    hasContextualEmailCorrection(recentUserText, email) ||
    hasOrderedEmailSelectionCue(recentUserText) ||
    emailTurnRejectsTarget(recentUserText, email);
  if (
    latestTurnSupersedes &&
    (matchingTurnIndex >= 0 ||
      explicitlyReplaces ||
      !boundedAsrSupport ||
      turnContainsExactEmail(recentUserText, email))
  ) {
    return { ok: false, error: "ungrounded_identity_capture" };
  }
  if (
    !turnContainsExactEmail(recentUserText, email) &&
    hasEmbeddedEmailCollision(recentUserText, email) &&
    spokenSubstitutionDistance > maxAsrEdits
  ) {
    // Do not treat an address embedded in another address as ASR drift:
    // a@example.com and qa@example.com are different (including spoken forms).
    return { ok: false, error: "ungrounded_identity_capture" };
  }
  if (recentLiteralEmails.length > 0 && !recentLiteralEmails.some((mention) => mention.email === email)) {
    // A literal address is exact user input, never an ASR candidate. Do not
    // auto-correct one valid mailbox into another valid mailbox.
    return { ok: false, error: "ungrounded_identity_capture" };
  }

  // Allow a small ASR spelling disagreement only when the latest turn clearly
  // contains email structure. Adaptive mode records this as medium confidence;
  // strict mode still keeps it pending behind the read-back gate.
  return boundedAsrSupport
    ? { ok: true, emailConfidence: "medium" }
    : { ok: false, error: "ungrounded_identity_capture" };
}

function supersedesRecentEmailGrounding(text: string, groundedEmail: string) {
  return emailCorrectionInvalidates(text, groundedEmail);
}

function hasEmailCorrectionLanguage(text: string) {
  return /\b(?:actually|no|instead|rather|correction|correct that|change|update|wrong|incorrect|not correct|i meant|should be|forget|replace|switch|bukan)\b/i.test(
    text,
  );
}

function hasContextualEmailCorrection(text: string, groundedEmail: string) {
  const stronglyAnaphoricCorrection =
    /\b(?:i meant|i said)\b/i.test(text) &&
    !/\b(?:meeting|schedule|appointment|venue|call|time|date|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      text,
    );
  const hasEmailContext =
    turnContainsExactEmail(text, groundedEmail) ||
    getLiteralEmailMentions(text).length > 0 ||
    /\b(?:e-?mail(?:\s+address)?|local\s+part|domain|inbox|at\s+sign)\b/i.test(text) ||
    /\b(?:at)\b[^.!?]{0,80}\b(?:dot|point)\b/i.test(text);
  return stronglyAnaphoricCorrection || (hasEmailContext && hasEmailCorrectionLanguage(text));
}

function hasOwnedEmailReplacementIntent(text: string) {
  const declaresOwnedEmail = /\b(?:my|use|change|replace|update)\s+(?:e-?mail|email address)\b/i.test(text);
  return containsSpokenEmailShape(text) && (declaresOwnedEmail || hasEmailCorrectionLanguage(text));
}

function hasShortContextualEmailCorrection(state: VoiceRuntimeState, text: string) {
  if (!/^(?:(?:sorry|no)[,.]?\s*)?i\s+(?:meant|said)\s+[\p{Letter}\p{Number}._+-]+[.!]?$/iu.test(text.trim())) {
    return false;
  }
  const previousUserTurn = state.transcript
    .filter((entry) => entry.role === "user")
    .slice(0, -1)
    .at(-1)?.text;
  return Boolean(
    previousUserTurn && (containsSpokenEmailShape(previousUserTurn) || /@|\be-?mail\b/i.test(previousUserTurn)),
  );
}

function invalidateRejectedEmailReplacement(
  state: VoiceRuntimeState,
  args: Record<string, unknown>,
): { state: VoiceRuntimeState; invalidated: boolean } {
  if (toCapturedKey(args.key) !== "email") return { state, invalidated: false };
  const attempted = typeof args.value === "string" ? args.value.trim().toLowerCase() : "";
  const current = state.captured.email.trim().toLowerCase();
  if (!current || !isLikelyEmail(attempted) || attempted === current) return { state, invalidated: false };

  const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
  const latestUserText = state.transcript.filter((entry) => entry.role === "user").at(-1)?.text ?? "";
  const pendingNativeAudio = (state.pendingUserTranscripts ?? 0) > 0 && containsSpokenEmailShape(evidence);
  const groundedReplacement =
    turnContainsExactEmail(latestUserText, attempted) ||
    textApproximatelySupportsEmail(latestUserText, attempted) ||
    pendingNativeAudio;
  if (!groundedReplacement) return { state, invalidated: false };

  return {
    state: {
      ...state,
      captured: { ...state.captured, email: "" },
      emailVerification: undefined,
    },
    invalidated: true,
  };
}

function textApproximatelySupportsEmail(text: string, email: string) {
  if (!hasOwnedEmailReplacementIntent(text)) return false;
  const maxEdits = email.length >= 10 ? Math.min(3, Math.max(1, Math.floor(email.length * 0.18))) : 0;
  return spokenEmailSubstitutionDistance(text, email) <= maxEdits;
}

function emailCaptureRecovery(
  output: Record<string, unknown>,
  isEmail: boolean,
  previousEmailInvalidated: boolean,
): Record<string, unknown> {
  if (!isEmail) return output;
  return {
    ...output,
    previousEmailInvalidated,
    nextAction:
      "Tell the visitor the visible email field is ready for typing, then continue their idea. Do not ask for another spoken spelling.",
  };
}

function containsSpokenEmailShape(text: string) {
  const tokens = getEmailSpeechTokens(text).map((token) => token.toLowerCase());
  const hasEmailContext = /\b(?:e-?mail(?:\s+address)?|local\s+part|domain|inbox|at\s+sign)\b/i.test(text);
  const nonDomainSuffixes = new Set([
    "a",
    "an",
    "at",
    "by",
    "for",
    "from",
    "here",
    "in",
    "near",
    "now",
    "on",
    "the",
    "there",
    "to",
    "with",
  ]);
  return tokens.some((token, atIndex) => {
    if (token !== "at") return false;
    const afterAt = tokens.slice(atIndex + 1, atIndex + 10);
    const markerOffset = afterAt.findIndex((candidate) => {
      if (candidate === "dot") return true;
      return candidate === "point" && hasEmailContext;
    });
    if (markerOffset < 0) return false;
    const domainTokens = afterAt.slice(0, markerOffset);
    const plausibleDomain =
      domainTokens.length > 0 &&
      domainTokens.length <= 4 &&
      domainTokens.every((candidate) => /^[\p{Letter}\p{Number}-]+$/u.test(candidate));
    const suffixTokens = tokens.slice(atIndex + markerOffset + 2, atIndex + markerOffset + 12);
    const spelledSuffixEnd = suffixTokens.findIndex((candidate) => !/^[\p{Letter}]$/u.test(candidate));
    const suffix =
      suffixTokens[0] && /^[\p{Letter}]{2,63}$/u.test(suffixTokens[0])
        ? suffixTokens[0]
        : suffixTokens.slice(0, spelledSuffixEnd < 0 ? suffixTokens.length : spelledSuffixEnd).join("");
    return (
      plausibleDomain && suffix !== undefined && /^[\p{Letter}]{2,63}$/u.test(suffix) && !nonDomainSuffixes.has(suffix)
    );
  });
}

function hasExplicitNonEmailWebContext(text: string) {
  return /\b(?:website|web\s*site|web\s+address|url|homepage|site(?:\s+link)?|domain)\b/i.test(text);
}

function hasExplicitEmailOwnershipContext(text: string) {
  return /\b(?:my\s+e-?mail|e-?mail\s+domain|e-?mail\s+(?:(?:address|domain)\s+)?(?:is|to\s+use)|correct\s+e-?mail|contact\s+(?:address|me)|reach\s+(?:me|us)|inbox|for\s+(?:my\s+)?e-?mail|as\s+(?:the\s+)?e-?mail)\b|\be-?mail\s*[:=]/i.test(
    text,
  );
}

function hasOrderedEmailSelectionCue(text: string) {
  return /\b(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|changed?\s+to|guna|contact\s+(?:me|us)\s+at|reach\s+(?:me|us)\s+at)\b/i.test(
    text,
  );
}
function emailTurnRejectsTarget(text: string, groundedEmail: string) {
  const escapedEmail = groundedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  if (
    new RegExp(
      `(?:forget\\s+|instead\\s+of\\s+|rather\\s+than\\s+|in\\s+place\\s+of\\s+|replacement\\s+for\\s+|replace\\s+|over\\s+|versus\\s+|bukan\\s+|(?:do\\s+not|don't|dont|not)\\s+(?:use\\s+)?)${escapedEmail}|${escapedEmail}\\s+(?:(?:was|is|looks?)\\s+)?(?:wrong|incorrect|not\\s+(?:right|correct)|a\\s+typo)|${escapedEmail}\\s+isn['’]?t\\s+(?:right|correct)|(?:change|replace|update)\\s+${escapedEmail}\\s+(?:to|with)`,
      "iu",
    ).test(normalizedText)
  ) {
    return true;
  }

  // Spoken addresses do not exist as a literal substring in the raw turn, so
  // retain a narrow canonical check after exact token-window matching proves
  // that this address—not a suffix address—was actually said.
  const canonical = canonicalizeEmailSpeech(text);
  const groundedIndex = canonical.indexOf(groundedEmail);
  if (groundedIndex < 0) return false;
  const beforeGrounded = canonical.slice(Math.max(0, groundedIndex - 48), groundedIndex);
  const afterGrounded = canonical.slice(
    groundedIndex + groundedEmail.length,
    groundedIndex + groundedEmail.length + 48,
  );
  return (
    /(?:forget|insteadof|ratherthan|inplaceof|replacementfor|replace|over|versus|bukan|donotuse|dontuse|not)$/.test(
      beforeGrounded,
    ) ||
    /^(?:(?:was|is|looks?)?(?:wrong|incorrect|notright|notcorrect|atypo)|isnt(?:right|correct))/.test(afterGrounded) ||
    (/(?:change|replace|update)$/.test(beforeGrounded) && /^(?:to|with)/.test(afterGrounded))
  );
}

function resolveLiteralEmailSelection(
  text: string,
  currentEmail: string,
): "none" | "current" | "different" | "ambiguous" {
  const current = currentEmail.trim().toLowerCase();
  const mentions = getLiteralEmailMentions(text);
  if (mentions.length === 0) return "none";
  const offersAlternatives = emailTurnOffersAlternatives(text);
  const alternativesIncludeCurrent = offersAlternatives && mentions.some((mention) => mention.email === current);

  const normalizedText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  let lastSelected: { email: string; index: number } | undefined;
  let lastRejected: { email: string; index: number } | undefined;
  for (const mention of mentions) {
    const disposition = getLiteralEmailMentionDisposition(normalizedText, mention.start, mention.email.length);
    if (disposition === "selected") lastSelected = { email: mention.email, index: mention.start };
    if (disposition === "rejected") lastRejected = { email: mention.email, index: mention.start };
  }

  if (lastRejected && (!lastSelected || lastRejected.index > lastSelected.index)) {
    if (lastRejected.email === current) return "different";
    if (lastSelected) return lastSelected.email === current ? "current" : "different";
    if (mentions.some((mention) => mention.email === current)) return "current";
    return "none";
  }
  if (lastSelected) return lastSelected.email === current ? "current" : "different";
  if (lastRejected?.email === current) return "different";
  if (alternativesIncludeCurrent) return "current";
  if (offersAlternatives) return "different";
  const distinct = new Set(mentions.map((mention) => mention.email));
  return distinct.size === 1 && distinct.has(current) ? "current" : "ambiguous";
}

function getLiteralEmailMentionDisposition(
  normalizedText: string,
  start: number,
  length: number,
): "selected" | "rejected" | "neutral" {
  const before = normalizedText.slice(Math.max(0, start - 100), start);
  const after = normalizedText.slice(start + length, start + length + 48);
  if (
    /(?:instead\s+of|rather\s+than|bukan|do\s+not\s+use|don't\s+use|dont\s+use|not)\s*$/i.test(before) ||
    /^\s*(?:(?:was|is|looks?)\s+)?(?:wrong|incorrect|not\s+(?:right|correct)|isn['’]?t\s+(?:right|correct))/i.test(
      after,
    )
  ) {
    return "rejected";
  }
  if (
    /(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|contact\s+(?:me|us)\s+at|contact\s+address(?:\s+is)?|reach\s+(?:me|us)\s+at|send\s+it\s+to|(?:my\s+)?(?:correct\s+)?e-?mail(?:\s+address)?\s+is|changed?\s+to|guna)\s*$/i.test(
      before,
    ) ||
    /(?:actually|no|i\s+meant|correction|sorry)\s*[,;:—–-]?\s*$/i.test(before)
  ) {
    return "selected";
  }
  return "neutral";
}

function emailTurnSelectsTarget(text: string, selectedEmail: string) {
  const target = selectedEmail.trim().toLowerCase();
  const escapedEmail = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  if (
    new RegExp(
      `(?:use|choose|select|prefer|keep|go\\s+with|switch\\s+to|contact\\s+(?:me|us)\\s+at|contact\\s+address(?:\\s+is)?|reach\\s+(?:me|us)\\s+at|send\\s+it\\s+to|(?:my\\s+)?(?:correct\\s+)?e-?mail(?:\\s+address)?\\s+is|changed?\\s+to|guna)\\s+${escapedEmail}`,
      "iu",
    ).test(normalizedText)
  ) {
    return true;
  }

  let targetWindow = findExactEmailTokenWindow(text, target);
  while (targetWindow) {
    const introduction = targetWindow.tokens
      .slice(Math.max(0, targetWindow.start - 7), targetWindow.start)
      .map((token) => token.toLowerCase())
      .join("");
    if (
      /(?:use|choose|select|prefer|keep|gowith|switchto|contactmeat|contactusat|contactaddress|contactaddressis|reachmeat|reachusat|senditto|myemailis|correctemailis|changedto|guna)$/.test(
        introduction,
      )
    ) {
      return true;
    }
    targetWindow = findExactEmailTokenWindow(text, target, targetWindow.end);
  }
  return false;
}

function emailTurnSelectsDifferentAddress(text: string, currentEmail: string) {
  const target = currentEmail.trim().toLowerCase();
  if (
    getLiteralEmailMentions(text).some(
      (mention) => mention.email !== target && emailTurnSelectsTarget(text, mention.email),
    )
  ) {
    return true;
  }

  return (
    !turnContainsExactEmail(text, target) &&
    /(?:\b(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|contact\s+(?:me|us)\s+at|contact\s+address(?:\s+is)?|reach\s+(?:me|us)\s+at|send\s+it\s+to|(?:my\s+)?(?:correct\s+)?e-?mail(?:\s+address)?\s+is|changed?\s+to|guna)\b|\be-?mail\s*[:=])[^.!?]{0,100}\bat\b[^.!?]{0,80}\b(?:dot|point)\b/i.test(
      text,
    )
  );
}

function emailTurnOffersAlternatives(text: string) {
  return (
    /\beither\b.{0,120}\bor\b/i.test(text) ||
    /\bor\b.{0,80}\bworks?\b/i.test(text) ||
    /\bboth\b.{0,120}\b(?:work|works|are fine|are okay|are ok)\b/i.test(text)
  );
}

function postAlternativeSelectionText(text: string) {
  const either = /\beither\b/i.exec(text);
  const both = /\bboth\b/i.exec(text);
  const firstAlternativeOr = /\bor\b/gi;
  firstAlternativeOr.lastIndex = either?.index ?? 0;
  const separator = either ? firstAlternativeOr.exec(text)?.index : both?.index;
  if (separator === undefined) return undefined;

  const cues = Array.from(
    text.matchAll(
      /\b(?:actually|i\s+meant|correction|use|choose|select|prefer|keep|go\s+with|switch\s+to|changed?\s+to|guna)\b/gi,
    ),
  ).filter((match) => (match.index ?? -1) > separator);
  const cue = cues.at(-1);
  return cue?.index === undefined ? undefined : text.slice(cue.index);
}

function getLiteralEmailMentions(text: string) {
  const normalizedText = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  const pattern =
    /[\p{Letter}\p{Number}][\p{Letter}\p{Number}._+-]*@[\p{Letter}\p{Number}-]+(?:\.[\p{Letter}\p{Number}-]+)+/gu;
  return Array.from(normalizedText.matchAll(pattern), (match) => ({
    email: match[0],
    start: match.index,
  }));
}

function turnContainsExactEmail(text: string, groundedEmail: string) {
  const target = groundedEmail.trim().toLowerCase();
  if (getLiteralEmailMentions(text).some((mention) => mention.email === target)) return true;
  return findExactEmailTokenWindow(text, target) !== undefined;
}

/**
 * Approximate only a complete spoken address of the same length. This permits
 * ASR substitutions ("asia" for "asha") but never prefix/suffix edits that
 * could silently change one valid mailbox into another.
 */
function spokenEmailSubstitutionDistance(text: string, groundedEmail: string) {
  const tokens = getEmailSpeechTokens(text);
  let best = Number.POSITIVE_INFINITY;
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      const candidate = canonicalizeEmailSpeech(tokens.slice(start, end).join(" "));
      if (candidate.length !== groundedEmail.length || !isLikelyEmail(candidate)) continue;
      best = Math.min(best, fullEditDistance(candidate, groundedEmail));
    }
  }
  return best;
}

function getEmailSpeechTokens(text: string) {
  return (
    text
      .match(/[\p{Letter}\p{Number}@._+-]+/gu)
      ?.map((token) => token.replace(/^[._+-]+|[._+-]+$/gu, ""))
      .filter((token) => /[\p{Letter}\p{Number}@]/u.test(token)) ?? []
  );
}

function hasEmbeddedEmailCollision(text: string, groundedEmail: string) {
  const tokens = getEmailSpeechTokens(text);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      const candidate = canonicalizeEmailSpeech(tokens.slice(start, end).join(" "));
      if (
        candidate !== groundedEmail &&
        isLikelyEmail(candidate) &&
        (candidate.includes(groundedEmail) || groundedEmail.includes(candidate))
      ) {
        return true;
      }
    }
  }
  return false;
}

function findExactEmailTokenWindow(text: string, groundedEmail: string, minimumStart = 0) {
  // Canonicalize bounded token windows rather than the whole sentence. This
  // accepts "q a dot nebula at example dot test" while preventing
  // a@example.com from matching inside qa@example.com.
  const tokens = getEmailSpeechTokens(text);
  for (let start = minimumStart; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      if (canonicalizeEmailSpeech(tokens.slice(start, end).join(" ")) !== groundedEmail) continue;
      const previousToken = tokens[start - 1]?.toLowerCase();
      const targetLocalPart = groundedEmail.split("@")[0] ?? "";
      const repeatedInitialBeforeFullSpelling =
        previousToken !== undefined &&
        targetLocalPart.length >= 4 &&
        previousToken === targetLocalPart[0]?.toLowerCase();
      const startsInsideSpelledLocalPart =
        previousToken !== undefined &&
        (/^[\p{Letter}\p{Number}]$/u.test(previousToken) ||
          /^(?:dot|point|underscore|dash|hyphen|plus)$/.test(previousToken)) &&
        !repeatedInitialBeforeFullSpelling;
      if (!startsInsideSpelledLocalPart) return { start, end, tokens };
    }
  }
  return undefined;
}

function getFollowingEmailDisposition(text: string, groundedEmail: string): "none" | "rejected" | "supersedes" {
  const targetWindow = findExactEmailTokenWindow(text, groundedEmail);
  if (!targetWindow) return "none";
  const following = targetWindow.tokens.slice(targetWindow.end);
  const nextAddressMarker = following.findIndex(
    (token, index) =>
      token.includes("@") ||
      (token.toLowerCase() === "at" &&
        following.slice(index + 1, index + 10).some((candidate) => /^(?:dot|point)$/i.test(candidate))),
  );
  if (nextAddressMarker < 0) return "none";
  const markerTokenIndex = targetWindow.end + nextAddressMarker;
  const repeatedTarget = findExactEmailTokenWindow(text, groundedEmail, targetWindow.end);
  if (repeatedTarget && repeatedTarget.start <= markerTokenIndex) {
    const repeatIntroduction = targetWindow.tokens.slice(targetWindow.end, repeatedTarget.start);
    return emailIntroductionRejectsAddress(repeatIntroduction) ? "supersedes" : "none";
  }
  const introduction = following.slice(0, nextAddressMarker).map((token) => token.toLowerCase());
  return emailIntroductionRejectsAddress(introduction) ? "rejected" : "supersedes";
}

function hasPrecedingSpokenEmailAddress(text: string, groundedEmail: string) {
  const targetWindow = findExactEmailTokenWindow(text, groundedEmail);
  if (!targetWindow || targetWindow.start === 0) return false;
  return containsSpokenEmailShape(targetWindow.tokens.slice(0, targetWindow.start).join(" "));
}

function emailIntroductionRejectsAddress(tokens: string[]) {
  const words = tokens.map((token) => token.toLowerCase());
  const compact = words.join("");
  return words.includes("no") || words.includes("not") || /(?:donotuse|dontuse|insteadof|ratherthan)/.test(compact);
}

function hasExplicitNameCue(value: string) {
  return /\b(?:my name is|i am|i'm|this is|call me)\b/i.test(value);
}

function resemblesExplicitName(value: string, expected: string) {
  const match = /\b(?:my name is|i am|i'm|this is|call me)\s+([^,.!?;]+)/i.exec(value);
  if (!match?.[1]) return false;
  const heard = normalizeEvidence(match[1].split(/\b(?:and|from|with|email|e-?mail)\b/i)[0] ?? "");
  if (!heard || heard[0] !== expected[0]) return false;

  // This is a narrow phonetic escape hatch for native-audio/ASR disagreement,
  // not permission to accept any similarly sized name. Collapse vowels and
  // common voiced/unvoiced consonant pairs, then require the two skeletons to
  // be within one edit. For example, "Goodbreed" and "Gurpreet" pass while
  // an unrelated same-initial name such as "Gareth" does not.
  const heardSkeleton = phoneticNameSkeleton(heard);
  const expectedSkeleton = phoneticNameSkeleton(expected);
  return (
    heardSkeleton.length >= 3 && expectedSkeleton.length >= 3 && fullEditDistance(heardSkeleton, expectedSkeleton) <= 1
  );
}

function phoneticNameSkeleton(value: string) {
  return normalizeEvidence(value)
    .replace(/[aeiouy]/gu, "")
    .replace(/[b]/gu, "p")
    .replace(/[d]/gu, "t")
    .replace(/[ckq]/gu, "g")
    .replace(/[fv]/gu, "f")
    .replace(/[sz]/gu, "s")
    .replace(/[hw]/gu, "")
    .replace(/(.)\1+/gu, "$1");
}

function fullEditDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function canonicalizeEmailSpeech(value: string): string {
  return collapseHyphenSeparatedLetterRun(value)
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

function collapseHyphenSeparatedLetterRun(value: string) {
  return value.replace(
    /(^|[^\p{Letter}\p{Number}])((?:[\p{Letter}\p{Number}]-){1,}[\p{Letter}\p{Number}])(?=$|[^\p{Letter}\p{Number}])/gu,
    (_match, prefix: string, run: string) => `${prefix}${run.replaceAll("-", "")}`,
  );
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
  const latestUserIndex = state.transcript.findLastIndex((entry) => entry.role === "user");
  const readbackBeforeConfirmation = state.transcript
    .slice(0, latestUserIndex)
    .findLast((entry) => entry.role === "assistant")?.text;
  if (!readbackBeforeConfirmation || !hasExactEmailReadback(readbackBeforeConfirmation, email)) {
    return { ok: false, output: { ok: false, error: "email_readback_missing", key: "email" } };
  }
  const latestUser = state.transcript.at(latestUserIndex)?.text ?? "";
  if (!isUnqualifiedEmailConfirmation(latestUser) || emailCorrectionInvalidates(latestUser, email)) {
    return { ok: false, output: { ok: false, error: "email_confirmation_contradicted", key: "email" } };
  }
  if (!transcriptionPending && !normalizeEvidence(latestUser).includes(normalizeEvidence(evidence))) {
    return { ok: false, output: { ok: false, error: "ungrounded_email_confirmation", key: "email" } };
  }
  return { ok: true, verification: { value: email, source: "speech", status: "confirmed" } };
}

/**
 * Accept the model's normal conversational wrapper, but require the address
 * inside it to be the whole read-back value. A substring check is unsafe here:
 * `x sora dot kim ...` and `sora dot kim ... x` are different addresses.
 */
function hasExactEmailReadback(text: string, email: string): boolean {
  const candidates = [text, ...text.split(/(?:[!?]+|[.;]+\s+(?=[A-Z]))\s*/u)];

  return candidates.some((value) => {
    const stripTrailingContext = (candidate: string) =>
      candidate
        .replace(
          /[,.!;:\-–—\s]*(?:(?:is|was)\s+that(?:\s+exactly)?\s+(?:right|correct)|did\s+i\s+(?:get|hear|capture)\s+that\s+(?:right|correct)|have\s+i\s+got\s+that\s+(?:right|correct)|(?:right|correct))\s*[?.!]*$/iu,
          "",
        )
        .replace(/[\s"'“”‘’\])}.!?,;:]+$/u, "")
        .trim();
    let candidate = stripTrailingContext(value.trim());
    // Test the untouched address first: valid local parts such as
    // right@example.com and confirm@example.com are not wrapper prose.
    if (candidate && canonicalizeEmailSpeech(candidate) === email.trim().toLowerCase()) return true;

    let previous = "";
    while (candidate && candidate !== previous) {
      previous = candidate;
      candidate = candidate
        .replace(/^[\s"'“”‘’([{]+/u, "")
        .replace(/^(?:okay|ok|alright|right|great|perfect|thanks|thank you|got it|so|and)[.!,:;\-–—\s]+/iu, "")
        .replace(
          /^(?:just\s+)?(?:to\s+)?confirm(?:ing)?(?:\s+(?:your|the))?(?:\s+(?:e-?mail|address)(?:\s+address)?)?(?:\s+(?:is|as))?[,:;\-–—\s]+/iu,
          "",
        )
        .replace(
          /^(?:i\s+(?:heard|have|got|captured|wrote\s+down)|i\s+have\s+your\s+(?:e-?mail|address)(?:\s+address)?\s+as|your\s+(?:e-?mail|address)(?:\s+address)?\s+(?:is|was)|the\s+(?:e-?mail|address)(?:\s+address)?\s+(?:is|was)|the\s+address\s+i\s+heard\s+(?:is|was)|that(?:'s|\s+is|\s+was)|let\s+me\s+read\s+(?:that|it)\s+back(?:\s+as)?|i(?:'ll|\s+will)\s+read\s+(?:that|it)\s+back(?:\s+as)?)[,:;\-–—\s]+/iu,
          "",
        );
      candidate = stripTrailingContext(candidate);
      if (candidate && canonicalizeEmailSpeech(candidate) === email.trim().toLowerCase()) return true;
    }

    return Boolean(candidate) && canonicalizeEmailSpeech(candidate) === email.trim().toLowerCase();
  });
}

const EXPLICIT_EMAIL_CONFIRMATIONS = new Set([
  "yes",
  "yescorrect",
  "yesitscorrect",
  "yesthatscorrect",
  "yesthatsright",
  "yesthatsexactlyright",
  "yeah",
  "yeahcorrect",
  "yeahsendit",
  "yep",
  "correct",
  "thatscorrect",
  "thatsright",
  "thatsexactlyright",
  "exactlyright",
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
  const normalized = normalizeEvidence(value);
  if (EXPLICIT_EMAIL_CONFIRMATIONS.has(normalized)) return true;
  return /^(?:yes|yeah|yep|correct|right|thatscorrect|thatsright|yesthatscorrect|yesthatsright|betul|yabetul|benar|tepat)(?:please|thanks|thankyou|sendit|pleasesendit|donotsendityet|dontsendityet)?$/.test(
    normalized,
  );
}

function isUnqualifiedEmailConfirmation(value: string) {
  return isExplicitEmailConfirmation(value);
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
  "email_confirmation_contradicted",
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
  const rejectedDetails = Array.isArray(output.rejectedFields)
    ? output.rejectedFields.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const detail = (entry as { output?: unknown }).output;
        return detail && typeof detail === "object" ? [detail as Record<string, unknown>] : [];
      })
    : [];
  const fallbackDetail =
    output.detail && typeof output.detail === "object" ? (output.detail as Record<string, unknown>) : output;
  const details = rejectedDetails.length > 0 ? rejectedDetails : [fallbackDetail];
  const issues = details.flatMap((detail): VoiceRuntimeError[] => {
    const error =
      typeof detail.error === "string" ? detail.error : typeof output.error === "string" ? output.error : "";
    if (!OBSERVABLE_TOOL_FAILURES.has(error)) return [];
    const key = typeof detail.key === "string" ? detail.key : typeof output.key === "string" ? output.key : undefined;
    const code =
      error === "unconfirmed_required_fields"
        ? "voice_email_unconfirmed"
        : key === "email"
          ? "voice_capture_rejected_email"
          : "voice_capture_rejected";
    return [
      {
        eventId: item.call_id,
        code,
        message: [item.name ?? "unknown_tool", error, key].filter(Boolean).join(":"),
      },
    ];
  });
  return issues.length > 0 ? { ...state, errors: [...(state.errors ?? []), ...issues].slice(-20) } : state;
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
