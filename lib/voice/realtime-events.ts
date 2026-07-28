import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";
import {
  resolveVoiceEmailCaptureMode,
  type VoiceEmailCaptureConfidence,
  type VoiceEmailCaptureMode,
} from "@/lib/voice/email-capture-policy";
import type { FieldProvenance } from "@/lib/voice/interaction-attribution";
import { lookupOrientalKnowledge } from "@/lib/voice/knowledge";
import type { VoiceToolName } from "@/lib/voice/latency";
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
  /** Monotonic commit order for tagged user-audio items. */
  userTranscriptCommitSequence?: number;
  /** Commit order retained only while a tagged transcription is pending. */
  pendingUserTranscriptSequences?: Record<string, number>;
  /** Settled tagged events wait here until all earlier commits have settled. */
  settledUserTranscriptBuffer?: Record<
    string,
    { status: "completed" | "failed"; transcript?: string; usage?: RealtimeUsage }
  >;
  /** Session tombstones prevent a settled provider item ID from being replayed. */
  settledUserTranscriptIds?: string[];
  /** Bounded settlement outcomes keep irreversible tools fail-closed after empty/failed ASR. */
  settledUserTranscriptOutcomes?: Record<string, "completed" | "empty" | "failed">;
  /** Every first-seen tagged speech generation, including generations seen before clear-all. */
  observedUserSpeechStartIds?: string[];
  /** No new tagged generations are trusted after the bounded tracker is exhausted. */
  userTranscriptTrackingExhausted?: boolean;
  /** Most recent committed tagged input, retained after its transcription settles. */
  latestUserTranscriptItemId?: string;
  /** Outcome for the sole supported legacy untagged transcription generation. */
  legacyUserTranscriptOutcome?: "completed" | "empty" | "failed";
  /** Sequential untagged generations are disabled after the first settlement because they cannot be replay-safe. */
  legacyUserTranscriptRetired?: boolean;
  /** Monotonic user/form authority fence used by destructive and irreversible tools. */
  userAuthoritySequence?: number;
  /** A local form/picker edit must invalidate the next not-yet-created model response. */
  localAuthorityPendingResponse?: boolean;
  /** User-turn boundary after each authoritative visible-form edit. */
  localFieldEditUserTurnSequences?: Partial<Record<keyof CapturedLead, number>>;
  /** User-turn boundary after the authoritative visible segment-picker edit. */
  localSegmentEditUserTurnSequence?: number;
  /** Every later mutation must be supported by a user turn after the latest visible local edit. */
  localMutationBoundaryUserTurnSequence?: number;
  /** Transient settlement fence while a deferred tool is replayed against its causal user turn. */
  deferredAuthorityUserTurnBoundary?: number;
  activeResponseTranscriptBinding?: {
    pending: boolean;
    itemId?: string;
    sequence?: number;
    authoritySequence?: number;
    outcome?: "completed" | "empty" | "failed";
  };
  activeResponseStaleForEmail?: boolean;
  /** Any newer speech, chat, or form edit invalidates destructive work from this response. */
  activeResponseSupersededByUserInput?: boolean;
  /** A route tool waits for its bound native-audio transcription instead of consuming "send it". */
  deferredRouteCall?: {
    callId: string;
    segment: SegmentId;
    itemId?: string;
    authoritySequence: number;
    userTurnBoundary: number;
  };
  /** Mutation tools wait for their causal ASR item instead of being lost or applied against stale evidence. */
  deferredMutationCalls?: Array<{
    item: RealtimeOutputItem;
    itemId?: string;
    authoritySequence: number;
    userTurnBoundary: number;
  }>;
  emailGroundingAwaitingTranscript?: { value: string; userTurnCount: number; itemId?: string };
  /** Legacy untagged transcriptions committed before clear-all. */
  ignoredPendingTranscripts?: number;
  /** Tagged transcriptions committed before clear-all that must not restore erased PII. */
  ignoredUserTranscriptIds?: string[];
  /** After clear-all, accept only uniquely tagged transcriptions seen in a new commit event. */
  requireCommittedUserTranscriptIds?: boolean;
  /** After clear-all, a commit must belong to a newly observed speech generation. */
  requirePostClearSpeechStart?: boolean;
  /** Tagged speech generations observed after the latest clear-all. */
  postClearSpeechStartedTranscriptIds?: string[];
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
      /** Local-only attribution for results resolved after the originating response. */
      toolName?: VoiceToolName;
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

const MAX_TRACKED_USER_TRANSCRIPTS = 256;
const MAX_DEFERRED_MUTATION_CALLS = 16;

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
  const next = applyUserEmailUpdate(appendTranscript(state, "user", text), text, "typed");
  return {
    ...next,
    userAuthoritySequence: (state.userAuthoritySequence ?? 0) + 1,
    latestUserTranscriptItemId: undefined,
    legacyUserTranscriptOutcome: undefined,
    localAuthorityPendingResponse: undefined,
    activeResponseSupersededByUserInput: state.activeResponse ? true : state.activeResponseSupersededByUserInput,
  };
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
  const settledTranscriptIds = state.settledUserTranscriptIds ?? [];
  const settledTranscriptBuffer = state.settledUserTranscriptBuffer ?? {};
  const settlesPendingId = Boolean(settledTranscriptId && pendingTranscriptIds.includes(settledTranscriptId));
  const ignoresSettledId = Boolean(settledTranscriptId && ignoredTranscriptIds.includes(settledTranscriptId));
  const replaysSettledId = Boolean(settledTranscriptId && settledTranscriptIds.includes(settledTranscriptId));
  const duplicatesBufferedSettlement = Boolean(settledTranscriptId && settledTranscriptBuffer[settledTranscriptId]);
  const ignoresUnknownSettledId = Boolean(
    settlesUserTranscription && settledTranscriptId && !settlesPendingId && !ignoresSettledId && !replaysSettledId,
  );
  const legacyPendingTranscriptions = Math.max(0, (state.pendingUserTranscripts ?? 0) - pendingTranscriptIds.length);
  const ignoresLegacySettledTranscript =
    settlesUserTranscription &&
    !settledTranscriptId &&
    (Boolean(state.requireCommittedUserTranscriptIds) ||
      pendingTranscriptIds.length > 0 ||
      legacyPendingTranscriptions !== 1 ||
      (state.ignoredPendingTranscripts ?? 0) > 0);
  const ignoreSettledTranscription =
    ignoresSettledId ||
    replaysSettledId ||
    duplicatesBufferedSettlement ||
    ignoresUnknownSettledId ||
    ignoresLegacySettledTranscript;

  if (event.type === "response.output_audio_transcript.delta") {
    const delta = asString(event.delta);
    if (delta) state = { ...state, assistantDraft: (state.assistantDraft ?? "") + delta };
  }

  const transcriptText = eventTranscript ?? getOutputText(event.item);
  if (event.type === "response.output_audio_transcript.done" && transcriptText) {
    state = appendTranscript(state, "assistant", transcriptText);
    state = { ...state, assistantDraft: "" };
  }

  if (event.type === "input_audio_buffer.speech_started") {
    const speechTranscriptId = asString(event.item_id);
    const observedSpeechIds = state.observedUserSpeechStartIds ?? [];
    const firstSeenTaggedGeneration = Boolean(speechTranscriptId && !observedSpeechIds.includes(speechTranscriptId));
    const canTrackTaggedGeneration = Boolean(
      firstSeenTaggedGeneration && trackedUserTranscriptIdentityCount(state) < MAX_TRACKED_USER_TRANSCRIPTS,
    );
    const canOpenPostClearGeneration = Boolean(
      canTrackTaggedGeneration &&
        speechTranscriptId &&
        !(state.ignoredUserTranscriptIds ?? []).includes(speechTranscriptId) &&
        !(state.settledUserTranscriptIds ?? []).includes(speechTranscriptId),
    );
    const beginsNewAuthority = !speechTranscriptId || canTrackTaggedGeneration;
    state = {
      ...state,
      ...(beginsNewAuthority
        ? {
            userAuthoritySequence: (state.userAuthoritySequence ?? 0) + 1,
            localAuthorityPendingResponse: undefined,
            activeResponseSupersededByUserInput: state.activeResponse
              ? true
              : state.activeResponseSupersededByUserInput,
          }
        : {}),
      ...(canTrackTaggedGeneration
        ? { observedUserSpeechStartIds: [...observedSpeechIds, speechTranscriptId as string] }
        : {}),
      ...(firstSeenTaggedGeneration && !canTrackTaggedGeneration ? { userTranscriptTrackingExhausted: true } : {}),
      ...(state.requirePostClearSpeechStart && canOpenPostClearGeneration
        ? {
            postClearSpeechStartedTranscriptIds: [
              ...(state.postClearSpeechStartedTranscriptIds ?? []).filter((id) => id !== speechTranscriptId),
              speechTranscriptId as string,
            ].slice(-100),
          }
        : {}),
    };
  }

  if (event.type === "input_audio_buffer.committed") {
    const committedTranscriptId = asString(event.item_id);
    const observedSpeechIds = state.observedUserSpeechStartIds ?? [];
    const firstSeenAtCommit = Boolean(committedTranscriptId && !observedSpeechIds.includes(committedTranscriptId));
    const canTrackFirstSeenCommit = Boolean(
      firstSeenAtCommit && trackedUserTranscriptIdentityCount(state) < MAX_TRACKED_USER_TRANSCRIPTS,
    );
    const duplicateOrIgnoredId = Boolean(
      committedTranscriptId &&
        [
          ...(state.pendingUserTranscriptIds ?? []),
          ...(state.ignoredUserTranscriptIds ?? []),
          ...(state.settledUserTranscriptIds ?? []),
        ].includes(committedTranscriptId),
    );
    const unsafeUntaggedCommit = Boolean(state.requireCommittedUserTranscriptIds && !committedTranscriptId);
    const postClearSpeechStarts = state.postClearSpeechStartedTranscriptIds ?? [];
    const legacyPendingTranscripts = Math.max(
      0,
      (state.pendingUserTranscripts ?? 0) - (state.pendingUserTranscriptIds?.length ?? 0),
    );
    const unsafePostClearGeneration = Boolean(
      state.requirePostClearSpeechStart &&
        (!committedTranscriptId || !postClearSpeechStarts.includes(committedTranscriptId)),
    );
    const unsafeRetiredLegacyCommit = !committedTranscriptId && Boolean(state.legacyUserTranscriptRetired);
    const unsafeTrackingExhaustion = Boolean(
      state.userTranscriptTrackingExhausted ||
        (firstSeenAtCommit && !canTrackFirstSeenCommit) ||
        ((state.userTranscriptCommitSequence ?? 0) >= MAX_TRACKED_USER_TRANSCRIPTS && committedTranscriptId),
    );
    const unsafeConcurrentLegacyCommit = !committedTranscriptId && legacyPendingTranscripts > 0;
    if (
      !duplicateOrIgnoredId &&
      !unsafeUntaggedCommit &&
      !unsafePostClearGeneration &&
      !unsafeTrackingExhaustion &&
      !unsafeConcurrentLegacyCommit &&
      !unsafeRetiredLegacyCommit
    ) {
      const commitSequence = (state.userTranscriptCommitSequence ?? 0) + 1;
      const beginsNewAuthority = !committedTranscriptId || canTrackFirstSeenCommit;
      state = {
        ...state,
        ...(beginsNewAuthority
          ? {
              userAuthoritySequence: (state.userAuthoritySequence ?? 0) + 1,
              localAuthorityPendingResponse: undefined,
              activeResponseSupersededByUserInput: state.activeResponse
                ? true
                : state.activeResponseSupersededByUserInput,
            }
          : {}),
        pendingUserTranscripts: (state.pendingUserTranscripts ?? 0) + 1,
        ...(!committedTranscriptId ? { legacyUserTranscriptOutcome: undefined } : {}),
        ...(committedTranscriptId
          ? {
              userTranscriptCommitSequence: commitSequence,
              latestUserTranscriptItemId: committedTranscriptId,
              ...(canTrackFirstSeenCommit
                ? { observedUserSpeechStartIds: [...observedSpeechIds, committedTranscriptId] }
                : {}),
              pendingUserTranscriptIds: [...(state.pendingUserTranscriptIds ?? []), committedTranscriptId],
              pendingUserTranscriptSequences: {
                ...(state.pendingUserTranscriptSequences ?? {}),
                [committedTranscriptId]: commitSequence,
              },
              postClearSpeechStartedTranscriptIds: postClearSpeechStarts.filter((id) => id !== committedTranscriptId),
            }
          : {}),
      };
    } else if (unsafeTrackingExhaustion || unsafeRetiredLegacyCommit) {
      state = { ...state, userTranscriptTrackingExhausted: true };
    } else if (committedTranscriptId && unsafePostClearGeneration && !duplicateOrIgnoredId) {
      state = {
        ...state,
        ignoredUserTranscriptIds: appendBoundedUnique(state.ignoredUserTranscriptIds, committedTranscriptId),
      };
    }
  }

  if (settlesUserTranscription) {
    if (settledTranscriptId && settlesPendingId && !ignoreSettledTranscription) {
      state = drainSettledUserTranscriptions({
        ...state,
        settledUserTranscriptBuffer: {
          ...(state.settledUserTranscriptBuffer ?? {}),
          [settledTranscriptId]: {
            status: event.type === "conversation.item.input_audio_transcription.completed" ? "completed" : "failed",
            ...(eventTranscript ? { transcript: eventTranscript } : {}),
            ...(event.usage ? { usage: event.usage } : {}),
          },
        },
      });
    } else if (!settledTranscriptId && !ignoreSettledTranscription) {
      state = { ...state, pendingUserTranscripts: Math.max(0, (state.pendingUserTranscripts ?? 0) - 1) };
      if (event.type === "conversation.item.input_audio_transcription.completed" && eventTranscript?.trim()) {
        state = appendTranscript(state, "user", eventTranscript);
        state = reconcileCompletedEmailTranscription(state, eventTranscript, undefined);
        state = accumulateUsage(state, "transcription", event.usage);
        state = { ...state, legacyUserTranscriptOutcome: "completed", legacyUserTranscriptRetired: true };
      } else if (event.type === "conversation.item.input_audio_transcription.completed") {
        state = {
          ...accumulateUsage(state, "transcription", event.usage),
          legacyUserTranscriptOutcome: "empty",
          legacyUserTranscriptRetired: true,
        };
      } else if (
        event.type === "conversation.item.input_audio_transcription.failed" &&
        !state.emailGroundingAwaitingTranscript?.itemId &&
        (state.pendingUserTranscripts ?? 0) === 0
      ) {
        state = {
          ...state,
          emailGroundingAwaitingTranscript: undefined,
          legacyUserTranscriptOutcome: "failed",
          legacyUserTranscriptRetired: true,
        };
      } else if (event.type === "conversation.item.input_audio_transcription.failed") {
        state = { ...state, legacyUserTranscriptOutcome: "failed", legacyUserTranscriptRetired: true };
      }
    } else if (ignoresLegacySettledTranscript && (state.ignoredPendingTranscripts ?? 0) > 0) {
      state = {
        ...state,
        ignoredPendingTranscripts: Math.max(0, (state.ignoredPendingTranscripts ?? 0) - 1),
      };
    } else if (settledTranscriptId && ignoresUnknownSettledId) {
      const tombstones = state.settledUserTranscriptIds ?? [];
      state =
        trackedUserTranscriptIdentityCount(state) < MAX_TRACKED_USER_TRANSCRIPTS
          ? { ...state, settledUserTranscriptIds: appendBoundedUnique(tombstones, settledTranscriptId) }
          : { ...state, userTranscriptTrackingExhausted: true };
    }
  }

  if (settlesUserTranscription && state.deferredMutationCalls?.length) {
    const resolved = resolveDeferredMutationCalls(state);
    state = resolved.state;
    commands.push(...resolved.commands);
  }

  if (settlesUserTranscription && state.deferredRouteCall) {
    const resolved = resolveDeferredRouteCall(state);
    state = resolved.state;
    commands.push(...resolved.commands);
  }

  if (event.type === "response.created") {
    const boundItemId = state.pendingUserTranscriptIds?.at(-1) ?? state.latestUserTranscriptItemId;
    state = {
      ...state,
      activeResponse: true,
      activeResponseStaleForEmail: false,
      activeResponseSupersededByUserInput: Boolean(
        state.activeResponseSupersededByUserInput || state.localAuthorityPendingResponse,
      ),
      activeResponseTranscriptBinding: {
        pending: Boolean(
          boundItemId ? state.pendingUserTranscriptIds?.includes(boundItemId) : (state.pendingUserTranscripts ?? 0) > 0,
        ),
        itemId: boundItemId,
        sequence: boundItemId ? state.pendingUserTranscriptSequences?.[boundItemId] : undefined,
        authoritySequence: state.userAuthoritySequence ?? 0,
        outcome: boundItemId ? state.settledUserTranscriptOutcomes?.[boundItemId] : state.legacyUserTranscriptOutcome,
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
  const clearAllItem = items.find(
    (item) =>
      item?.type === "function_call" && item.name === "clear_fields" && parseArguments(item.arguments).scope === "all",
  );
  // Clear-all is response-terminal, but every sibling call still receives a
  // fail-closed output and a tombstone. Otherwise a replayed sibling call ID
  // could restore PII after the clear barrier.
  const orderedItems = clearAllItem
    ? [clearAllItem, ...items.filter((item) => item !== clearAllItem)]
    : [
        ...items.filter((item) => item?.name !== "route_to_team"),
        ...items.filter((item) => item?.name === "route_to_team"),
      ];
  let clearAllTerminal = false;
  for (const item of orderedItems) {
    if (!item || typeof item !== "object") continue;
    if (clearAllTerminal) {
      if (
        item.type === "function_call" &&
        typeof item.call_id === "string" &&
        !state.handledCallIds?.includes(item.call_id)
      ) {
        state = { ...state, handledCallIds: [...(state.handledCallIds ?? []), item.call_id] };
        commands.push({
          type: "function_result",
          callId: item.call_id,
          createResponse: false,
          output: { ok: false, error: "cleared_response_discarded" },
        });
      }
      continue;
    }
    const text = getOutputText(item);
    if (text) state = appendTranscript(state, "assistant", text);
    if (item.type === "function_call") {
      const reduced = applyFunctionCall(item, state);
      state = reduced.state;
      commands.push(...reduced.commands);
      if (item === clearAllItem) clearAllTerminal = true;
    }
  }

  // A response may contain several tool calls, but asking the server to create
  // a new response after each output races those calls and surfaces as the
  // misleading "voice is busy" error. Flush all outputs, then create at most
  // one follow-up response; a submit/end command creates none.
  const functionResults = commands.filter(
    (command): command is Extract<RealtimeClientCommand, { type: "function_result" }> =>
      command.type === "function_result",
  );
  const shouldCreateFollowUp =
    functionResults.some((command) => command.createResponse) &&
    !state.deferredRouteCall &&
    !commands.some((command) => command.type === "submit_voice" || command.type === "end_voice");
  if (functionResults.length > 1 || !shouldCreateFollowUp) {
    for (const command of functionResults) command.createResponse = false;
    if (shouldCreateFollowUp) {
      const finalResult = functionResults.at(-1);
      if (finalResult) finalResult.createResponse = true;
    }
  }

  if (event.type === "response.done") {
    state = {
      ...state,
      activeResponseTranscriptBinding: undefined,
      activeResponseStaleForEmail: undefined,
      activeResponseSupersededByUserInput: undefined,
    };
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
    state.handledCallIds?.includes(item.call_id) ||
    state.deferredMutationCalls?.some((deferred) => deferred.item.call_id === item.call_id) ||
    state.deferredRouteCall?.callId === item.call_id
  ) {
    return { state, commands: [] };
  }

  const args = parseArguments(item.arguments);
  const staleForEmail = responsePredatesEmailVerification(state);
  const supersededByUserInput = responseSupersededByUserInput(state);
  const unavailableResponseInput = responseInputUnavailable(state);
  const pendingResponseTranscription = transcriptionPendingForCapture(state);
  const isCapture = item.name === "capture_field" || item.name === "capture_fields";
  const deferrableMutation =
    item.name === "set_partner_type" ||
    isCapture ||
    item.name === "confirm_email" ||
    item.name === "clear_field" ||
    item.name === "clear_fields" ||
    item.name === "end_call";
  const privacyClearWithSettledTypedIntent =
    item.name === "clear_fields" &&
    args.scope === "all" &&
    state.latestUserTranscriptItemId === undefined &&
    hasAffirmativeClearAllIntent(state);
  if (
    deferrableMutation &&
    pendingResponseTranscription &&
    !privacyClearWithSettledTypedIntent &&
    !staleForEmail &&
    !supersededByUserInput &&
    !unavailableResponseInput
  ) {
    return deferMutationCall(state, item);
  }

  let next: VoiceRuntimeState = { ...state, handledCallIds: [...(state.handledCallIds ?? []), item.call_id] };
  let output: Record<string, unknown> = { ok: true };
  let createResponse = true;
  const commands: RealtimeClientCommand[] = [];

  switch (item.name) {
    case "set_partner_type": {
      if (supersededByUserInput || unavailableResponseInput || pendingResponseTranscription) {
        output = { ok: false, error: "stale_response" };
        createResponse = false;
        break;
      }
      const segment = toSegmentId(args.segment);
      if (segment && next.localSegmentEditUserTurnSequence !== undefined && segment !== next.segment) {
        output = { ok: false, error: "stale_local_edit", segment: next.segment };
        createResponse = false;
        break;
      }
      if (segment && !postLocalEditSupportsSegment(next, segment)) {
        output = { ok: false, error: "stale_local_edit", segment: next.segment };
        createResponse = false;
        break;
      }
      output = segment ? { ok: true, segment } : { ok: false, error: "invalid_segment" };
      if (segment) next = { ...next, segment };
      break;
    }
    case "capture_field": {
      if (supersededByUserInput || unavailableResponseInput) {
        output = { ok: false, error: "stale_response", ...(toCapturedKey(args.key) ? { key: args.key } : {}) };
        createResponse = false;
        break;
      }
      if (next.localMutationBoundaryUserTurnSequence !== undefined && pendingResponseTranscription) {
        output = { ok: false, error: "transcription_pending", ...(toCapturedKey(args.key) ? { key: args.key } : {}) };
        createResponse = false;
        break;
      }
      if (captureWouldOverrideLocalFieldEdit(next, args)) {
        output = { ok: false, error: "stale_local_edit", ...(toCapturedKey(args.key) ? { key: args.key } : {}) };
        createResponse = false;
        break;
      }
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
      if (directCaptureWouldViolateAuthority(next, args)) {
        output = { ok: false, error: "stale_local_edit", key: capture.key };
        createResponse = false;
        break;
      }
      const previousValue = next.captured[capture.key];
      next = applyCaptureResult(next, capture);
      if (previousValue !== capture.captured[capture.key]) next = clearLocalFieldEditAuthority(next, capture.key);
      output = captureOutput(capture, next);
      break;
    }
    case "capture_fields": {
      const fields = Array.isArray(args.fields) ? args.fields : [];
      if (supersededByUserInput || unavailableResponseInput) {
        output = { ok: false, error: "stale_response" };
        createResponse = false;
        break;
      }
      if (next.localMutationBoundaryUserTurnSequence !== undefined && pendingResponseTranscription) {
        output = { ok: false, error: "transcription_pending" };
        createResponse = false;
        break;
      }
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
      const locallySupersededKeys: Array<keyof CapturedLead> = [];
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
        if (captureWouldOverrideLocalFieldEdit({ ...next, captured }, fieldArgs as Record<string, unknown>)) {
          rejected.push({ index, output: { ok: false, error: "stale_local_edit", ...(key ? { key } : {}) } });
          continue;
        }
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
        if (directCaptureWouldViolateAuthority({ ...next, captured }, fieldArgs as Record<string, unknown>)) {
          rejected.push({ index, output: { ok: false, error: "stale_local_edit", key: capture.key } });
          continue;
        }
        const previousValue = captured[capture.key];
        captured = capture.captured;
        if (previousValue !== captured[capture.key]) locallySupersededKeys.push(capture.key);
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
      for (const key of locallySupersededKeys) next = clearLocalFieldEditAuthority(next, key);
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
      if (staleForEmail || supersededByUserInput) {
        output = { ok: false, error: "stale_response", key: "email" };
        createResponse = false;
        break;
      }
      if (pendingResponseTranscription) {
        output = { ok: false, error: "transcription_pending", key: "email" };
        createResponse = false;
        break;
      }
      if (unavailableResponseInput) {
        output = { ok: false, error: "transcription_unavailable", key: "email" };
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
      if (
        supersededByUserInput ||
        unavailableResponseInput ||
        pendingResponseTranscription ||
        (staleForEmail && key === "email")
      ) {
        output = { ok: false, error: "stale_response", ...(key ? { key } : {}) };
        createResponse = false;
        break;
      }
      if (key && clearWouldOverrideLocalFieldEdit(next, key)) {
        output = { ok: false, error: "stale_local_edit", key };
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
      if (
        staleForEmail ||
        supersededByUserInput ||
        unavailableResponseInput ||
        (pendingResponseTranscription && !privacyClearWithSettledTypedIntent)
      ) {
        output = { ok: false, error: "stale_response", scope: "all" };
        createResponse = false;
        break;
      }
      if (clearAllWouldOverrideLocalEdits(next)) {
        output = { ok: false, error: "stale_local_edit", scope: "all" };
        createResponse = false;
        break;
      }
      if (args.scope !== "all") {
        output = { ok: false, error: "invalid_clear_scope" };
        break;
      }
      const clearedFields = CAPTURED_LEAD_KEYS.filter((key) => Boolean(next.captured[key].trim()));
      const pendingUserTranscriptIds = next.pendingUserTranscriptIds ?? [];
      const deferredRouteCall = next.deferredRouteCall;
      const deferredMutationCalls = next.deferredMutationCalls ?? [];
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
        deferredRouteCall: undefined,
        deferredMutationCalls: undefined,
        transcript: [],
        assistantDraft: "",
        userAuthoritySequence: (next.userAuthoritySequence ?? 0) + 1,
        latestUserTranscriptItemId: undefined,
        legacyUserTranscriptOutcome: undefined,
        pendingUserTranscripts: 0,
        pendingUserTranscriptIds: [],
        pendingUserTranscriptSequences: {},
        settledUserTranscriptBuffer: {},
        ignoredPendingTranscripts,
        ignoredUserTranscriptIds: [
          ...(next.ignoredUserTranscriptIds ?? []),
          ...pendingUserTranscriptIds.filter((id) => !(next.ignoredUserTranscriptIds ?? []).includes(id)),
        ].slice(-MAX_TRACKED_USER_TRANSCRIPTS),
        requireCommittedUserTranscriptIds: true,
        requirePostClearSpeechStart: true,
        postClearSpeechStartedTranscriptIds: [],
        localFieldEditUserTurnSequences: undefined,
        localSegmentEditUserTurnSequence: undefined,
        localMutationBoundaryUserTurnSequence: undefined,
        deferredAuthorityUserTurnBoundary: undefined,
        localAuthorityPendingResponse: undefined,
      };
      if (deferredRouteCall) {
        next = {
          ...next,
          handledCallIds: [...(next.handledCallIds ?? []), deferredRouteCall.callId],
        };
        commands.push({
          type: "function_result",
          callId: deferredRouteCall.callId,
          createResponse: false,
          output: { ok: false, error: "stale_response" },
          toolName: "route_to_team",
        });
      }
      for (const deferred of deferredMutationCalls) {
        const deferredCallId = deferred.item.call_id;
        if (!deferredCallId || deferredCallId === item.call_id) continue;
        next = { ...next, handledCallIds: [...(next.handledCallIds ?? []), deferredCallId] };
        commands.push({
          type: "function_result",
          callId: deferredCallId,
          createResponse: false,
          output: { ok: false, error: "cleared_response_discarded" },
          toolName: deferred.item.name as VoiceToolName,
        });
      }
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
      if (staleForEmail || supersededByUserInput) {
        output = { ok: false, error: "stale_response" };
        createResponse = false;
        break;
      }
      const requestedSegment = toSegmentId(args.segment);
      if (!requestedSegment) {
        output = { ok: false, error: "invalid_segment" };
        break;
      }
      const segment =
        next.localMutationBoundaryUserTurnSequence !== undefined || next.localSegmentEditUserTurnSequence !== undefined
          ? next.segment
          : requestedSegment;
      if (transcriptionPendingForCapture(next)) {
        if (next.deferredRouteCall) {
          output = { ok: false, error: "route_already_pending", segment };
          break;
        }
        const boundItemId = pendingTranscriptIdForCapture(next);
        return {
          state: {
            ...state,
            deferredRouteCall: {
              callId: item.call_id,
              segment,
              ...(boundItemId ? { itemId: boundItemId } : {}),
              authoritySequence:
                next.activeResponseTranscriptBinding?.authoritySequence ?? next.userAuthoritySequence ?? 0,
              userTurnBoundary: countUserTurns(next.transcript),
            },
          },
          commands: [],
        };
      }
      if (!hasPostLocalEditRouteIntent(next, segment)) {
        output = { ok: false, error: "stale_local_edit", segment };
        createResponse = false;
        break;
      }
      if (currentUserTurnMentionsSegment(next) && !postLocalEditSupportsSegment(next, segment)) {
        output = { ok: false, error: "stale_local_edit", segment: next.segment };
        createResponse = false;
        break;
      }
      if (unavailableResponseInput || next.userTranscriptTrackingExhausted) {
        output = { ok: false, error: "transcription_unavailable", segment };
        break;
      }
      return completeRouteToTeam(next, item.call_id, segment);
    }
    case "wait_for_user": {
      output = { ok: true, waited: true };
      createResponse = false;
      break;
    }
    case "end_call": {
      if (supersededByUserInput || unavailableResponseInput || pendingResponseTranscription) {
        output = { ok: false, error: "stale_response" };
        createResponse = false;
        break;
      }
      if (endCallWouldOverrideLocalEdits(next)) {
        output = { ok: false, error: "stale_local_edit" };
        createResponse = false;
        break;
      }
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

function responseSupersededByUserInput(state: VoiceRuntimeState) {
  const bindingSequence = state.activeResponseTranscriptBinding?.authoritySequence;
  return Boolean(
    state.activeResponseSupersededByUserInput ||
      (bindingSequence !== undefined && bindingSequence !== (state.userAuthoritySequence ?? 0)),
  );
}

function userTranscriptAfterTurn(transcript: VoiceTranscriptEntry[], turnSequence: number) {
  let seenUserTurns = 0;
  return transcript.filter((entry) => {
    if (entry.role !== "user") return false;
    seenUserTurns += 1;
    return seenUserTurns > turnSequence;
  });
}

function localEditBoundary(state: VoiceRuntimeState, key: keyof CapturedLead) {
  const boundaries = [
    state.localFieldEditUserTurnSequences?.[key],
    state.localMutationBoundaryUserTurnSequence,
    state.deferredAuthorityUserTurnBoundary,
  ].filter((value): value is number => typeof value === "number");
  return boundaries.length > 0 ? Math.max(...boundaries) : undefined;
}

function latestUserTurnBoundary(state: VoiceRuntimeState) {
  const userTurns = countUserTurns(state.transcript);
  return userTurns > 0 ? userTurns - 1 : undefined;
}

function trackedCurrentUserTurnBoundary(state: VoiceRuntimeState) {
  return state.userAuthoritySequence === undefined ? undefined : latestUserTurnBoundary(state);
}

function captureWouldOverrideLocalFieldEdit(state: VoiceRuntimeState, args: Record<string, unknown>) {
  const key = toCapturedKey(args.key);
  if (!key) return false;
  const boundary = localEditBoundary(state, key);
  if (boundary === undefined || typeof args.value !== "string") return false;
  const requestedValue = args.value.trim();
  const currentValue = state.captured[key].trim();
  const transcript = userTranscriptAfterTurn(state.transcript, boundary);
  if (transcript.length === 0) return true;
  const recentUserText = transcript.at(-1)?.text ?? "";
  if (captureHasTrailingAnaphoricRetraction(args, recentUserText)) return true;
  if (captureCandidateIsExplicitlyRejected(key, requestedValue, recentUserText)) return true;
  if (isAnaphoricAffirmativeReply(recentUserText) && assistantSupportsCaptureCandidate(state, key, requestedValue)) {
    return false;
  }
  const sameValue =
    key === "email"
      ? requestedValue.toLowerCase() === currentValue.toLowerCase()
      : normalizeEvidence(requestedValue) === normalizeEvidence(currentValue);
  if (sameValue) return false;

  if (FREE_TEXT_CAPTURE_KEYS.has(key)) {
    const evidence = asString(args.evidence)?.trim() ?? "";
    return !freeTextCaptureHasPostEditSupport(key, requestedValue, evidence, recentUserText);
  }
  return !applyCaptureField(args, state.captured, transcript, false).ok;
}

function directCaptureWouldViolateAuthority(state: VoiceRuntimeState, args: Record<string, unknown>) {
  const key = toCapturedKey(args.key);
  if (!key || localEditBoundary(state, key) !== undefined || typeof args.value !== "string") return false;
  const boundary = trackedCurrentUserTurnBoundary(state);
  if (boundary === undefined) return false;
  const transcript = userTranscriptAfterTurn(state.transcript, boundary);
  const latest = transcript.at(-1)?.text.trim() ?? "";
  const requestedValue = args.value.trim();
  if (!latest || isAnaphoricNegativeReply(latest) || captureHasTrailingAnaphoricRetraction(args, latest)) return true;
  if (captureCandidateIsExplicitlyRejected(key, requestedValue, latest)) return true;
  if (isAnaphoricAffirmativeReply(latest) && assistantSupportsCaptureCandidate(state, key, requestedValue)) {
    return false;
  }
  if (FREE_TEXT_CAPTURE_KEYS.has(key)) {
    const evidence = asString(args.evidence)?.trim() ?? "";
    return !freeTextCaptureHasPostEditSupport(key, requestedValue, evidence, latest);
  }
  return !applyCaptureField(args, state.captured, transcript, false).ok;
}

function captureCandidateIsExplicitlyRejected(key: keyof CapturedLead, value: string, text: string) {
  const escaped = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const digits = value.replace(/\D/gu, "");
  const website = value
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/^www\./u, "")
    .replace(/\/$/u, "");
  const candidatePattern =
    key === "phone"
      ? digits.slice(0, 32).split("").map(escaped).join("\\D*")
      : key === "website"
        ? website
            .slice(0, 160)
            .split(/([.-])/u)
            .map((part) =>
              part === "."
                ? "(?:\\s*\\.\\s*|\\s+dot\\s+)"
                : part === "-"
                  ? "(?:\\s*-\\s*|\\s+dash\\s+)"
                  : escaped(part),
            )
            .join("")
        : value.trim().slice(0, 160).split(/\s+/u).map(escaped).join("\\s+");
  if (!candidatePattern) return false;
  const beforeCandidateNoise = key === "phone" ? "\\D{0,12}" : "\\s*";
  return (
    new RegExp(
      `\\b(?:not|never|instead\\s+of|rather\\s+than|(?:scratch|strike|forget|ignore|disregard|retract)(?:\\s+(?:that|it|this))?|do\\s+not\\s+(?:use|save|keep|record)|don['’]?t\\s+(?:use|save|keep|record))\\b(?:\\s+(?:the|this|that|old|previous|number|site|website)){0,4}${beforeCandidateNoise}${candidatePattern}`,
      "iu",
    ).test(text) ||
    new RegExp(
      `${candidatePattern}.{0,32}\\b(?:(?:is|was|looks?)\\s+(?:wrong|incorrect|a\\s+mistake)|(?:is\\s+not|isn['’]?t|was\\s+not|wasn['’]?t)\\s+(?:right|correct|mine|ours?|my\\s+(?:name|email|number|website)|the\\s+(?:right|correct)\\s+one))\\b`,
      "iu",
    ).test(text)
  );
}

const CAPTURE_CORRECTION_DISCOURSE_SOURCE =
  "(?:on\\s+second\\s+thought|thinking\\s+again|hold\\s+on(?:\\s+(?:a|one)\\s+second)?|hang\\s+on(?:\\s+(?:a|one)\\s+second)?|i\\s+mean(?:t)?|correction|actually|sorry|well|wait|nope|nah|no)";
const CAPTURE_DIRECT_REPLACEMENT_CUE_SOURCE =
  "(?:it(?:\\s+is|['’]s|\\s+should\\s+be)|that(?:\\s+is|['’]s|\\s+should\\s+be)|this(?:\\s+is|['’]s|\\s+should\\s+be)|use|make\\s+(?:it|that)|change\\s+it\\s+to|replace\\s+(?:that|it|this)\\s+with)";
const CAPTURE_CORRECTION_FILLER_SOURCE = "(?:um+|uh+|erm+|hmm+|mm+)";
const CAPTURE_CORRECTION_CUE_NOISE_SOURCE = `(?:\\s*[,;:.…—–-])*\\s*(?:(?:${CAPTURE_CORRECTION_FILLER_SOURCE})\\b(?:\\s*[,;:.…—–-])*\\s*)*`;
const CAPTURE_ANY_CORRECTION_CUE_SOURCE = `(?:${CAPTURE_CORRECTION_DISCOURSE_SOURCE}|${CAPTURE_DIRECT_REPLACEMENT_CUE_SOURCE})`;
const CAPTURE_CORRECTION_DISCOURSE_PREFIX = new RegExp(
  `^(?:${CAPTURE_CORRECTION_DISCOURSE_SOURCE}\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE})+`,
  "iu",
);
const CAPTURE_CORRECTION_DISCOURSE_CUE = new RegExp(
  `^(?:${CAPTURE_CORRECTION_DISCOURSE_SOURCE}\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE})+`,
  "iu",
);
const CAPTURE_DIRECT_REPLACEMENT_PREFIX = new RegExp(
  `^${CAPTURE_DIRECT_REPLACEMENT_CUE_SOURCE}\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE}$`,
  "iu",
);
const CAPTURE_DIRECT_REPLACEMENT_CUE = new RegExp(
  `^${CAPTURE_DIRECT_REPLACEMENT_CUE_SOURCE}\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE}`,
  "iu",
);
const CAPTURE_LEADING_FILLER_PREFIX = new RegExp(
  `^(?:(?:${CAPTURE_CORRECTION_FILLER_SOURCE})\\b(?:\\s*[,;:.…—–-])*\\s*)+`,
  "iu",
);
const CAPTURE_TRAILING_FILLER_SUFFIX = new RegExp(
  `(?:[,;:.…—–-]*\\s*(?:${CAPTURE_CORRECTION_FILLER_SOURCE})\\b)+[.!…\\s]*$`,
  "iu",
);

function normalizeCaptureCorrectionPauses(text: string) {
  return text.replace(
    new RegExp(`(${CAPTURE_ANY_CORRECTION_CUE_SOURCE}\\b)${CAPTURE_CORRECTION_CUE_NOISE_SOURCE}`, "giu"),
    "$1 ",
  );
}

function trailingCaptureCorrectionDiscourseStart(text: string) {
  const match = new RegExp(
    `(?:^|[.!?;]\\s*|\\r?\\n+)(?:(?:${CAPTURE_CORRECTION_FILLER_SOURCE})\\b(?:\\s*[,;:.…—–-])*\\s*)*(${CAPTURE_ANY_CORRECTION_CUE_SOURCE})\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE}$`,
    "iu",
  ).exec(text);
  return match?.index === undefined || !match[1] ? undefined : match.index + match[0].indexOf(match[1]);
}

function isDirectPostRetractionCaptureReplacement(
  key: keyof CapturedLead,
  clause: string,
  candidate: { start: number; end: number },
) {
  const before = clause
    .slice(0, candidate.start)
    .trim()
    .replace(/^[,;:—–-]+|[,;:—–-]+$/gu, "")
    .trim()
    .replace(CAPTURE_LEADING_FILLER_PREFIX, "")
    .trim()
    .replace(CAPTURE_CORRECTION_DISCOURSE_PREFIX, "")
    .trim();
  const after = clause.slice(candidate.end).trim();
  const afterWithoutFiller = after.replace(CAPTURE_TRAILING_FILLER_SUFFIX, "").trim();
  const fieldPrefixes: Record<keyof CapturedLead, RegExp> = {
    name: /^(?:my\s+(?:(?:correct|preferred)\s+)*(?:full\s+)?name\s+(?:is|should\s+be)|call\s+me|i\s+am|i['’]?m)$/iu,
    email:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*e-?mail(?:\s+address)?\s+(?:is|should\s+be)|contact\s+me\s+at|reach\s+me\s+at)$/iu,
    org: /^(?:(?:my|our)\s+(?:organisation|organization|company|org)\s+(?:is|should\s+be)|we\s+are|we['’]?re)$/iu,
    phone:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*(?:phone(?:\s+number)?|mobile|number)\s+(?:is|should\s+be)|call\s+me\s+at)$/iu,
    website:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*(?:website|web\s*site|url|site)\s+(?:is|should\s+be))$/iu,
    message: /^(?:my\s+(?:(?:correct|preferred|current)\s+)*(?:message|brief|idea|notes?)\s+(?:is|should\s+be))$/iu,
  };
  const suffixes: Record<keyof CapturedLead, RegExp> = {
    name: /^(?:(?:is|should\s+be)\s+my\s+(?:full\s+)?name\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
    email:
      /^(?:(?:(?:is|should\s+be)\s+my\s+e-?mail(?:\s+address)?|(?:is|was)\s+mine|belongs?\s+to\s+me)\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
    org: /^(?:(?:is|should\s+be)\s+my\s+(?:organisation|organization|company|org)\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
    phone:
      /^(?:(?:is|should\s+be)\s+my\s+(?:phone(?:\s+number)?|mobile|number)\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
    website:
      /^(?:(?:is|should\s+be)\s+my\s+(?:website|web\s*site|url|site)\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
    message:
      /^(?:(?:is|should\s+be)\s+my\s+(?:message|brief|idea|notes?)\b)?[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu,
  };
  const contrastiveSuffix = /^(?:[,;:—–-]?\s*(?:not|instead\s+of|rather\s+than)\b).+$/iu;
  const affirmingSuffix = /^(?:(?:is|was)\s+(?:right|correct))[.!\s]*(?:please|thanks?|thank\s+you)?[.!\s]*$/iu;
  const terminallyDecisiveAfter = afterWithoutFiller.replace(/^instead[.!\s]*$/iu, "");
  return (
    (!before || CAPTURE_DIRECT_REPLACEMENT_PREFIX.test(before) || fieldPrefixes[key].test(before)) &&
    (suffixes[key].test(terminallyDecisiveAfter) ||
      contrastiveSuffix.test(afterWithoutFiller) ||
      affirmingSuffix.test(afterWithoutFiller))
  );
}

function laterDirectCaptureCorrectionSupersedes(key: keyof CapturedLead, value: string, text: string) {
  const fieldCues: Record<keyof CapturedLead, RegExp> = {
    name: /^(?:my\s+(?:(?:correct|preferred)\s+)*(?:full\s+)?name\s+(?:is|should\s+be)|call\s+me|i\s+am|i['’]?m|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
    email:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*e-?mail(?:\s+address)?\s+(?:is|should\s+be)|contact\s+me\s+at|reach\s+me\s+at|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
    org: /^(?:(?:my|our)\s+(?:organisation|organization|company|org)\s+(?:is|should\s+be)|we\s+are|we['’]?re|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
    phone:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*(?:phone(?:\s+number)?|mobile|number)\s+(?:is|should\s+be)|call\s+me\s+at|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
    website:
      /^(?:my\s+(?:(?:correct|preferred|primary|current)\s+)*(?:website|web\s*site|url|site)\s+(?:is|should\s+be)|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
    message:
      /^(?:my\s+(?:(?:correct|preferred|current)\s+)*(?:message|brief|idea|notes?)\s+(?:is|should\s+be)|it(?:\s+is|['’]s))\b[,;:—–-]*\s*/iu,
  };
  const plausibleNominal = (candidate: string) => {
    const words = candidate.match(/[\p{Letter}\p{Number}&'’-]+/gu) ?? [];
    if (words.length === 0 || words.length > 6) return false;
    return !words.some((word) =>
      /^(?:a|an|the|event|meeting|workshop|call|date|time|today|tomorrow|yesterday|changed?|changing|attend(?:ing|ed)?|is|are|was|were|will|would|should|can|could|please|this|that|it)$/iu.test(
        word,
      ),
    );
  };
  const plausibleGenericNominal = (candidate: string) => {
    const words = candidate.match(/[\p{Letter}\p{Number}&'’-]+/gu) ?? [];
    return (
      plausibleNominal(candidate) &&
      words.length > 0 &&
      !words.some((word) =>
        /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|venue|parking|logistics|arrangements?|schedule|booking|reservation|deadline|delivery|invoice|budget|price|cost|weather|morning|afternoon|evening|night)$/iu.test(
          word,
        ),
      )
    );
  };
  return (normalizeCaptureCorrectionPauses(text).match(/[^.!?;\r\n]+(?:[.!?;]+|$)/gu) ?? [])
    .map((clause) =>
      clause
        .trim()
        .replace(/^[,;:—–-]+/gu, "")
        .replace(CAPTURE_LEADING_FILLER_PREFIX, "")
        .trim(),
    )
    .filter(Boolean)
    .some((clause) => {
      if (
        /\?\s*$/u.test(clause) ||
        /\b(?:maybe|perhaps|possibly|probably|i\s+(?:think|guess|suppose))\b/iu.test(clause)
      ) {
        return false;
      }
      const fieldClause = clause.replace(CAPTURE_CORRECTION_DISCOURSE_PREFIX, "").trim();
      const fieldCue = fieldClause.match(fieldCues[key]);
      const directCue = fieldClause.match(CAPTURE_DIRECT_REPLACEMENT_CUE);
      const generic = clause.match(CAPTURE_CORRECTION_DISCOURSE_CUE);
      const cue = fieldCue ?? directCue ?? generic;
      if (!cue) return false;
      const replacementSource = fieldCue || directCue ? fieldClause : clause;
      const replacement = replacementSource
        .slice(cue[0].length)
        .replace(/[,;:—–-]?\s*(?:please|thanks?|thank\s+you)[.!\s]*$/iu, "")
        .replace(CAPTURE_TRAILING_FILLER_SUFFIX, "")
        .trim();
      if (!replacement) return false;
      if (normalizeEvidence(replacement) === normalizeEvidence(value)) return false;
      if (key === "email") {
        return getLiteralEmailMentions(replacement).length > 0 || containsSpokenEmailShape(replacement);
      }
      if (key === "phone") return replacement.replace(/\D/gu, "").length >= 7;
      if (key === "website") {
        return /(?:https?:\/\/|www\.|[\p{Letter}\p{Number}-]+\.[\p{Letter}]{2,})/iu.test(replacement);
      }
      if (key === "message") return Boolean(fieldCue);
      if (!fieldCue) {
        return plausibleGenericNominal(replacement);
      }
      return plausibleNominal(replacement);
    });
}

function freeTextCaptureHasPostEditSupport(
  key: keyof CapturedLead,
  value: string,
  evidence: string,
  recentUserText: string,
) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "for",
    "is",
    "it",
    "of",
    "please",
    "required",
    "the",
    "to",
  ]);
  const terms = (input: string) =>
    input
      .toLowerCase()
      .match(/[\p{Letter}\p{Number}]{3,}/gu)
      ?.filter((term) => !stopWords.has(term)) ?? [];
  const valueTerms = [...new Set(terms(value))];
  const clauses = recentUserText
    .split(/(?:[!?;]+|[.]+\s+(?=[A-Z]))/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const compact = (input: string) => input.toLowerCase().replace(/\s+/gu, "");
  const digits = value.replace(/\D/gu, "");
  const website = value
    .toLowerCase()
    .replace(/^https?:\/\//u, "")
    .replace(/^www\./u, "")
    .replace(/\/$/u, "");
  const relevantClause =
    key === "phone"
      ? (clauses.findLast((clause) => digits.length >= 6 && clause.replace(/\D/gu, "").includes(digits)) ?? "")
      : key === "website"
        ? (clauses.findLast((clause) => website.length >= 4 && compact(clause).includes(website)) ?? "")
        : (clauses
            .map((clause, index) => ({ clause, index }))
            .toSorted((left, right) => {
              const overlap = (clause: string) => {
                const clauseTerms = new Set(terms(clause));
                return valueTerms.filter((term) => clauseTerms.has(term)).length;
              };
              return overlap(right.clause) - overlap(left.clause) || right.index - left.index;
            })[0]?.clause ?? "");
  if (!relevantClause) return false;
  const normalizedUserText = normalizeEvidence(relevantClause);
  const candidateExplicitlyRejected = captureCandidateIsExplicitlyRejected(key, value, relevantClause);
  const hasNegativePolarity = (input: string) =>
    /\b(?:no|not|never|without|cannot|can['’]?t|cant|do\s+not|don['’]?t|dont|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t)\b/iu.test(
      input,
    );
  const messagePolarityMismatch =
    key === "message" && hasNegativePolarity(relevantClause) !== hasNegativePolarity(value);
  const rejectsValue =
    candidateExplicitlyRejected ||
    messagePolarityMismatch ||
    /\b(?:do\s+not|don['’]?t|dont|never)\s+(?:use|save|keep|record|need)\b|\b(?:no\s+need\s+for|not\s+(?:mine|ours|our|my|the\s+one|needed|required))\b/iu.test(
      relevantClause,
    ) ||
    (!normalizeEvidence(value).includes("without") &&
      /\bwithout\b/iu.test(relevantClause) &&
      valueTerms.some((term) => new RegExp(`\\bwithout\\b.{0,32}\\b${term}\\b`, "iu").test(relevantClause)));
  if (key === "phone") {
    return !rejectsValue;
  }
  if (key === "website") {
    return !rejectsValue;
  }
  const userTerms = new Set(terms(relevantClause));
  const overlap = valueTerms.filter((term) => userTerms.has(term)).length;
  const evidenceGrounded = !evidence || approxIncludes(normalizedUserText, normalizeEvidence(evidence), 0.2);
  return !rejectsValue && evidenceGrounded && valueTerms.length > 0 && overlap >= Math.min(2, valueTerms.length);
}

function clearLocalFieldEditAuthority(state: VoiceRuntimeState, key: keyof CapturedLead): VoiceRuntimeState {
  if (state.localFieldEditUserTurnSequences?.[key] === undefined) return state;
  const nextSequences = { ...state.localFieldEditUserTurnSequences };
  delete nextSequences[key];
  return {
    ...state,
    localFieldEditUserTurnSequences: Object.keys(nextSequences).length > 0 ? nextSequences : undefined,
  };
}

function latestUserAuthorityText(state: VoiceRuntimeState, boundary?: number) {
  const turns =
    boundary === undefined
      ? state.transcript.filter((entry) => entry.role === "user")
      : userTranscriptAfterTurn(state.transcript, boundary);
  return turns.at(-1)?.text.trim() ?? "";
}

function latestAssistantPromptBeforeUser(state: VoiceRuntimeState) {
  const latestUserIndex = state.transcript.findLastIndex((entry) => entry.role === "user");
  if (latestUserIndex < 1) return "";
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const entry = state.transcript[index];
    if (entry?.role === "assistant") return entry.text.trim();
    if (entry?.role === "user") return "";
  }
  return "";
}

function isAnaphoricNegativeReply(text: string) {
  return /^(?:(?:no+|nope|nah)(?:[\s,;:!-]+(?:(?:please\s+)?don['’]?t\s+do\s+(?:it|that)|not\s+(?:now|yet)|thanks?|thank\s+you|that(?:'s|\s+is)\s+(?:wrong|incorrect)))*|not\s+(?:now|yet)|(?:please\s+)?don['’]?t\s+do\s+(?:it|that))[.!?\s]*$/iu.test(
    text.trim(),
  );
}

function isAnaphoricAffirmativeReply(text: string) {
  return /^(?:yes|yeah|yep|sure|okay|ok|alright|correct|please\s+do|go\s+ahead|do\s+it)(?:[,.!\s]+(?:please|thanks?|thank\s+you|that(?:'s|\s+is)\s+(?:right|correct)))*[.!?\s]*$/iu.test(
    text.trim(),
  );
}

type AssistantAuthorityKind = "capture" | "clear" | "segment" | "route" | "end";

function propositionTargetsVisitorField(proposition: string, field: RegExp) {
  return new RegExp(`\\byour(?:\\s+[\\p{Letter}\\p{Number}-]+){0,2}\\s+${field.source}`, "iu").test(proposition);
}

function assistantSupportsCaptureCandidate(state: VoiceRuntimeState, key: keyof CapturedLead, value: string) {
  const prompt = latestAssistantPromptBeforeUser(state);
  if (!prompt) return false;
  const fieldLabels: Record<keyof CapturedLead, RegExp> = {
    name: /\bname\b/iu,
    email: /\be-?mail(?:\s+address)?\b/iu,
    org: /\b(?:organisation|organization|company|org)\b/iu,
    phone: /\b(?:phone|mobile|number)\b/iu,
    website: /\b(?:website|web\s*site|url|site)\b/iu,
    message: /\b(?:message|brief|idea|notes?)\b/iu,
  };
  const proposition = affirmedAssistantProposition(prompt, fieldLabels[key], "capture");
  if (!proposition) return false;
  if (!propositionTargetsVisitorField(proposition, fieldLabels[key])) return false;
  const fieldMentions = (Object.entries(fieldLabels) as [keyof CapturedLead, RegExp][]).flatMap(([field, label]) =>
    [...proposition.matchAll(new RegExp(label.source, "giu"))].flatMap((match) =>
      match.index === undefined ? [] : [{ field, index: match.index, end: match.index + match[0].length }],
    ),
  );
  const normalizeWithOffsets = (input: string) => {
    let normalized = "";
    const starts: number[] = [];
    const ends: number[] = [];
    let rawOffset = 0;
    for (const character of input) {
      const normalizedCharacter = character
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{Mark}/gu, "")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "");
      for (const outputCharacter of normalizedCharacter) {
        normalized += outputCharacter;
        starts.push(rawOffset);
        ends.push(rawOffset + character.length);
      }
      rawOffset += character.length;
    }
    return { normalized, starts, ends };
  };
  const normalizedProposition = normalizeWithOffsets(proposition);
  const candidateForms = [
    normalizeEvidence(value),
    ...(key === "email" || key === "website" ? [normalizeEvidence(spokenEmailForm(value))] : []),
  ].filter((form, index, forms) => form && forms.indexOf(form) === index);
  const candidateSpans = candidateForms.flatMap((form) => {
    const spans: { index: number; end: number }[] = [];
    let normalizedIndex = normalizedProposition.normalized.indexOf(form);
    while (normalizedIndex >= 0) {
      const rawStart = normalizedProposition.starts[normalizedIndex];
      const rawEnd = normalizedProposition.ends[normalizedIndex + form.length - 1];
      if (rawStart !== undefined && rawEnd !== undefined) spans.push({ index: rawStart, end: rawEnd });
      normalizedIndex = normalizedProposition.normalized.indexOf(form, normalizedIndex + 1);
    }
    return spans;
  });
  return candidateSpans.some((candidate) => {
    const nearestPrecedingField = fieldMentions
      .filter((field) => field.end <= candidate.index)
      .toSorted((left, right) => right.end - left.end)[0];
    if (nearestPrecedingField?.field === key) {
      const intervening = proposition.slice(nearestPrecedingField.end, candidate.index);
      const hasInterveningAssignment =
        /(?:[,;]|\b(?:and|plus|with|along\s+with|but)\b)\s+(?:(?:the|your|my)\s+)?[\p{Letter}][\p{Letter}\p{Number}'’_-]*(?:\s+[\p{Letter}][\p{Letter}\p{Number}'’_-]*){0,2}(?:\s+(?:is|as))?\s*$/iu.test(
          intervening,
        );
      if (!hasInterveningAssignment) return true;
    }
    if (nearestPrecedingField) return false;
    const nearestFollowingField = fieldMentions
      .filter((field) => field.index >= candidate.end)
      .toSorted((left, right) => left.index - right.index)[0];
    if (nearestFollowingField?.field !== key) return false;
    return /^\s*[,;:—–-]?\s*(?:(?:is|was)\s+(?:that\s+)?)?your(?:\s+[\p{Letter}\p{Number}-]+){0,2}\s*$/iu.test(
      proposition.slice(candidate.end, nearestFollowingField.index),
    );
  });
}

function assistantSubjectSupportsAuthority(proposition: string, cue: RegExp, kind: AssistantAuthorityKind) {
  if (kind === "capture") return /\byour\b/iu.test(proposition);
  if (kind === "segment") {
    return new RegExp(
      `(?:\\b(?:are|were|is|was)\\s+you\\s+(?:(?:primarily|mainly)\\s+)?(?:(?:a|an|in|with)\\s+)?(?:${cue.source})|\\byou\\s+(?:are|were|work|operate|identify|belong)(?:\\s+(?:as|in|with|to))?\\s+(?:(?:a|an)\\s+)?(?:${cue.source})|\\byour\\s+(?:company|organisation|organization|team|work|segment|sector|field|focus)\\s+(?:(?:is|was|works?|operates?|belongs?|focuses?)\\s+)?(?:(?:in|on|with|as)\\s+)?(?:(?:a|an)\\s+)?(?:${cue.source})|^\\s*(?:is|was|would|could|should)\\s+(?:${cue.source})\\s+(?:your\\s+(?:company|organisation|organization|team|work|segment|sector|field|focus))\\s*$)`,
      "iu",
    ).test(proposition);
  }
  const actorSupported = new RegExp(
    `^(?:(?:and|so)\\s+)?(?:(?:should|can|could|would|will|may|shall)\\s+(?:i|we)\\s+(?:(?:please|now|just)\\s+)?(?:${cue.source})|ready\\s+for\\s+(?:me|us)\\s+to\\s+(?:${cue.source})|(?:do|did|would)\\s+you\\s+(?:want|need|like|ask|tell)\\s+(?:me|us)\\s+(?:to\\s+)?(?:${cue.source})|(?:i|we)\\s+(?:can|could|will|would|should|shall|may|might|plan|intend)\\s+(?:to\\s+)?(?:(?:please|now|just)\\s+)?(?:${cue.source})|(?:i|we)\\s+(?:am|are|was|were)\\s+(?:ready|going|prepared|about)\\s+to\\s+(?:${cue.source})|you\\s+(?:want|need|asked|told|would\\s+like)\\s+(?:me|us)\\s+to\\s+(?:${cue.source}))`,
    "iu",
  ).test(proposition);
  if (!actorSupported) return false;
  if (kind === "route") {
    return /\b(?:send|submit|route|share|forward)\b\s+(?:it|(?:this|that)\s+(?:form|details?|lead|enquiry|request|information)|these\s+(?:details?|fields?)|your\s+(?:form|details?|enquiry|request|information)|the\s+(?:form|details?|lead|enquiry|request|information))\b/iu.test(
      proposition,
    );
  }
  if (kind === "end") {
    return /\b(?:end|stop|cancel)\b(?=\s*(?:(?:(?:the|this|our|your)\s+)?(?:call|session|conversation|voice)\b|[?.!,]|$))|\bhang\s+up\b|\b(?:goodbye|bye|done|that['’]?s\s+all)\b/iu.test(
      proposition,
    );
  }
  return true;
}

function affirmedAssistantProposition(prompt: string, cue: RegExp, kind: AssistantAuthorityKind) {
  const questionMark = prompt.lastIndexOf("?");
  if (questionMark < 0) return undefined;
  const clauses = prompt
    .slice(0, questionMark)
    .split(/[.!?]\s+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const question = clauses.at(-1) ?? "";
  const genericConfirmation = (text: string) =>
    /^(?:(?:and|so)\s+)?(?:(?:is|was)\s+that\s+(?:right|correct|okay)|(?:right|correct|okay)|does\s+that\s+sound\s+(?:right|correct|okay)|have\s+i\s+got\s+that\s+right)\b/iu.test(
      text.trim(),
    );
  const immediateReferent = (text: string) => {
    const trimmed = text.trim();
    if (
      /^(?:used\s+to|formerly|previously|earlier|originally|historically|in\s+the\s+past|back\s+then|at\s+the\s+time)\s*,/iu.test(
        trimmed,
      )
    ) {
      return trimmed;
    }
    const parts = text.split(
      /(?:;|:|[—–]|\r?\n+)\s*|,\s*(?=(?:(?:and|but|then|so)\s+)?(?:i|you|we|they|he|she|it|my|your|our|their|his|her|its|the|this|that|these|those)\b)/iu,
    );
    return parts.at(-1)?.trim() ?? "";
  };
  const inlineGenericConfirmation = question.match(
    /(?:^|[;,]\s*)(?:(?:and|so)\s+)?(?:(?:is|was)\s+that\s+(?:right|correct|okay)|(?:right|correct|okay)|does\s+that\s+sound\s+(?:right|correct|okay)|have\s+i\s+got\s+that\s+right)\b.*$/iu,
  );
  let proposition = "";
  if (genericConfirmation(question)) {
    proposition = immediateReferent(clauses.at(-2) ?? "");
  } else if (inlineGenericConfirmation?.index !== undefined && inlineGenericConfirmation.index > 0) {
    proposition = immediateReferent(question.slice(0, inlineGenericConfirmation.index));
  } else if (question.match(cue)) {
    proposition = question;
  }
  if (!proposition || !cue.test(proposition)) return undefined;
  if (/\b(?:who|whose|what|which|where|when|why|how)\b/iu.test(proposition) && !/^how\s+about\b/iu.test(proposition)) {
    return undefined;
  }
  if (
    /\b(?:or|rather\s+than|instead\s+of|other\s+than|as\s+opposed\s+to|in\s+contrast\s+to|compared\s+(?:with|to)|versus|vs\.?|anything\s+but|except(?:\s+for)?|excluding)\b/iu.test(
      proposition,
    )
  ) {
    return undefined;
  }
  if (
    /\b(?:wait|hold|pause|later|before|after|until|unless|if|when|once|while|in\s+case|prior(?:ly|\s+to)?|used\s+to|formerly|previously|earlier|originally|historically|in\s+the\s+past|back\s+then|at\s+the\s+time|so\s+that|unsure|uncertain|not\s+sure|whether|maybe|perhaps|possibly|eventually|someday|draft|tentative)\b/iu.test(
      proposition,
    )
  ) {
    return undefined;
  }
  const negative =
    "(?:not|never|no\\s+longer|do\\s+not|ain['’]?t|aren['’]?t|can(?:not|['’]?t)|couldn['’]?t|daren['’]?t|didn['’]?t|doesn['’]?t|don['’]?t|hadn['’]?t|hasn['’]?t|haven['’]?t|isn['’]?t|mightn['’]?t|mustn['’]?t|needn['’]?t|oughtn['’]?t|shan['’]?t|shouldn['’]?t|wasn['’]?t|weren['’]?t|won['’]?t|wouldn['’]?t|declin(?:e|es|ed|ing)|refus(?:e|es|ed|ing)|reject(?:s|ed|ing)?|(?:say|says|said|saying)\\s+no\\s+to|object(?:s|ed|ing)?\\s+to|oppos(?:e|es|ed|ing)|with(?:hold|holds|held|holding)|den(?:y|ies|ied|ying)|disallow(?:s|ed|ing)?|forb(?:id|ids|ade|idden|idding)|retract(?:s|ed|ing)?|opt(?:s|ed|ing)?\\s+out\\s+of)";
  if (
    new RegExp(`\\b${negative}\\b.{0,48}(?:${cue.source})|(?:${cue.source}).{0,48}\\b${negative}\\b`, "iu").test(
      proposition,
    )
  ) {
    return undefined;
  }
  const cueMatch = proposition.match(cue);
  if (!cueMatch || cueMatch.index === undefined) return undefined;
  const beforeCue = proposition.slice(0, cueMatch.index);
  const clauseStart = Math.max(beforeCue.lastIndexOf(","), beforeCue.lastIndexOf(";"), beforeCue.lastIndexOf(":")) + 1;
  if (
    /\b(?:before|after|while|if|unless|when|once|until|in\s+case|prior\s+to|so\s+that)\b/iu.test(
      beforeCue.slice(clauseStart),
    )
  ) {
    return undefined;
  }
  const afterCue = proposition.slice(cueMatch.index + cueMatch[0].length);
  const competingQuestion = afterCue.match(
    /\b(?:who|whose|what|which|where|when|why|how|should|can|could|would|do|does|did|are|is|will|have|has)\b/iu,
  );
  if (competingQuestion?.index !== undefined) {
    const trailingQuestion = afterCue.slice(competingQuestion.index);
    if (!genericConfirmation(trailingQuestion)) return undefined;
  }
  if (!assistantSubjectSupportsAuthority(proposition, cue, kind)) return undefined;
  return proposition;
}

function assistantPromptAffirmsCue(prompt: string, cue: RegExp, kind: AssistantAuthorityKind) {
  return Boolean(affirmedAssistantProposition(prompt, cue, kind));
}

function assistantAffirmativelyAsksAbout(state: VoiceRuntimeState, cue: RegExp, kind: AssistantAuthorityKind) {
  const prompt = latestAssistantPromptBeforeUser(state);
  return Boolean(prompt && assistantPromptAffirmsCue(prompt, cue, kind));
}

function isAnaphoricActionRetractionClause(text: string) {
  return /^(?:(?:(?:actually|sorry|well|wait|on\s+second\s+thought|thinking\s+again)\s*[,;:—–-]?\s+)?(?:no|nope|nah|not\s+(?:now|yet)|maybe\s+not|perhaps\s+not|do\s+not|don['’]?t|dont|wait|later|hold\s+on|keep\s+(?:it|that|talking|going)|continue)\b|never\s+mind\b|(?:i\s+)?(?:please\s+)?(?:scratch|strike|forget|cancel|disregard|ignore|retract)\s+(?:that|it|this|all\s+of\s+(?:that|this|it)|everything(?:\s+(?:that\s+)?i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)?|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?|my\s+(?:last|previous)\s+(?:answer|statement|response)|the\s+(?:last|previous)\s+(?:answer|statement|bit|part|thing))\b|(?:i\s+)?(?:have\s+)?changed\s+my\s+mind\b|(?:i\s+)?take\s+(?:(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)\s+back|back\s+(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?|my\s+(?:last|previous)\s+(?:answer|statement|response)|the\s+(?:last|previous)\s+(?:answer|statement|bit|part|thing)))\b|let['’]?s\s+not\b)/iu.test(
    text.trim(),
  );
}

function hasTrailingAnaphoricActionRetraction(text: string) {
  const clauses = text
    .split(/(?:[!?;]+|[.]+\s+|[—–]\s*)/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.slice(1).some(isAnaphoricActionRetractionClause)) return true;
  return text
    .split(
      /(?=\b(?:actually|sorry|well|wait|on\s+second\s+thought|thinking\s+again|never\s+mind|scratch\s+that|strike\s+that|forget\s+that|retract\s+that|cancel\s+that|take\s+that\s+back|i\s+changed\s+my\s+mind)\b)/iu,
    )
    .slice(1)
    .some(isAnaphoricActionRetractionClause);
}

function captureHasTrailingAnaphoricRetraction(args: Record<string, unknown>, text: string) {
  const normalizedText = text.toLocaleLowerCase();
  const candidateSpans: Array<{ start: number; end: number }> = [];
  const value = typeof args.value === "string" ? args.value.trim() : "";
  const evidence = typeof args.evidence === "string" ? args.evidence.trim() : "";
  const literalCandidates = value ? [value] : evidence ? [evidence] : [];
  for (const candidate of literalCandidates) {
    const normalizedCandidate = candidate.toLocaleLowerCase();
    let index = normalizedText.indexOf(normalizedCandidate);
    while (index >= 0) {
      candidateSpans.push({ start: index, end: index + candidate.length });
      index = normalizedText.indexOf(normalizedCandidate, index + 1);
    }
  }
  if (candidateSpans.length === 0) return hasTrailingAnaphoricActionRetraction(text);

  const retractionPattern =
    /\b(?:(?:actually|sorry|well|wait|on\s+second\s+thought|thinking\s+again)\s*[,;:—–-]?\s+(?:no|nope|nah|not\s+(?:now|yet)|maybe\s+not|perhaps\s+not|do\s+not|don['’]?t|dont|wait|later|hold\s+on|keep\s+(?:it|that|talking|going)|continue)|never\s+mind|(?:i\s+)?(?:please\s+)?(?:scratch|strike|forget|cancel|disregard|ignore|retract)\b(?:\s+(?:that|it|this|all\s+of\s+(?:that|this|it)|everything(?:\s+(?:that\s+)?i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)?|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?|my\s+(?:last|previous)\s+(?:answer|statement|response)|the\s+(?:last|previous)\s+(?:answer|statement|bit|part|thing)))?|(?:i\s+)?(?:have\s+)?changed\s+my\s+mind|(?:i\s+)?take\s+(?:(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)\s+back|back\s+(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?|my\s+(?:last|previous)\s+(?:answer|statement|response)|the\s+(?:last|previous)\s+(?:answer|statement|bit|part|thing)))|let['’]?s\s+not)\b/giu;
  const key = toCapturedKey(args.key);
  const fieldLabels: Record<keyof CapturedLead, RegExp> = {
    name: /\b(?:my|our)\s+(?:full\s+)?name\b/iu,
    email: /\b(?:my|our)\s+e-?mail(?:\s+address)?\b/iu,
    org: /\b(?:my|our)\s+(?:organisation|organization|company|org)\b/iu,
    phone: /\b(?:my|our)\s+(?:phone(?:\s+number)?|mobile|number)\b/iu,
    website: /\b(?:my|our)\s+(?:website|web\s*site|url|site)\b/iu,
    message: /\b(?:my|our)\s+(?:message|brief|idea|notes?)\b/iu,
  };
  const fieldObjectAliases: Record<keyof CapturedLead, RegExp> = {
    name: /\b(?:full\s+)?name\b/iu,
    email: /\b(?:e-?mail(?:\s+address)?|contact\s+address)\b/iu,
    org: /\b(?:organisation|organization|business|company|org)\b/iu,
    phone: /\b(?:phone(?:\s+number)?|mobile(?:\s+number)?|telephone(?:\s+number)?|contact\s+number|number)\b/iu,
    website: /\b(?:website|web\s*site|url|domain|link|site)\b/iu,
    message: /\b(?:message|brief|idea|notes?)\b/iu,
  };
  const retractionTargetsFieldObject = (field: keyof CapturedLead, clause: string) => {
    const qualifier =
      /(?:^|\b(?:about|regarding|over|using|use|change|update|correct|replace|cancel|scratch|forget)\s+)\s*(?:(?:a|an|the|that|this|my|our|another|different|new|current|which|other|own|personal|work|business|primary|preferred|correct|right|updated|alternate|alternative)\s+)*$/iu;
    for (const match of clause.matchAll(new RegExp(fieldObjectAliases[field].source, "giu"))) {
      const index = match.index ?? 0;
      const before = clause.slice(0, index);
      const after = clause.slice(index + match[0].length);
      if (!qualifier.test(before)) continue;
      const ownership = after.match(
        /^\s+(?:of|for)\s+(?:(?:a|an|the|that|this|my|our)\s+)?([\p{Letter}\p{Number}-]+)/iu,
      )?.[1];
      if (ownership && !/^(?:me|mine|visitor|contact)$/iu.test(ownership)) continue;
      return true;
    }
    return false;
  };
  for (const retraction of text.matchAll(retractionPattern)) {
    const start = retraction.index ?? 0;
    const end = start + retraction[0].length;
    const overlappingCandidate = candidateSpans.find((candidate) => candidate.start <= start && candidate.end >= end);
    if (overlappingCandidate) {
      const literalTail = text.slice(end, overlappingCandidate.end);
      const substantialTail =
        literalTail
          .match(/[\p{Letter}\p{Number}]{3,}/gu)
          ?.filter((term) => !/^(?:about|and|for|from|into|now|please|that|the|then|this|with)$/iu.test(term)) ?? [];
      const literalHeadTerms =
        text
          .slice(overlappingCandidate.start, start)
          .match(/[\p{Letter}\p{Number}]{3,}/gu)
          ?.filter((term) => !/^(?:and|for|from|into|now|please|that|the|then|this|with)$/iu.test(term)) ?? [];
      const discourseNegative = /\b(?:actually|sorry|well|wait)\b.{0,16}\b(?:no|nope|nah)\b/iu.test(retraction[0]);
      const fieldObjectInTail =
        key !== null &&
        (retractionTargetsFieldObject(key, literalTail) ||
          new RegExp(`^\\s*${fieldObjectAliases[key].source}\\s*$`, "iu").test(literalTail));
      const repeatsLiteralHead = substantialTail.some((term) =>
        literalHeadTerms.some((head) => head.localeCompare(term, undefined, { sensitivity: "base" }) === 0),
      );
      const explicitlyGovernedMessageLiteral =
        key === "message" &&
        fieldLabels.message.test(text.slice(Math.max(0, overlappingCandidate.start - 80), overlappingCandidate.start));
      if (
        (!discourseNegative || explicitlyGovernedMessageLiteral) &&
        substantialTail.length > 0 &&
        !fieldObjectInTail &&
        !repeatsLiteralHead
      ) {
        continue;
      }
    }
    const laterText = text.slice(end);
    const currentClause = laterText.split(/[.!?;]/u)[0] ?? "";
    const clauseEnd = end + currentClause.length;
    const candidateInClause = candidateSpans.find(
      (candidate) => candidate.start >= end && candidate.start <= clauseEnd,
    );
    const candidateAfterRetraction = candidateSpans.find((candidate) => candidate.start >= end);
    const fieldMentionedInClause =
      key !== null && (fieldLabels[key].test(currentClause) || retractionTargetsFieldObject(key, currentClause));
    // A correction marker revokes the earlier span, not a new bare answer
    // after it: “Alice. Actually no, Carol.” selects Carol. Explicitly
    // rejecting the later candidate (“Carol is wrong” / “forget Carol”) is
    // still caught before accepting it.
    if (candidateAfterRetraction && key !== null) {
      const candidateStart = candidateAfterRetraction.start - end;
      const candidateEnd = candidateAfterRetraction.end - end;
      const precedingText = laterText.slice(0, candidateStart);
      const precedingBoundaries = Array.from(precedingText.matchAll(/(?:[.!?;]\s*|\r?\n+)/gu));
      const correctionDiscourseStart = trailingCaptureCorrectionDiscourseStart(precedingText);
      const candidateClauseStart =
        correctionDiscourseStart ??
        (precedingBoundaries.at(-1)
          ? (precedingBoundaries.at(-1)?.index ?? 0) + (precedingBoundaries.at(-1)?.[0].length ?? 0)
          : 0);
      const terminator = laterText.slice(candidateEnd).match(/[.!?;]/u);
      const candidateClauseEnd =
        terminator?.index === undefined ? laterText.length : candidateEnd + terminator.index + terminator[0].length;
      const candidateClause = laterText.slice(candidateClauseStart, candidateClauseEnd);
      const directReplacement = isDirectPostRetractionCaptureReplacement(key, candidateClause, {
        start: candidateStart - candidateClauseStart,
        end: candidateEnd - candidateClauseStart,
      });
      if (
        directReplacement &&
        !captureCandidateIsExplicitlyRejected(key, value, candidateClause) &&
        !laterDirectCaptureCorrectionSupersedes(key, value, text.slice(candidateAfterRetraction.end))
      ) {
        continue;
      }
    }
    if (candidateInClause || fieldMentionedInClause) return true;

    const explicitlyUnrelatedObject =
      /\b(?:about|regarding|over)\s+(?:the\s+)?[\p{Letter}\p{Number}]/iu.test(currentClause) ||
      /\b(?:cancel|book|reschedule|attend|skip|move|change|forget)\s+(?:the|my|our|that)\s+[\p{Letter}\p{Number}]/iu.test(
        currentClause,
      ) ||
      (/\b(?:scratch|forget|cancel|disregard|ignore)\b/iu.test(retraction[0]) &&
        Boolean(currentClause.match(/[\p{Letter}\p{Number}]{3,}/u)));
    if (!explicitlyUnrelatedObject) return true;
  }
  return false;
}

function latestIntentClause(text: string, intent: RegExp) {
  const clauses = text
    .split(
      /(?:[!?;]+|[.]+\s+|(?:,\s*(?:(?:and|then)\s+)?|\b(?:and|then)\s+)(?=(?:(?:i|we)\s+(?:think|believe|guess)\s+(?:you|we)\s+(?:should|can|could|would|will)\s+)?(?:please\s+)?(?:send|submit|route|share|forward|clear|delete|remove|erase|forget|wipe|start|end|stop|cancel|hang|go|do|ready|look)))/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
  const firstIntentIndex = clauses.findIndex((clause) => intent.test(clause));
  if (firstIntentIndex >= 0 && clauses.slice(firstIntentIndex + 1).some(isAnaphoricActionRetractionClause)) {
    return text.trim();
  }
  const intentIndex = clauses.findLastIndex((clause) => intent.test(clause));
  return intentIndex >= 0 ? (clauses[intentIndex] ?? text.trim()) : text.trim();
}

function clearWouldOverrideLocalFieldEdit(state: VoiceRuntimeState, key: keyof CapturedLead) {
  const strictBoundary = localEditBoundary(state, key);
  const boundary = strictBoundary ?? trackedCurrentUserTurnBoundary(state);
  if (boundary === undefined) return false;
  const text = latestUserAuthorityText(state, boundary);
  const fieldLabels: Record<keyof CapturedLead, RegExp> = {
    name: /\b(?:name)\b/iu,
    email: /\b(?:e-?mail(?:\s+address)?|address)\b/iu,
    org: /\b(?:organisation|organization|company|org)\b/iu,
    phone: /\b(?:phone(?:\s+number)?|number|mobile)\b/iu,
    website: /\b(?:website|web\s*site|url|site)\b/iu,
    message: /\b(?:message|brief|idea|notes?)\b/iu,
  };
  if (strictBoundary === undefined && isAnaphoricAffirmativeReply(text)) {
    const prompt = latestAssistantPromptBeforeUser(state);
    const proposition = affirmedAssistantProposition(prompt, /\b(?:clear|delete|remove|erase|forget)\b/iu, "clear");
    if (
      proposition &&
      new RegExp(
        `\\b(?:clear|delete|remove|erase|forget)\\b\\s+(?:only\\s+)?your(?:\\s+[\\p{Letter}\\p{Number}-]+){0,2}\\s+${fieldLabels[key].source}`,
        "iu",
      ).test(proposition)
    ) {
      return false;
    }
  }
  const intent = latestIntentClause(text, /\b(?:clear|delete|remove|erase|forget)\b/iu);
  return !isAffirmativeClearIntent(intent, fieldLabels[key], false);
}

function localAuthorityBoundaries(state: VoiceRuntimeState) {
  return [
    ...Object.values(state.localFieldEditUserTurnSequences ?? {}),
    state.localSegmentEditUserTurnSequence,
    state.localMutationBoundaryUserTurnSequence,
    state.deferredAuthorityUserTurnBoundary,
  ].filter((value): value is number => typeof value === "number");
}

function assistantRouteSupportsSegment(state: VoiceRuntimeState, segment: SegmentId) {
  const prompt = latestAssistantPromptBeforeUser(state);
  const proposition = affirmedAssistantProposition(
    prompt,
    /\b(?:send|submit|route|share|forward|go\s+ahead)\b/iu,
    "route",
  );
  if (!proposition) return false;
  const cues: Record<SegmentId, RegExp> = {
    tenancy: /\b(?:tenancy|tenant|space|venue|rent|rental)\b/iu,
    education: /\b(?:education|school|student|teacher|learning|training)\b/iu,
    programme: /\b(?:programme|program|event|workshop|initiative)\b/iu,
    technology: /\b(?:technology|tech|digital|software|hardware|ai|robotics)\b/iu,
    community: /\b(?:community|ngo|nonprofit|social\s+impact|volunteer)\b/iu,
    other: /\b(?:other|something\s+else|not\s+sure)\b/iu,
  };
  const mentioned = (Object.entries(cues) as [SegmentId, RegExp][])
    .filter(([, cue]) => cue.test(proposition))
    .map(([id]) => id);
  if (mentioned.length === 0 && segment !== state.segment) return false;
  if (mentioned.length > 0 && (mentioned.length !== 1 || mentioned[0] !== segment)) return false;
  const destination = proposition.match(
    /\b(?:send|submit|route|share|forward)\b.{0,64}\b(?:to|with|via|through)\s+([^,;.!?]+)/iu,
  )?.[1];
  if (!destination) return true;
  return /^(?:(?:the\s+)?mereka(?:\s+team)?|(?:our|the)\s+team|us|(?:the\s+)?(?:tenancy|education|programme|program|technology|tech|community|other)\s+team)(?:\s+(?:now|please))?$/iu.test(
    destination.trim(),
  );
}

function hasPostLocalEditRouteIntent(state: VoiceRuntimeState, segment: SegmentId) {
  const boundaries = [state.localMutationBoundaryUserTurnSequence, state.deferredAuthorityUserTurnBoundary].filter(
    (value): value is number => typeof value === "number",
  );
  const fallbackBoundary = trackedCurrentUserTurnBoundary(state);
  if (boundaries.length === 0 && fallbackBoundary === undefined) return true;
  const boundary = boundaries.length > 0 ? Math.max(...boundaries) : (fallbackBoundary as number);
  const latest = latestIntentClause(
    latestUserAuthorityText(state, boundary),
    /\b(?:send|submit|route|share|forward|go\s+ahead|looks?\s+good|do\s+it|ready\s+to)\b/iu,
  );
  if (!latest) return false;
  if (boundaries.length === 0 && isAnaphoricAffirmativeReply(latest) && assistantRouteSupportsSegment(state, segment)) {
    return true;
  }
  const rejectsRoute =
    /\b(?:do\s+not|don['’]?t|dont|never|cannot|can['’]?t|cant|not\s+yet|not\s+ready|not\s+to|not\s+want(?:\s+you)?\s+to)\b.{0,48}\b(?:send|submit|route|share|forward)\b/iu.test(
      latest,
    ) || /\b(?:wait|hold\s+on|keep\s+(?:editing|talking)|later|maybe|perhaps)\b/iu.test(latest);
  return (
    !rejectsRoute &&
    /^(?:(?:yes|yeah|yep|okay|ok|alright|sure|please|now)[,;:.!\s-]+)*(?:(?:(?:can|could|would)\s+you(?:\s+please)?|i\s+(?:want|would\s+like)\s+(?:you\s+)?to|(?:i|we)\s+(?:think|believe|guess)\s+(?:you|we)\s+(?:should|can|could|would|will)|please)\s+)?(?:send|submit|route|share|forward)(?:\s+(?:it|this|that|these\s+details|the\s+(?:form|details?|lead)))?(?:\s+now)?(?:\s+please)?[.!?]?\s*$|^(?:(?:yes|okay|ok|alright)[,;:.!\s-]+)?(?:go\s+ahead(?:\s+and\s+(?:send|submit)(?:\s+it)?)?|looks?\s+good(?:\s+to\s+(?:send|submit))?|do\s+it|ready\s+to\s+(?:send|submit))[.!?]?\s*$/iu.test(
      latest,
    )
  );
}

function segmentAssertionHasTrailingRetraction(text: string, cue: RegExp) {
  const retractionPattern =
    /\b(?:(?:actually|sorry|well|wait|on\s+second\s+thought|thinking\s+again)\s*[,;:—–-]?\s+(?:no|nope|nah|not\s+(?:now|yet)|maybe\s+not|perhaps\s+not|do\s+not|don['’]?t|dont|wait|later|hold\s+on|keep\s+(?:it|that|talking|going)|continue)|never\s+mind|(?:i\s+)?(?:please\s+)?(?:scratch|strike|forget|cancel|disregard|ignore|retract)\s+(?:that|it|this|all\s+of\s+(?:that|this|it)|everything(?:\s+(?:that\s+)?i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)?|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?|my\s+(?:last|previous)\s+(?:answer|statement|response)|the\s+(?:last|previous)\s+(?:answer|statement|bit|part|thing))|(?:i\s+)?(?:have\s+)?changed\s+my\s+mind|(?:i\s+)?take\s+(?:(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?)\s+back|back\s+(?:that|it|this|everything|all\s+of\s+(?:that|this|it)|what\s+i\s+(?:just\s+|earlier\s+)?said(?:\s+earlier)?))|let['’]?s\s+not)\b/giu;
  for (const retraction of text.matchAll(retractionPattern)) {
    const laterClause = text.slice((retraction.index ?? 0) + retraction[0].length).split(/[.!?;]/u)[0] ?? "";
    if (
      cue.test(laterClause) ||
      /\b(?:segment|sector|industry|classification|category|type|partner\s+type|statement|assertion|claim|description|answer|label|selection|choice|response|information|details?|idea|thought|comment|remark|wording)\b/iu.test(
        laterClause,
      )
    ) {
      return true;
    }
    const substantiveTail =
      laterClause
        .match(/[\p{Letter}\p{Number}]{3,}/gu)
        ?.filter((term) => !/^(?:about|and|for|from|into|now|please|that|the|then|this|with)$/iu.test(term)) ?? [];
    if (substantiveTail.length === 0) return true;
    const explicitlyUnrelatedObject =
      /\b(?:about|regarding|over)\s+(?:the\s+)?[\p{Letter}\p{Number}]/iu.test(laterClause) ||
      /\b(?:cancel|book|reschedule|attend|skip|move|change|forget)\s+(?:the|my|our|that)\s+[\p{Letter}\p{Number}]/iu.test(
        laterClause,
      ) ||
      /\b(?:scratch|forget|cancel)\s+(?:that|it)\b/iu.test(retraction[0]);
    if (!explicitlyUnrelatedObject) return true;
  }
  return false;
}

function postLocalEditSupportsSegment(state: VoiceRuntimeState, segment: SegmentId) {
  const boundaries = [state.localMutationBoundaryUserTurnSequence, state.deferredAuthorityUserTurnBoundary].filter(
    (value): value is number => typeof value === "number",
  );
  const fallbackBoundary = trackedCurrentUserTurnBoundary(state);
  if (boundaries.length === 0 && fallbackBoundary === undefined) return true;
  const boundary = boundaries.length > 0 ? Math.max(...boundaries) : (fallbackBoundary as number);
  const latest = latestUserAuthorityText(state, boundary);
  const cues: Record<SegmentId, RegExp> = {
    tenancy: /\b(?:tenancy|tenant|space|venue|rent|rental)\b/iu,
    education: /\b(?:education|school|student|teacher|learning|training)\b/iu,
    programme: /\b(?:programme|program|event|workshop|initiative)\b/iu,
    technology: /\b(?:technology|tech|digital|software|hardware|ai|robotics)\b/iu,
    community: /\b(?:community|ngo|nonprofit|social\s+impact|volunteer)\b/iu,
    other: /\b(?:other|something\s+else|not\s+sure)\b/iu,
  };
  const targetCue = cues[segment];
  if (
    boundaries.length === 0 &&
    isAnaphoricAffirmativeReply(latest) &&
    assistantSegmentSupportsTarget(state, segment, cues)
  ) {
    return true;
  }
  const mentioned = (Object.entries(cues) as [SegmentId, RegExp][]).filter(([, cue]) => cue.test(latest));
  if (mentioned.length === 0) return segment === state.segment;

  const visitorOwned = new Set<SegmentId>();
  for (const [candidate, cue] of Object.entries(cues) as [SegmentId, RegExp][]) {
    const ownsCue = new RegExp(
      `(?:\\b(?:i\\s+am|i['’]?m|we\\s+are|we['’]?re)\\s+(?:(?:primarily|mainly)\\s+)?(?:(?:a|an|in|with)\\s+)?(?:${cue.source})|\\b(?:i|we)\\s+(?:work|operate|identify|belong|run|offer|provide|build|make|develop|deliver|teach|host)(?:\\s+(?:primarily|mainly))?(?:\\s+(?:as|in|with|to))?\\s+(?:(?:a|an)\\s+)?(?:${cue.source})|\\b(?:my|our)\\s+(?:company|organisation|organization|team|work|segment|sector|field|focus)\\s+(?:(?:is|are|works?|operates?|belongs?|focuses?|runs?|offers?|provides?|builds?|makes?|develops?|delivers?|teaches?|hosts?)\\s+)?(?:(?:primarily|mainly)\\s+)?(?:(?:in|on|with|as)\\s+)?(?:(?:a|an)\\s+)?(?:${cue.source})|^\\s*(?:${cue.source})\\s+(?:is|are)\\s+(?:my|our)\\s+(?:company|organisation|organization|team|work|segment|sector|field|focus)\\s*$)`,
      "iu",
    );
    const hasPositiveOwnedClause = [...latest.matchAll(new RegExp(ownsCue.source, "giu"))].some((match) => {
      const start = match.index ?? 0;
      const prefixClause = latest
        .slice(0, start)
        .split(/(?:[.!?;]|\r?\n+|\b(?:but|however|whereas)\b)/iu)
        .at(-1);
      if (
        /\b(?:maybe|perhaps|possibly|probably|apparently|allegedly|unsure|uncertain|whether|if|unless|suppose|suspect|guess|think|believe|wonder|ask(?:ed|s|ing)?|say|says|said|saying|tell|tells|told|telling|claim(?:ed|s|ing)?|report(?:ed|s|ing)?|suggest(?:ed|s|ing)?|mention(?:ed|s|ing)?|hear|heard|read|seem(?:ed|s|ing)?|appear(?:ed|s|ing)?|according\s+to)\b|\b(?:i\s+)?(?:(?:do\s+not|don['’]?t|dont)\s+(?:(?:really|actually|quite|entirely|exactly|honestly)\s+)?know|can(?:not|['’]?t)\s+(?:(?:really|actually|quite|entirely|exactly|honestly)\s+)?(?:say|tell)|have\s+no\s+idea)\b|\b(?:not\s+(?:(?:really|actually|quite|entirely|exactly|totally)\s+)?(?:sure|certain)|hard\s+to\s+say|could\s+be\s+wrong)\b/iu.test(
          prefixClause ?? "",
        )
      ) {
        return false;
      }
      const rawSuffix = latest.slice(start + match[0].length);
      const routeClauseBoundary = rawSuffix.search(
        /(?:[,;.!?]\s*(?:(?:and|then|so)\s+)?|\b(?:and|then|so)\s+)(?=(?:(?:i|we)\s+(?:think|believe|guess)\s+(?:you|we)\s+(?:should|can|could|would|will)\s+)?(?:please\s+)?(?:send|submit|route|share|forward|go\s+ahead|do\s+it|ready\s+to)\b)|\b(?:i|we)\s+(?:think|believe|guess)\s+(?=(?:you\s+)?(?:(?:should|can|could|would|will)\s+)?(?:please\s+)?(?:send|submit|route|share|forward)\b)/iu,
      );
      const routeVerbBoundary = rawSuffix.search(
        /\b(?:(?:yes|yeah|yep|okay|ok|alright|sure|please|now)\s+)*(?:send|submit|route|share|forward|go\s+ahead|do\s+it|ready\s+to)\b/iu,
      );
      const suffixEnd = [routeClauseBoundary, routeVerbBoundary]
        .filter((index) => index >= 0)
        .reduce((earliest, index) => Math.min(earliest, index), rawSuffix.length);
      const suffixClause = rawSuffix.slice(0, suffixEnd);
      if (segmentAssertionHasTrailingRetraction(suffixClause, cue)) return false;
      const polarityText =
        candidate === "other" ? (suffixClause ?? "").replace(/\bnot\s+sure\b/giu, "unsure") : (suffixClause ?? "");
      return !(
        /^(?:.{0,24}\b(?:is\s+not|isn['’]?t|are\s+not|aren['’]?t|not\s+(?:ours?|for\s+us|what\s+we\s+do))\b)/iu.test(
          polarityText,
        ) ||
        /\b(?:maybe|perhaps|possibly|probably|apparently|allegedly|unsure|uncertain|whether|if|unless|suppose|suspect|guess|think|believe|wonder|ask(?:ed|s|ing)?|say|says|said|saying|tell|tells|told|telling|claim(?:ed|s|ing)?|report(?:ed|s|ing)?|suggest(?:ed|s|ing)?|mention(?:ed|s|ing)?|hear|heard|read|seem(?:ed|s|ing)?|appear(?:ed|s|ing)?|according\s+to|no|incorrect)\b|\b(?:i\s+)?(?:(?:do\s+not|don['’]?t|dont)\s+(?:(?:really|actually|quite|entirely|exactly|honestly)\s+)?know|can(?:not|['’]?t)\s+(?:(?:really|actually|quite|entirely|exactly|honestly)\s+)?(?:say|tell)|have\s+no\s+idea)\b|\b(?:not\s+(?:(?:really|actually|quite|entirely|exactly|totally)\s+)?(?:really|sure|certain)|hard\s+to\s+say|could\s+be\s+wrong)\b|\b(?:that\s+is|that['’]?s)\s+wrong\b|\bor\s+(?:maybe\s+)?not\b/iu.test(
          polarityText,
        )
      );
    });
    if (hasPositiveOwnedClause) visitorOwned.add(candidate);
  }
  for (const owned of [...visitorOwned]) {
    for (const [candidate, cue] of Object.entries(cues) as [SegmentId, RegExp][]) {
      if (candidate === owned) continue;
      const coordinated = new RegExp(
        `${cues[owned].source}(?:\\s+(?:company|organisation|organization|team|segment|sector|field))?\\s*(?:,?\\s*(?:and|or|versus|vs\\.?|as\\s+opposed\\s+to|rather\\s+than|instead\\s+of)|\\s*\\/\\s*)\\s*(?:(?:maybe|perhaps)\\s+)?(?:(?:a|an|in)\\s+)?${cue.source}`,
        "iu",
      ).test(latest);
      if (coordinated) visitorOwned.add(candidate);
    }
  }
  if (visitorOwned.size > 0) return visitorOwned.size === 1 && visitorOwned.has(segment);

  if (mentioned.length !== 1 || mentioned[0]?.[0] !== segment) return false;
  return new RegExp(
    `^\\s*(?:(?:the|a|an)\\s+)?(?:${targetCue.source})(?:\\s+(?:company|organisation|organization|team|segment|sector|field))?(?:\\s+please)?[.!?]*\\s*$`,
    "iu",
  ).test(latest);
}

function assistantSegmentSupportsTarget(state: VoiceRuntimeState, segment: SegmentId, cues: Record<SegmentId, RegExp>) {
  const proposition = affirmedAssistantProposition(latestAssistantPromptBeforeUser(state), cues[segment], "segment");
  if (!proposition) return false;
  const mentioned = (Object.entries(cues) as [SegmentId, RegExp][])
    .filter(([, cue]) => cue.test(proposition))
    .map(([id]) => id);
  return mentioned.length === 1 && mentioned[0] === segment;
}

function currentUserTurnMentionsSegment(state: VoiceRuntimeState) {
  const boundary = trackedCurrentUserTurnBoundary(state);
  if (boundary === undefined) return false;
  return /\b(?:tenancy|tenant|space|venue|rent|rental|education|school|student|teacher|learning|training|programme|program|event|workshop|initiative|technology|tech|digital|software|hardware|ai|robotics|community|ngo|nonprofit|social\s+impact|volunteer|other|something\s+else|not\s+sure)\b/iu.test(
    latestUserAuthorityText(state, boundary),
  );
}

function clearAllWouldOverrideLocalEdits(state: VoiceRuntimeState) {
  const boundaries = localAuthorityBoundaries(state);
  const fallbackBoundary = trackedCurrentUserTurnBoundary(state);
  if (boundaries.length === 0 && fallbackBoundary === undefined) return false;
  const boundary = boundaries.length > 0 ? Math.max(...boundaries) : (fallbackBoundary as number);
  const authorityText = latestUserAuthorityText(state, boundary);
  if (boundaries.length === 0 && isAnaphoricAffirmativeReply(authorityText)) {
    const prompt = latestAssistantPromptBeforeUser(state);
    const proposition = affirmedAssistantProposition(
      prompt,
      /\b(?:clear|delete|remove|erase|forget|wipe|start\s+over)\b/iu,
      "clear",
    );
    if (
      proposition &&
      /\b(?:clear|delete|remove|erase|forget|wipe|start\s+over)\b\s+(?:only\s+)?(?:everything(?:(?:\s+in\s+(?:the|this|your)\s+form)|(?=\s*(?:[?.!,]|$)))|all\s+(?:(?:the|this|your)\s+)?(?:fields?|details?)|(?:the|this|your)\s+(?:form|fields?|details?))\b/iu.test(
        proposition,
      )
    ) {
      return false;
    }
  }
  const text = latestIntentClause(authorityText, /\b(?:clear|delete|remove|erase|forget|wipe|start\s+over)\b/iu);
  return !isAffirmativeClearIntent(
    text,
    /\b(?:all(?:\s+(?:fields?|details?))?|everything|fields?|details?|form)\b/iu,
    true,
  );
}

function hasAffirmativeClearAllIntent(state: VoiceRuntimeState) {
  const text = latestIntentClause(
    latestUserAuthorityText(state),
    /\b(?:clear|delete|remove|erase|forget|wipe|start\s+over)\b/iu,
  );
  return isAffirmativeClearIntent(
    text,
    /\b(?:all(?:\s+(?:fields?|details?))?|everything|fields?|details?|form)\b/iu,
    true,
  );
}

function isAffirmativeClearIntent(text: string, object: RegExp, allowStartOver: boolean) {
  if (!text || (!object.test(text) && !(allowStartOver && /\bstart\s+over\b/iu.test(text)))) return false;
  const action = allowStartOver
    ? "(?:clear|delete|remove|erase|forget|wipe|start\\s+over)"
    : "(?:clear|delete|remove|erase|forget)";
  const rejects =
    new RegExp(
      `\\b(?:do\\s+not|don['’]?t|dont|never|cannot|can['’]?t|cant|not\\s+to|not\\s+want(?:\\s+you)?\\s+to)\\b.{0,48}\\b${action}\\b|\\b${action}\\b.{0,32}\\b(?:not|later|maybe|perhaps)\\b`,
      "iu",
    ).test(text) ||
    /^(?:how|what|why|when|where|should\s+(?:i|we)|can\s+(?:i|we)|could\s+(?:i|we)|would\s+(?:i|we))\b/iu.test(text);
  if (rejects) return false;
  const wrapper = "(?:(?:yes|okay|ok|alright|actually|then)[,;:.!\\s-]+)*";
  const request =
    "(?:(?:please|(?:can|could|would)\\s+you(?:\\s+please)?|i\\s+(?:want|would\\s+like)\\s+(?:you\\s+)?to)\\s+)?";
  const directObject = `(?:\\s+(?:my|the|this))?\\s+${object.source}(?:\\s+field)?`;
  const explicitClear = new RegExp(
    `^${wrapper}${request}${action}${directObject}(?:\\s+(?:now|please))?[.!?]?\\s*$`,
    "iu",
  ).test(text.trim());
  const explicitStartOver =
    allowStartOver &&
    new RegExp(`^${wrapper}${request}start\\s+over(?:\\s+(?:now|please))?[.!?]?\\s*$`, "iu").test(text.trim());
  return explicitClear || explicitStartOver;
}

function endCallWouldOverrideLocalEdits(state: VoiceRuntimeState) {
  const boundaries = localAuthorityBoundaries(state);
  const fallbackBoundary = trackedCurrentUserTurnBoundary(state);
  if (boundaries.length === 0 && fallbackBoundary === undefined) return false;
  const boundary = boundaries.length > 0 ? Math.max(...boundaries) : (fallbackBoundary as number);
  const authorityText = latestUserAuthorityText(state, boundary);
  if (
    boundaries.length === 0 &&
    isAnaphoricAffirmativeReply(authorityText) &&
    assistantAffirmativelyAsksAbout(
      state,
      /\b(?:end|stop|cancel|hang\s+up|goodbye|bye|done|that['’]?s\s+all)\b/iu,
      "end",
    )
  ) {
    return false;
  }
  const text = latestIntentClause(
    authorityText,
    /\b(?:end|stop|cancel|hang\s+up|goodbye|bye|done|that['’]?s\s+all)\b/iu,
  );
  const rejectsEnding =
    /\b(?:do\s+not|don['’]?t|dont|never|cannot|can['’]?t|cant|not\s+to|not\s+want(?:\s+you)?\s+to)\b.{0,48}\b(?:end|stop|cancel|hang\s+up|say\s+goodbye|done)\b/iu.test(
      text,
    ) || /\b(?:not\s+done|keep|continue)\s+(?:talking|the\s+call|going)?\b/iu.test(text);
  return (
    rejectsEnding ||
    !/^(?:(?:yes|okay|ok|alright|please|actually)[,;:.!\s-]+)*(?:(?:(?:can|could|would)\s+you(?:\s+please)?|i\s+(?:want|would\s+like)\s+(?:you\s+)?to|please)\s+)?(?:end|stop|cancel)(?:\s+(?:(?:the|this)\s+)?(?:call|session|conversation|voice))?(?:\s+now)?[.!?]?\s*$|^(?:goodbye|bye|hang\s+up|i(?:'m|\s+am)\s+done(?:\s+(?:talking|for\s+now))?|that(?:'s|\s+is)\s+all)[.!?]?\s*$/iu.test(
      text,
    )
  );
}

function responseInputUnavailable(state: VoiceRuntimeState) {
  if (state.userTranscriptTrackingExhausted) return true;
  const binding = state.activeResponseTranscriptBinding;
  if (!binding) {
    const latestTaggedOutcome = state.latestUserTranscriptItemId
      ? state.settledUserTranscriptOutcomes?.[state.latestUserTranscriptItemId]
      : undefined;
    return (
      latestTaggedOutcome === "failed" ||
      latestTaggedOutcome === "empty" ||
      state.legacyUserTranscriptOutcome === "failed" ||
      state.legacyUserTranscriptOutcome === "empty"
    );
  }
  const outcome = binding.itemId
    ? (state.settledUserTranscriptOutcomes?.[binding.itemId] ?? binding.outcome)
    : (state.legacyUserTranscriptOutcome ?? binding.outcome);
  return outcome === "failed" || outcome === "empty";
}

function completeRouteToTeam(
  state: VoiceRuntimeState,
  callId: string,
  segment: SegmentId,
  deferred = false,
): { state: VoiceRuntimeState; commands: RealtimeClientCommand[] } {
  let next = { ...state, segment };
  const missingFields = getMissingFields(next.captured);
  const invalidFields = getInvalidFields(next.captured);
  const unconfirmedFields = getUnconfirmedFields(next);
  let output: Record<string, unknown>;

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
    return { state: next, commands: [{ type: "submit_voice", callId, segment: next.segment }] };
  }

  next = recordObservableToolFailure(next, { type: "function_call", name: "route_to_team", call_id: callId }, output);
  return {
    state: next,
    commands: [
      {
        type: "function_result",
        callId,
        createResponse: true,
        output,
        ...(deferred ? { toolName: "route_to_team" as const } : {}),
      },
    ],
  };
}

function deferMutationCall(
  state: VoiceRuntimeState,
  item: RealtimeOutputItem,
): { state: VoiceRuntimeState; commands: RealtimeClientCommand[] } {
  const callId = item.call_id as string;
  const pending = state.deferredMutationCalls ?? [];
  if (pending.length >= MAX_DEFERRED_MUTATION_CALLS) {
    const output = { ok: false, error: "transcription_tracking_exhausted" };
    const next = recordObservableToolFailure(
      { ...state, handledCallIds: [...(state.handledCallIds ?? []), callId] },
      item,
      output,
    );
    return {
      state: next,
      commands: [
        {
          type: "function_result",
          callId,
          createResponse: true,
          output,
          toolName: item.name as VoiceToolName,
        },
      ],
    };
  }
  const itemId = pendingTranscriptIdForCapture(state);
  return {
    state: {
      ...state,
      deferredMutationCalls: [
        ...pending,
        {
          item,
          ...(itemId ? { itemId } : {}),
          authoritySequence:
            state.activeResponseTranscriptBinding?.authoritySequence ?? state.userAuthoritySequence ?? 0,
          userTurnBoundary: countUserTurns(state.transcript),
        },
      ],
    },
    commands: [],
  };
}

function resolveDeferredMutationCalls(state: VoiceRuntimeState): {
  state: VoiceRuntimeState;
  commands: RealtimeClientCommand[];
} {
  const pending = state.deferredMutationCalls ?? [];
  const legacyPending = Math.max(
    0,
    (state.pendingUserTranscripts ?? 0) - (state.pendingUserTranscriptIds?.length ?? 0),
  );
  const eligible = pending.filter((deferred) =>
    deferred.itemId ? !state.pendingUserTranscriptIds?.includes(deferred.itemId) : legacyPending === 0,
  );
  if (eligible.length === 0) return { state, commands: [] };

  const eligibleIds = new Set(eligible.map((deferred) => deferred.item.call_id));
  let next: VoiceRuntimeState = {
    ...state,
    deferredMutationCalls: pending.filter((deferred) => !eligibleIds.has(deferred.item.call_id)),
  };
  const commands: RealtimeClientCommand[] = [];

  const reject = (deferred: (typeof eligible)[number], error: "stale_response" | "transcription_unavailable") => {
    const callId = deferred.item.call_id as string;
    const output = { ok: false, error };
    next = recordObservableToolFailure(
      { ...next, handledCallIds: [...(next.handledCallIds ?? []), callId] },
      deferred.item,
      output,
    );
    commands.push({
      type: "function_result",
      callId,
      createResponse: error === "transcription_unavailable",
      output,
      toolName: deferred.item.name as VoiceToolName,
    });
  };

  for (const deferred of eligible) {
    if (deferred.authoritySequence !== (next.userAuthoritySequence ?? 0)) {
      reject(deferred, "stale_response");
      continue;
    }
    const outcome = deferred.itemId
      ? next.settledUserTranscriptOutcomes?.[deferred.itemId]
      : next.legacyUserTranscriptOutcome;
    if (next.userTranscriptTrackingExhausted || outcome !== "completed") {
      reject(deferred, "transcription_unavailable");
      continue;
    }

    const previousBinding = next.activeResponseTranscriptBinding;
    const previousDeferredBoundary = next.deferredAuthorityUserTurnBoundary;
    next = {
      ...next,
      deferredAuthorityUserTurnBoundary: deferred.userTurnBoundary,
      activeResponseTranscriptBinding: {
        pending: false,
        ...(deferred.itemId ? { itemId: deferred.itemId } : {}),
        authoritySequence: deferred.authoritySequence,
        outcome,
      },
    };
    const reduced = applyFunctionCall(deferred.item, next);
    next = {
      ...reduced.state,
      activeResponseTranscriptBinding: previousBinding,
      deferredAuthorityUserTurnBoundary: previousDeferredBoundary,
    };
    commands.push(
      ...reduced.commands.map((command) =>
        command.type === "function_result" ? { ...command, toolName: deferred.item.name as VoiceToolName } : command,
      ),
    );
  }

  return { state: next, commands };
}

function resolveDeferredRouteCall(state: VoiceRuntimeState): {
  state: VoiceRuntimeState;
  commands: RealtimeClientCommand[];
} {
  const deferred = state.deferredRouteCall;
  if (!deferred) return { state, commands: [] };
  const legacyPending = Math.max(
    0,
    (state.pendingUserTranscripts ?? 0) - (state.pendingUserTranscriptIds?.length ?? 0),
  );
  if (deferred.itemId ? state.pendingUserTranscriptIds?.includes(deferred.itemId) : legacyPending > 0) {
    return { state, commands: [] };
  }

  let next: VoiceRuntimeState = {
    ...state,
    deferredRouteCall: undefined,
    deferredAuthorityUserTurnBoundary: deferred.userTurnBoundary,
    handledCallIds: [...(state.handledCallIds ?? []), deferred.callId],
  };
  const result = (output: Record<string, unknown>, createResponse: boolean) => {
    next = recordObservableToolFailure(
      next,
      { type: "function_call", name: "route_to_team", call_id: deferred.callId },
      output,
    );
    return {
      state: { ...next, deferredAuthorityUserTurnBoundary: undefined },
      commands: [
        {
          type: "function_result" as const,
          callId: deferred.callId,
          createResponse,
          output,
          toolName: "route_to_team" as const,
        },
      ],
    };
  };

  if (deferred.authoritySequence !== (next.userAuthoritySequence ?? 0)) {
    return result({ ok: false, error: "stale_response" }, false);
  }
  const outcome = deferred.itemId
    ? next.settledUserTranscriptOutcomes?.[deferred.itemId]
    : next.legacyUserTranscriptOutcome;
  if (next.userTranscriptTrackingExhausted || outcome === "failed" || outcome === "empty" || !outcome) {
    return result({ ok: false, error: "transcription_unavailable", segment: deferred.segment }, true);
  }
  if (!hasPostLocalEditRouteIntent(next, deferred.segment)) {
    return result({ ok: false, error: "stale_local_edit", segment: deferred.segment }, true);
  }
  const completed = completeRouteToTeam(next, deferred.callId, deferred.segment, true);
  return {
    state: { ...completed.state, deferredAuthorityUserTurnBoundary: undefined },
    commands: completed.commands,
  };
}

function appendBoundedUnique(values: string[] | undefined, value: string) {
  const current = values ?? [];
  return current.includes(value) ? current : [...current, value].slice(-MAX_TRACKED_USER_TRANSCRIPTS);
}

function trackedUserTranscriptIdentityCount(state: VoiceRuntimeState) {
  return new Set([
    ...(state.observedUserSpeechStartIds ?? []),
    ...(state.pendingUserTranscriptIds ?? []),
    ...(state.settledUserTranscriptIds ?? []),
    ...(state.ignoredUserTranscriptIds ?? []),
    ...Object.keys(state.settledUserTranscriptBuffer ?? {}),
  ]).size;
}

function appendTranscript(
  state: VoiceRuntimeState,
  role: VoiceTranscriptEntry["role"],
  text: string,
): VoiceRuntimeState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const previous = state.transcript.at(-1);
  if (role === "assistant" && previous?.role === role && previous.text === trimmed) return state;
  if (role === "assistant" && previous?.role === "assistant") {
    if (trimmed.startsWith(previous.text)) {
      return { ...state, transcript: [...state.transcript.slice(0, -1), { role, text: trimmed }] };
    }
    if (previous.text.startsWith(trimmed)) return state;
  }
  return { ...state, transcript: [...state.transcript, { role, text: trimmed }] };
}

/**
 * Provider transcription completions may arrive out of order. Retain them
 * until the oldest committed tagged item settles, then apply every contiguous
 * item in commit order. This keeps both transcript evidence and email
 * authority chronological while making replays true no-ops.
 */
function drainSettledUserTranscriptions(state: VoiceRuntimeState): VoiceRuntimeState {
  let next = state;
  while (true) {
    const itemId = next.pendingUserTranscriptIds?.[0];
    if (!itemId) return next;
    const buffered = next.settledUserTranscriptBuffer?.[itemId];
    if (!buffered) return next;

    const pendingSequences = { ...(next.pendingUserTranscriptSequences ?? {}) };
    delete pendingSequences[itemId];
    const settledBuffer = { ...(next.settledUserTranscriptBuffer ?? {}) };
    delete settledBuffer[itemId];
    const completionPredatesVerification = Boolean(next.emailVerificationIgnoredTranscriptIds?.includes(itemId));
    const outcome = buffered.status === "failed" ? "failed" : buffered.transcript?.trim() ? "completed" : "empty";
    next = {
      ...next,
      pendingUserTranscripts: Math.max(0, (next.pendingUserTranscripts ?? 0) - 1),
      pendingUserTranscriptIds: next.pendingUserTranscriptIds?.slice(1) ?? [],
      pendingUserTranscriptSequences: pendingSequences,
      settledUserTranscriptBuffer: settledBuffer,
      settledUserTranscriptIds: appendBoundedUnique(next.settledUserTranscriptIds, itemId),
      settledUserTranscriptOutcomes: {
        ...(next.settledUserTranscriptOutcomes ?? {}),
        [itemId]: outcome,
      },
    };

    if (buffered.status === "completed" && buffered.transcript) {
      next = appendTranscript(next, "user", buffered.transcript);
      next = completionPredatesVerification
        ? {
            ...next,
            emailVerificationUserTurnSequence: countUserTurns(next.transcript),
            emailVerificationIgnoredTranscriptIds: next.emailVerificationIgnoredTranscriptIds?.filter(
              (id) => id !== itemId,
            ),
          }
        : reconcileCompletedEmailTranscription(next, buffered.transcript, itemId);
      next = accumulateUsage(next, "transcription", buffered.usage);
    } else if (buffered.status === "completed") {
      next = accumulateUsage(next, "transcription", buffered.usage);
    } else if (
      buffered.status === "failed" &&
      ((next.emailGroundingAwaitingTranscript?.itemId && itemId === next.emailGroundingAwaitingTranscript.itemId) ||
        (!next.emailGroundingAwaitingTranscript?.itemId && (next.pendingUserTranscripts ?? 0) === 0))
    ) {
      next = { ...next, emailGroundingAwaitingTranscript: undefined };
    }
  }
}

function applyUserEmailUpdate(state: VoiceRuntimeState, text: string, source: "speech" | "typed"): VoiceRuntimeState {
  const currentEmail = state.captured.email.trim();
  const literalDecision = resolveLiteralVisitorEmailUpdate(text, currentEmail);
  if (
    literalDecision.kind === "selected" &&
    emailTurnFinallyDisclaimsVisitorAuthority(text, literalDecision.email.toLowerCase())
  ) {
    return clearSelectedEmail(state, source);
  }
  if (literalDecision.kind === "invalidates") {
    const mentionedEmails = getLiteralEmailMentions(text).map((mention) => mention.email);
    const rejectsCurrent = Boolean(
      currentEmail &&
        (emailTurnRejectsTarget(text, currentEmail.toLowerCase()) ||
          emailTurnFinallyDisclaimsVisitorAuthority(text, currentEmail.toLowerCase())),
    );
    const retractsDifferentReplacement = mentionedEmails.some(
      (email) =>
        email.toLowerCase() !== currentEmail.toLowerCase() &&
        captureHasTrailingAnaphoricRetraction({ key: "email", value: email, evidence: email }, text),
    );
    if (currentEmail && !rejectsCurrent && retractsDifferentReplacement) return state;
    return clearSelectedEmail(state, source);
  }
  const email =
    literalDecision.kind === "selected"
      ? literalDecision.email
      : literalDecision.kind === "irrelevant"
        ? undefined
        : extractExplicitVisitorEmail(text);
  if (email && captureHasTrailingAnaphoricRetraction({ key: "email", value: email, evidence: email }, text)) {
    return state;
  }
  if (!email) {
    // Third-party, historical, example, and web literals do not affect the
    // visitor's selected contact address.
    if (literalDecision.kind === "irrelevant") return state;
    if (!currentEmail || (!hasOwnedEmailReplacementIntent(text) && !hasShortContextualEmailCorrection(state, text))) {
      return state;
    }
    return clearSelectedEmail(state, source);
  }
  // Repeated speech must never promote itself through the strict read-back
  // gate. Directly typing the same visible address, however, is fresh primary
  // authority and must promote pending speech/prefill state immediately.
  if (email.toLowerCase() === currentEmail.toLowerCase() && source === "speech") return state;
  const adaptiveSpeech = source === "speech" && state.emailCaptureMode === "adaptive";
  return {
    ...state,
    captured: { ...state.captured, email },
    emailVerificationUserTurnSequence: countUserTurns(state.transcript),
    emailVerificationIgnoredTranscriptIds: source === "typed" ? [...(state.pendingUserTranscriptIds ?? [])] : undefined,
    emailGroundingAwaitingTranscript: source === "typed" ? undefined : state.emailGroundingAwaitingTranscript,
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

type LiteralVisitorEmailUpdate =
  | { kind: "none" }
  | { kind: "selected"; email: string }
  | { kind: "invalidates" }
  | { kind: "irrelevant" };

/** Resolve every literal together; never silently choose the first competitor. */
function resolveLiteralVisitorEmailUpdate(text: string, currentEmail: string): LiteralVisitorEmailUpdate {
  const allMentions = getLiteralEmailMentions(text);
  if (allMentions.length === 0) return { kind: "none" };
  // Relevance belongs to each literal's local decision span. A historical,
  // billing, web, or third-party aside must never neutralize an explicit
  // visitor correction elsewhere in the same sentence.
  const normalizedText = normalizeEmailDecisionText(text);
  const evaluatedMentions = allMentions.map((mention) => ({
    ...mention,
    context: literalEmailDecisionContext(normalizedText, mention.start, mention.email.length),
    irrelevant: literalEmailMentionIsIrrelevant(normalizedText, mention.start, mention.email.length),
  }));
  const relevantMentions = evaluatedMentions.filter((mention) => !mention.irrelevant);
  const normalizedCurrent = currentEmail.trim().toLowerCase();
  const currentAnaphoricDisposition = normalizedCurrent
    ? getFinalAnaphoricEmailAuthorityDisposition(normalizedText, normalizedCurrent)
    : undefined;
  const currentExplicitlyDisclaimed =
    currentAnaphoricDisposition === "disclaimed" ||
    (currentAnaphoricDisposition !== "visitor" &&
      evaluatedMentions.some(
        (mention) =>
          mention.email === normalizedCurrent &&
          literalEmailMentionDisclaimsVisitorAuthority(
            normalizedText,
            mention.start,
            mention.email.length,
            mention.context,
            mention.email,
          ),
      ));
  const abandonedVisitorDeclaration = evaluatedMentions.some((mention) =>
    literalEmailMentionWasDeclaredThenDisclaimed(
      normalizedText,
      mention.start,
      mention.email.length,
      mention.context,
      mention.email,
    ),
  );
  if (relevantMentions.length === 0) {
    return currentExplicitlyDisclaimed || abandonedVisitorDeclaration
      ? { kind: "invalidates" }
      : { kind: "irrelevant" };
  }
  if (relevantMentions.length < allMentions.length) {
    const scoped = resolveScopedRelevantLiteralUpdate(relevantMentions, currentEmail);
    return scoped.kind === "irrelevant" && (currentExplicitlyDisclaimed || abandonedVisitorDeclaration)
      ? { kind: "invalidates" }
      : scoped;
  }
  const relevantText = text;
  const mentions = getLiteralEmailMentions(relevantText);

  const unambiguousSelection = resolveUnambiguousLiteralSelection(relevantText, mentions);
  if (unambiguousSelection) return { kind: "selected", email: unambiguousSelection };

  const corrected = getExplicitCorrectedVisitorEmail(relevantText);
  if (corrected) return { kind: "selected", email: corrected };
  if (abandonedVisitorDeclaration) return { kind: "invalidates" };

  const distinct = [...new Set(mentions.map((mention) => mention.email))];
  const literal = extractExplicitVisitorEmail(relevantText);
  if (
    distinct.length === 1 &&
    literal &&
    !emailTurnRejectsTarget(relevantText, literal) &&
    !emailTurnOffersAlternatives(relevantText)
  ) {
    return { kind: "selected", email: literal };
  }

  const hasVisitorAuthorityIntent =
    hasPrimaryContactOwnershipContext(relevantText) ||
    hasExplicitEmailOwnershipContext(relevantText) ||
    hasOrderedEmailSelectionCue(relevantText) ||
    hasEmailCorrectionLanguage(relevantText) ||
    emailTurnOffersAlternatives(relevantText) ||
    hasCompetingOwnedEmailContext(relevantText) ||
    Boolean(currentEmail && emailTurnRejectsTarget(relevantText, currentEmail));
  if (!hasVisitorAuthorityIntent) return { kind: "irrelevant" };

  // Competing visitor/contact literals with no unique selection are always
  // ambiguous, even when the current address is one of the alternatives.
  if (distinct.length > 1) return { kind: "invalidates" };
  return currentEmail &&
    (emailTurnRejectsTarget(relevantText, currentEmail) || emailCorrectionInvalidates(relevantText, currentEmail))
    ? { kind: "invalidates" }
    : { kind: "irrelevant" };
}

function resolveScopedRelevantLiteralUpdate(
  mentions: Array<{ email: string; context: string }>,
  currentEmail: string,
): LiteralVisitorEmailUpdate {
  const current = currentEmail.trim().toLowerCase();
  const rejected = mentions.filter((mention) => emailTurnRejectsTarget(mention.context, mention.email));
  const selected = mentions.filter((mention) => {
    if (emailTurnRejectsTarget(mention.context, mention.email)) return false;
    const explicit = extractExplicitVisitorEmail(mention.context)?.toLowerCase();
    return (
      explicit === mention.email ||
      emailTurnSelectsTarget(mention.context, mention.email) ||
      emailTurnAssertsOwnership(mention.context, mention.email) ||
      getExplicitCorrectedVisitorEmail(mention.context) === mention.email ||
      hasPrimaryContactOwnershipContext(mention.context) ||
      hasExplicitEmailOwnershipContext(mention.context)
    );
  });
  const selectedEmails = [...new Set(selected.map((mention) => mention.email))];
  const relevantEmails = [...new Set(mentions.map((mention) => mention.email))];
  const rejectedEmails = new Set(rejected.map((mention) => mention.email));

  if (selectedEmails.length === 1) {
    const selectedEmail = selectedEmails[0] as string;
    const competitorsAreRejected = relevantEmails.every(
      (email) => email === selectedEmail || rejectedEmails.has(email),
    );
    return competitorsAreRejected ? { kind: "selected", email: selectedEmail } : { kind: "invalidates" };
  }
  if (selectedEmails.length > 1) return { kind: "invalidates" };
  if (current && rejectedEmails.has(current)) return { kind: "invalidates" };

  const hasAuthorityIntent = mentions.some(
    (mention) =>
      hasPrimaryContactOwnershipContext(mention.context) ||
      hasExplicitEmailOwnershipContext(mention.context) ||
      hasOrderedEmailSelectionCue(mention.context) ||
      hasEmailCorrectionLanguage(mention.context) ||
      emailTurnOffersAlternatives(mention.context),
  );
  return relevantEmails.length > 1 && hasAuthorityIntent ? { kind: "invalidates" } : { kind: "irrelevant" };
}

function resolveUnambiguousLiteralSelection(text: string, mentions: Array<{ email: string; start: number }>) {
  const normalizedText = normalizeEmailDecisionText(text);
  const explicitlyReplaced = getExplicitLiteralReplacement(normalizedText, mentions);
  const finalAlternativeSelection = getFinalAlternativeLiteralSelection(text);
  const selectedEmails = new Set<string>();
  const rejectedEmails = new Set<string>();
  for (const mention of mentions) {
    const disposition = getLiteralEmailMentionDisposition(normalizedText, mention.start, mention.email.length);
    const rejected =
      disposition === "rejected" ||
      emailTurnRejectsTarget(text, mention.email) ||
      (explicitlyReplaced !== undefined && explicitlyReplaced !== mention.email) ||
      (finalAlternativeSelection !== undefined && finalAlternativeSelection !== mention.email);
    if (rejected) {
      rejectedEmails.add(mention.email);
    } else if (
      finalAlternativeSelection === mention.email ||
      explicitlyReplaced === mention.email ||
      (finalAlternativeSelection === undefined &&
        explicitlyReplaced === undefined &&
        (disposition === "selected" ||
          emailTurnSelectsTarget(text, mention.email) ||
          emailTurnAssertsOwnership(text, mention.email)))
    ) {
      selectedEmails.add(mention.email);
    }
  }
  if (selectedEmails.size !== 1) return undefined;
  const selected = [...selectedEmails][0] as string;
  const competitorsResolved = mentions.every(
    (mention) => mention.email === selected || rejectedEmails.has(mention.email),
  );
  return competitorsResolved ? selected : undefined;
}

function getExplicitLiteralReplacement(text: string, mentions: Array<{ email: string }>) {
  const replacements = new Set<string>();
  for (const previous of mentions) {
    for (const next of mentions) {
      if (previous.email === next.email) continue;
      const from = previous.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const to = next.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sourceFirst = new RegExp(
        `(?:replace|change|update)(?:\\s+(?:(?:my|the)\\s+)?e-?mail)?\\s+(?:from\\s+)?${from}\\s+(?:to|with)\\s+${to}`,
        "iu",
      ).test(text);
      const targetFirst = new RegExp(
        `${to}\\s+(?:(?:should\\s+)?(?:replace(?:s)?|supersede(?:s)?))\\s+${from}`,
        "iu",
      ).test(text);
      const swapOrMove =
        new RegExp(`swap\\s+${from}\\s+(?:for|with)\\s+${to}`, "iu").test(text) ||
        new RegExp(`move\\s+from\\s+${from}\\s+to\\s+${to}`, "iu").test(text);
      const becomes = new RegExp(`${from}\\s+(?:should\\s+)?become(?:s)?\\s+${to}`, "iu").test(text);
      const makeInstead = new RegExp(`make\\s+it\\s+${to}\\s+instead\\s+of\\s+${from}`, "iu").test(text);
      if (sourceFirst || targetFirst || swapOrMove || becomes || makeInstead) {
        replacements.add(next.email);
      }
    }
  }
  return replacements.size === 1 ? ([...replacements][0] as string) : undefined;
}

function emailTurnAssertsOwnership(text: string, email: string) {
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `${escapedEmail}\\s+(?:(?:is|that's|that\\s+is)\\s+)?(?:mine|the\\s+one|my\\s+(?:e-?mail|contact\\s+address))\\b|${escapedEmail}\\s+belongs\\s+to\\s+me\\b|(?:this|that)\\s+(?:e-?mail|address)\\s+is\\s+mine\\s*[:=,-]?\\s*${escapedEmail}|(?:the\\s+)?(?:e-?mail|address)\\s+belonging\\s+to\\s+me\\s+is\\s+${escapedEmail}|the\\s+one\\s+to\\s+use\\s+is\\s+${escapedEmail}|it\\s+should\\s+be\\s+${escapedEmail}|(?:that\\s+is\\s+)?my\\s+(?:[\\p{Letter}][\\p{Letter}&'’-]*\\s+){0,3}(?:e-?mail|address|contact)\\s+${escapedEmail}`,
    "iu",
  ).test(normalizeEmailDecisionText(text));
}

function hasCompetingOwnedEmailContext(text: string) {
  return /\bmy\s+e-?mails?\s+(?:are|include)\b|\bboth\b.{0,180}\b(?:are\s+mine|belong\s+to\s+me)\b/iu.test(text);
}

function normalizeEmailDecisionText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
}

function literalEmailDecisionContext(text: string, start: number, length: number) {
  const boundary =
    /[;.!?]+\s*|,\s*|\s+\b(?:instead\s+of|rather\s+than|as\s+well\s+as|along\s+with|together\s+with|in\s+addition\s+to|and|or|but|however|whereas|while|plus|versus|vs\.?)\b\s+/giu;
  let contextStart = 0;
  let contextEnd = text.length;
  for (const match of text.matchAll(boundary)) {
    const boundaryStart = match.index;
    const boundaryEnd = boundaryStart + match[0].length;
    if (boundaryEnd <= start) contextStart = boundaryEnd;
    else if (boundaryStart >= start + length) {
      if (anaphoricEmailRejectionStarts(text.slice(boundaryEnd))) continue;
      // Keep the coordinator with the preceding literal so correction intent
      // such as “use A rather than B” remains explicit after B is excluded.
      contextEnd = boundaryEnd;
      break;
    }
  }
  return text.slice(contextStart, contextEnd).trim();
}

function anaphoricEmailRejectionStarts(text: string) {
  const normalized = expandAnaphoricContractions(text)
    .replace(/^[,;:.!?\s—–-]*/u, "")
    .replace(/^(?:(?:but|and)\s+)?(?:(?:actually|no|nope|sorry|maybe|perhaps)\b[,;:.!?\s—–-]*)?/u, "");
  const target = "(?:that(?:\\s+(?:one|e-?mail|address))?|this(?:\\s+(?:one|e-?mail|address))?|it)";
  const action = "(?:use|send(?:\\s+(?:it\\s+)?to)?|contact|route(?:\\s+(?:it\\s+)?to)?)";
  return (
    new RegExp(
      `^(?:please\\s+)?(?:(?:(?:you|we|i)\\s+)?(?:do|should|must|can)\\s+not\\s+${action}|(?:(?:you|we|i)\\s+)?(?:cannot|can(?:['’]?|\\s+)t|cant|never|no\\s+longer)\\s+${action}|(?:(?:(?:you|we|i)\\s+)?(?:are|is)\\s+)?not\\s+supposed\\s+to\\s+${action}|stop\\s+(?:using|sending(?:\\s+to)?|contacting|routing(?:\\s+to)?)|(?:avoid|exclude|discard|reject|remove|scratch|forget|ignore|retract)(?:\\s+(?:using|sending(?:\\s+to)?|contacting|routing(?:\\s+to)?))?)\\s+${target}\\b`,
      "iu",
    ).test(normalized) ||
    /^(?:scratch|forget|ignore|retract|avoid|exclude|discard|reject|remove)\s+(?:that|this|it)(?:\s+one)?\b/iu.test(
      normalized,
    ) ||
    /^not\s+(?:that|this|it)(?:\s+one)?\b/iu.test(normalized) ||
    /^(?:do\s+not|don['’]?t|dont)\s+use\s+(?:that|this|it)(?:\s+one)?\b/iu.test(normalized) ||
    /^wrong\s+(?:one|e-?mail|address)\b/iu.test(normalized) ||
    new RegExp(
      `^${target}\\s+(?:(?:(?:is|was|looks?|seems?)\\s+)?(?:wrong|incorrect|invalid|stale|expired|obsolete|deprecated|outdated|inactive|unconfirmed|tentative|old|not\\s+(?:right|correct|mine|yours|valid|active|current|it|the\\s+one)|no\\s+longer\\s+(?:valid|active|current|mine|yours)|isn['’]?t\\s+(?:right|correct|mine|yours|valid|active|current|it)|a\\s+(?:typo|mistake)|someone\\s+else['’]?s|(?:my|your)\\s+(?:old|previous|former|historical)\\s+(?:one|e-?mail|address)|my\\s+(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)['’]?s\\s+(?:e-?mail|address)|just\\s+an?\\s+example|the\\s+(?:website|web\\s*site|url|homepage)\\s+(?:e-?mail|address)|the\\s+(?!(?:right|correct|one|contact|preferred|selected|current|primary|main|best|only|chosen)\\b)(?:[\\p{Letter}][\\p{Letter}&'’-]*\\s+){1,3}(?:e-?mail|address|contact)|belongs?\\s+to\\s+(?!me\\b|us\\b)(?:my\\s+)?[\\p{Letter}][\\p{Letter}&'’-]*(?:\\s+[\\p{Letter}][\\p{Letter}&'’-]*){0,3}|used\\s+to\\s+be\\s+yours)|(?:does\\s+not|doesn['’]?t|doesnt)\\s+belong\\s+to\\s+(?:me|you|us))\\b`,
      "iu",
    ).test(normalized)
  );
}

function expandAnaphoricContractions(text: string) {
  return text
    .replace(/\b(that|it)(?:['’]s|s)\b/giu, "$1 is")
    .replace(/\bisn(?:['’]?t|t)\b/giu, "is not")
    .replace(/\bwasn(?:['’]?t|t)\b/giu, "was not")
    .replace(/\bdoesn(?:['’]?t|t)\b/giu, "does not");
}

function literalEmailMentionIsIrrelevant(text: string, start: number, length: number) {
  const before = text.slice(Math.max(0, start - 120), start);
  const after = text.slice(start + length, start + length + 80);
  const secondaryBefore =
    /(?:^|\b)(?:for\s+)?(?:the\s+)?(?:billing(?:\s+department)?|invoices?|accounts?(?:\s+(?:payable|receivable))?|finance(?:\s+(?:team|department|desk))?|support(?:\s+(?:team|department|desk))?|supplier(?:\s+contact)?|vendor(?:\s+contact)?|customer\s+success(?:\s+(?:team|department|desk))?|press(?:\s+(?:team|desk))?|media(?:\s+(?:team|desk))?|procurement(?:\s+(?:team|department))?|purchasing(?:\s+(?:team|department))?|legal(?:\s+(?:team|department))?|marketing(?:\s+(?:team|department))?|human\s+resources|hr(?:\s+(?:team|department))?|reference|sample|website|web\s*site|url|homepage)(?:\s+(?:e-?mail|address|contact))?(?:\s+(?:is|was|use|at))?\s*$/i.test(
      before,
    ) || hasOrganizationalContactLabelBefore(before);
  const secondaryAfter =
    /^\s*(?:(?:is|was|=|:)\s*)?(?:(?:the\s+)?(?:billing|invoice|accounts?(?:\s+(?:payable|receivable))?|finance|support|supplier|vendor|customer\s+success|press|media|procurement|purchasing|legal|marketing|human\s+resources|hr|reference|sample|website|web\s*site|url|homepage)\b|for\s+(?:billing|invoices?|accounts?|finance|support|procurement|reference)\b|(?:as\s+)?(?:an\s+)?example\b)/i.test(
      after,
    ) || hasOrganizationalContactLabelAfter(after);
  const historicalBefore =
    /(?:^|\b)(?:(?:the|my)\s+)?(?:old|previous|former|historical)(?:\s+(?:e-?mail|address))?(?:\s+(?:is|was))?\s*$/i.test(
      before,
    ) ||
    /(?:^|\b)(?:(?:i|we)\s+)?used\s+to\s+use\s*$/i.test(before) ||
    /(?:^|\b)(?:previously|formerly|historically)[,;:\s-]+(?:my\s+)?(?:e-?mail|address)(?:\s+(?:is|was))?\s*$/i.test(
      before,
    );
  const historicalAfter =
    /^\s*(?:(?:is|was|=|:)\s*)?(?:(?:(?:the|my)\s+)?(?:old|previous|former|historical)\b|used\s+to\s+be\b)/i.test(
      after,
    );
  const thirdPartyBefore = hasThirdPartyOwnershipBefore(before);
  const thirdPartyAfter = hasThirdPartyOwnershipAfter(after);
  const webBefore =
    /(?:^|\b)(?:website|web\s*site|url|homepage|site(?:\s+link)?|domain)(?:\s+(?:is|was|at))?\s*$/i.test(before);
  return (
    secondaryBefore ||
    secondaryAfter ||
    historicalBefore ||
    historicalAfter ||
    thirdPartyBefore ||
    thirdPartyAfter ||
    webBefore
  );
}

function literalEmailMentionDisclaimsVisitorAuthority(
  text: string,
  start: number,
  length: number,
  context: string,
  email: string,
) {
  return literalEmailMentionIsIrrelevant(text, start, length) || emailTurnRejectsTarget(context, email);
}

function getFinalAnaphoricEmailAuthorityDisposition(text: string, email: string): "visitor" | "disclaimed" | undefined {
  const normalizedText = normalizeEmailDecisionText(text);
  const mentions = getLiteralEmailMentions(normalizedText);
  const targetMention = mentions.findLast((mention) => mention.email === email);
  if (!targetMention) return undefined;

  const targetEnd = targetMention.start + targetMention.email.length;
  const nextLiteral = mentions.find((mention) => mention.start >= targetEnd && mention.email !== email);
  const tail = normalizedText.slice(targetEnd, nextLiteral?.start ?? normalizedText.length);
  let finalDisposition: "visitor" | "disclaimed" | undefined;
  const clauses = (tail.match(/[^.!?;…\r\n]+(?:[.!?;…]+|$)/gu) ?? [])
    .flatMap((clause) =>
      clause.split(/(?:,\s*|\s+\b(?:and|but)\b\s+)(?=(?:it|that|this)(?:['’]s|\s+(?:is|was|belongs?|does))\b)/iu),
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    if (
      /\?\s*$/u.test(clause) ||
      /\b(?:maybe|perhaps|possibly|probably|i\s+(?:think|guess|suppose))\b/iu.test(clause)
    ) {
      continue;
    }
    const expanded = expandAnaphoricContractions(clause)
      .replace(/^[,;:.…!?\s—–-]*/u, "")
      .replace(/^(?:(?:and|but)\s+)?/iu, "")
      .replace(CAPTURE_CORRECTION_DISCOURSE_PREFIX, "")
      .trim();
    const target = "(?:it|that|this)(?:\\s+(?:one|e-?mail|address))?";
    const secondaryRole =
      "(?:billing|invoice|accounts?(?:\\s+(?:payable|receivable))?|finance|support|supplier|vendor|customer\\s+success|press|media|procurement|purchasing|legal|marketing|human\\s+resources|hr|reference|sample|website|web\\s*site|url|homepage)";
    const secondaryRoleEnding = "(?:(?:\\s+(?:e-?mail|address|contact))\\b|[.!…]*\\s*$)";
    const thirdPartyOwner =
      "(?:his|her|their|someone\\s+else['’]?s|(?:my\\s+)?(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)['’]?s|[\\p{Letter}][\\p{Letter}'’-]*['’]s)";
    const thirdPartyEnding = "(?:e-?mail|address|contact(?:\\s+address)?)\\b";
    if (
      new RegExp(
        `^${target}\\s+(?:(?:is|was)\\s+)?(?:still\\s+)?(?:mine|ours|my\\s+(?:e-?mail|address|contact\\s+address)|our\\s+(?:e-?mail|address|contact\\s+address))\\b|^${target}\\s+belongs?\\s+to\\s+(?:me|us)\\b`,
        "iu",
      ).test(expanded)
    ) {
      finalDisposition = "visitor";
      continue;
    }
    if (
      new RegExp(`^${target}\\s+(?:is|was)\\s+not\\s+(?:the\\s+)?${secondaryRole}${secondaryRoleEnding}`, "iu").test(
        expanded,
      ) ||
      new RegExp(`^${target}\\s+(?:is|was)\\s+not\\s+${thirdPartyOwner}\\s+${thirdPartyEnding}`, "iu").test(expanded) ||
      new RegExp(`^${target}\\s+does\\s+not\\s+belong\\s+to\\s+(?!me\\b|us\\b)`, "iu").test(expanded)
    ) {
      finalDisposition = "visitor";
      continue;
    }
    if (
      anaphoricEmailRejectionStarts(expanded) ||
      new RegExp(`^${target}\\s+(?:(?:is|was)\\s+)?(?:the\\s+)?${secondaryRole}${secondaryRoleEnding}`, "iu").test(
        expanded,
      ) ||
      new RegExp(`^${target}\\s+(?:(?:is|was)\\s+)?${thirdPartyOwner}\\s+${thirdPartyEnding}`, "iu").test(expanded)
    ) {
      finalDisposition = "disclaimed";
    }
  }
  return finalDisposition;
}

function emailTurnFinallyDisclaimsVisitorAuthority(text: string, email: string) {
  const normalizedText = normalizeEmailDecisionText(text);
  const finalAnaphoricDisposition = getFinalAnaphoricEmailAuthorityDisposition(normalizedText, email);
  if (finalAnaphoricDisposition) return finalAnaphoricDisposition === "disclaimed";
  const mentions = getLiteralEmailMentions(normalizedText).filter((mention) => mention.email === email);
  let finalDisposition: "visitor" | "disclaimed" | undefined;
  for (const mention of mentions) {
    const context = literalEmailDecisionContext(normalizedText, mention.start, mention.email.length);
    if (
      literalEmailMentionDisclaimsVisitorAuthority(
        normalizedText,
        mention.start,
        mention.email.length,
        context,
        mention.email,
      )
    ) {
      finalDisposition = "disclaimed";
      continue;
    }
    const disposition = getLiteralEmailMentionDisposition(normalizedText, mention.start, mention.email.length);
    if (
      disposition === "selected" ||
      emailTurnAssertsOwnership(context, mention.email) ||
      hasPrimaryContactOwnershipContext(context) ||
      hasExplicitEmailOwnershipContext(context)
    ) {
      finalDisposition = "visitor";
    }
  }
  return finalDisposition === "disclaimed";
}

function hasThirdPartyOwnershipBefore(before: string) {
  return /(?:^|\b)(?:his|her|their|someone\s+else['’]?s|(?:my\s+)?(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)['’]?s|(?!it['’]s\b|that['’]s\b|this['’]s\b)[\p{Letter}][\p{Letter}'’-]*['’]s|(?:the\s+)?(?:customer|client|supplier|partner|billing\s+department|accounts?\s+payable)|(?:(?:the|my)\s+)?(?:[\p{Letter}][\p{Letter}'’-]*\s+){1,3}(?:manager|director|lead|coordinator|officer|representative|assistant|owner)(?:['’]s)?)(?:\s+(?:e-?mail|contact\s+address))?(?:\s+(?:is|was|at))?\s*$/iu.test(
    before,
  );
}

function hasThirdPartyOwnershipAfter(after: string) {
  return /^\s*(?:(?:is|was|=|:)\s*)?(?:(?:his|her|their|someone\s+else['’]?s|(?:my\s+)?(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)['’]?s|[\p{Letter}][\p{Letter}'’-]*['’]s|(?:the\s+)?(?:customer|client|supplier|partner|billing\s+department|accounts?\s+payable)(?:['’]s)?|(?:(?:the|my)\s+)?(?:[\p{Letter}][\p{Letter}'’-]*\s+){1,3}(?:manager|director|lead|coordinator|officer|representative|assistant|owner)(?:['’]s)?)(?:\s+(?:e-?mail|contact\s+address))?|belongs\s+to\s+(?:him|her|them|someone\s+else|my\s+(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)|(?!me\b|us\b)[\p{Letter}][\p{Letter}'’-]*))\b/iu.test(
    after,
  );
}

function hasOrganizationalContactLabelBefore(before: string) {
  const match =
    /(?:^|[;,.!?]\s*|\b(?:and|but)\s+)(?:the\s+)?(?:[\p{Letter}][\p{Letter}&'’-]*\s+){0,3}(?:team|desk|department|contact|enquir(?:y|ies))(?:\s+(?:e-?mail|address|contact))?(?:\s+(?:is|was|at|use))?\s*$/iu.exec(
      before,
    );
  return Boolean(match && !/\b(?:my|this|that|your)\b/iu.test(match[0]));
}

function hasOrganizationalContactLabelAfter(after: string) {
  const match =
    /^\s*(?:(?:is|was|=|:)\s*)?(?:the\s+)?(?:[\p{Letter}][\p{Letter}&'’-]*\s+){0,3}(?:team|desk|department|contact|enquir(?:y|ies))(?:\s+(?:e-?mail|address|contact))?\b/iu.exec(
      after,
    );
  return Boolean(match && !/\b(?:my|this|that|your)\b/iu.test(match[0]));
}

function literalEmailMentionWasDeclaredThenDisclaimed(
  text: string,
  start: number,
  length: number,
  context: string,
  email: string,
) {
  const before = text.slice(Math.max(0, start - 100), start);
  const declared = /(?:my\s+e-?mail(?:\s+address)?|this\s+(?:e-?mail|address))\s+is\s*$/iu.test(before);
  const after = text.slice(start + length);
  return declared && anaphoricEmailRejectionStarts(after) && emailTurnRejectsTarget(context, email);
}

function clearSelectedEmail(state: VoiceRuntimeState, source: "speech" | "typed"): VoiceRuntimeState {
  return {
    ...state,
    captured: { ...state.captured, email: "" },
    emailVerification: undefined,
    emailVerificationUserTurnSequence: undefined,
    emailVerificationIgnoredTranscriptIds: undefined,
    emailGroundingAwaitingTranscript: undefined,
    activeResponseStaleForEmail: source === "typed" && state.activeResponse ? true : state.activeResponseStaleForEmail,
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
  const ambiguousSpokenDigits = exactPendingCapture && hasAmbiguousSpokenDigitEmail(text, email);
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
    const confidence: VoiceEmailCaptureConfidence = exactPendingCapture && !ambiguousSpokenDigits ? "high" : "medium";
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
  if (getFinalAnaphoricEmailAuthorityDisposition(latestUserText, email) === "disclaimed") {
    return clearSelectedEmail(state, "speech");
  }
  if (!emailCorrectionInvalidates(latestUserText, email)) return state;
  return {
    ...state,
    emailVerification: undefined,
    emailVerificationUserTurnSequence: undefined,
    emailVerificationIgnoredTranscriptIds: undefined,
  };
}

function emailCorrectionInvalidates(text: string, email: string) {
  const finalAnaphoricDisposition = getFinalAnaphoricEmailAuthorityDisposition(text, email);
  if (finalAnaphoricDisposition) return finalAnaphoricDisposition === "disclaimed";
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
  if (
    literalMentions.length > 0 &&
    literalMentions.every((mention) =>
      literalEmailMentionIsIrrelevant(normalizeEmailDecisionText(clause), mention.start, mention.email.length),
    )
  ) {
    return "none";
  }
  if (
    literalMentions.length > 0 &&
    literalMentions.every((mention) =>
      captureHasTrailingAnaphoricRetraction({ key: "email", value: mention.email, evidence: mention.email }, clause),
    )
  ) {
    return "none";
  }
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
    .flatMap((clause) =>
      clause.split(
        /(?:,\s*|\s+and\s+)(?=(?:billing|invoices?|accounts?|support|website|web\s*site|url|homepage|old\s+e-?mail|previous\s+(?:e-?mail|address)|former\s+(?:e-?mail|address)|historical\s+(?:e-?mail|address)|(?:his|her|their|someone\s+else'?s|(?:my\s+)?(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)'?s))\b)/i,
      ),
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
  const recentSpokenSubstitutions = findSpokenEmailSubstitutions(recentUserText, email);
  const recentSpokenSubstitution = recentSpokenSubstitutions.at(-1);
  const spokenSubstitutionDistance = recentSpokenSubstitution?.distance ?? Number.POSITIVE_INFINITY;
  const boundedAsrSupport = hasEmailCue && spokenSubstitutionDistance <= maxAsrEdits;
  if (turnContainsExactEmail(recentUserText, email) && !supersedesRecentEmailGrounding(recentUserText, email)) {
    return {
      ok: true,
      emailConfidence: transcriptionPending || hasAmbiguousSpokenDigitEmail(recentUserText, email) ? "medium" : "high",
    };
  }
  const matchingTurnIndex = recentUserTurns.findLastIndex(
    (entry) => turnContainsExactEmail(entry.text, email) && !supersedesRecentEmailGrounding(entry.text, email),
  );
  if (
    matchingTurnIndex >= 0 &&
    recentUserTurns.slice(matchingTurnIndex + 1).every((entry) => !supersedesRecentEmailGrounding(entry.text, email))
  ) {
    const matchingTurn = recentUserTurns[matchingTurnIndex];
    return {
      ok: true,
      emailConfidence:
        transcriptionPending || (matchingTurn && hasAmbiguousSpokenDigitEmail(matchingTurn.text, email))
          ? "medium"
          : "high",
    };
  }
  // A capture_field call can trail the turn that actually contained the
  // address by a beat (the assistant kept talking, or the tool call fired
  // late). The exact-match check above already looks back across the window
  // for that reason; the approximate/ASR-drift check used to look only at
  // the single latest turn, so a correctly-spoken email with minor ASR drift
  // fell out of grounding purely because the model captured it a turn late.
  // The candidate turn is guarded with unambiguous rejection and replacement
  // language. Broader discourse cues such as "it's" remain legal in a plain
  // first-time statement, but "no", "not", "instead", explicit rejection, a
  // different literal choice, and zero-distance exact matches cannot reopen a
  // value the exact path already rejected.
  const approxMatchingTurnIndex = recentUserTurns.findLastIndex((entry) => {
    const entryHasEmailCue = /@|\b(?:e-?mail|email address)\b|\b(?:at|dot|point|underscore|dash|hyphen|plus)\b/i.test(
      entry.text,
    );
    const entryLiteralEmails = getLiteralEmailMentions(entry.text);
    const literalMismatch = entryLiteralEmails.length > 0 && !entryLiteralEmails.some((m) => m.email === email);
    const substitutions = findSpokenEmailSubstitutions(entry.text, email);
    const substitutionDistance = substitutions[0]?.distance ?? Number.POSITIVE_INFINITY;
    return (
      entryHasEmailCue &&
      substitutionDistance > 0 &&
      substitutionDistance <= maxAsrEdits &&
      !hasEmbeddedEmailCollision(entry.text, email) &&
      !literalMismatch &&
      !approximateEmailTurnRejectsGrounding(entry.text, email, substitutions)
    );
  });
  if (
    approxMatchingTurnIndex >= 0 &&
    recentUserTurns
      .slice(approxMatchingTurnIndex + 1)
      .every((entry) => !supersedesRecentEmailGrounding(entry.text, email))
  ) {
    return { ok: true, emailConfidence: "medium" };
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
  if (approximateEmailTurnRejectsGrounding(recentUserText, email, recentSpokenSubstitutions)) {
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

function approximateEmailTurnRejectsGrounding(
  text: string,
  groundedEmail: string,
  substitutions = findSpokenEmailSubstitutions(text, groundedEmail),
) {
  const literalSelection = resolveLiteralEmailSelection(text, groundedEmail);
  if (literalSelection === "different" || literalSelection === "ambiguous") return true;
  if (emailTurnRejectsTarget(text, groundedEmail)) return true;
  if (approximateEmailMatchDispositionRejects(substitutions)) return true;
  return /\b(?:no|nope|nah|not|never|instead|rather\s+than|wrong|incorrect|do\s+not\s+use|don['’]?t\s+use|dont\s+use|forget|bukan)\b/iu.test(
    text,
  );
}

function approximateEmailMatchDispositionRejects(matches: SpokenEmailSubstitutionMatch[]) {
  let finalDisposition: "selected" | "rejected" | undefined;
  for (const match of matches) {
    if (followingApproximateEmailDispositionRejects(match)) finalDisposition = "rejected";
    else if (precedingApproximateEmailSelectionStarts(match)) finalDisposition = "selected";
  }
  return finalDisposition === "rejected";
}

function precedingApproximateEmailSelectionStarts(match: SpokenEmailSubstitutionMatch) {
  const introduction = match.tokens
    .slice(Math.max(0, match.start - 8), match.start)
    .map((token) => token.toLowerCase())
    .join("");
  return /(?:use|choose|select|prefer|keep|gowith|switchto|contactmeat|contactusat|contactaddress|contactaddressis|reachmeat|reachusat|senditto|myemailis|myemailaddressis|correctemailis|changedto|guna)$/u.test(
    introduction,
  );
}

function followingApproximateEmailDispositionRejects(match: SpokenEmailSubstitutionMatch) {
  const following = match.tokens.slice(match.end).join(" ");
  if (!following) return false;
  if (anaphoricEmailRejectionStarts(following)) return true;
  return /^(?:(?:but|and)\s+)?(?:(?:actually|no|nope|sorry)\s+)?(?:cancel\s+(?:that|this|it)(?:\s+(?:one|e-?mail|address))?|take\s+(?:that|this|it)(?:\s+(?:one|e-?mail|address))?\s+back|(?:replace|change|switch)\s+(?:that|this|it)(?:\s+(?:one|e-?mail|address))?\s+(?:to|with))\b/iu.test(
    following,
  );
}

function hasEmailCorrectionLanguage(text: string) {
  return new RegExp(
    `\\b(?:${CAPTURE_CORRECTION_DISCOURSE_SOURCE}|${CAPTURE_DIRECT_REPLACEMENT_CUE_SOURCE}|instead|rather|correct\\s+that|change|update|wrong|incorrect|not\\s+correct|should\\s+be|forget|replace|switch|bukan)\\b`,
    "iu",
  ).test(text);
}

function getExplicitCorrectedVisitorEmail(text: string) {
  if (!hasEmailCorrectionLanguage(text)) return undefined;
  let mentionOrder = 0;
  const literalMentions = getEmailDecisionClauses(text).flatMap((clause) => {
    const normalizedClause = clause
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "");
    return getLiteralEmailMentions(clause).map((mention) => {
      const disposition = getLiteralEmailMentionDisposition(normalizedClause, mention.start, mention.email.length);
      const selfOwned = hasPrimaryContactOwnershipContext(clause);
      const explicitlySelected = emailTurnSelectsTarget(clause, mention.email);
      const bareCorrection = disposition === "selected" && hasEmailCorrectionLanguage(clause);
      const questionOnly = /\?\s*$/u.test(clause.trim());
      const uncertainCorrection = /\b(?:maybe|perhaps|possibly|probably|i\s+(?:think|guess|suppose))\b/iu.test(clause);
      const selected = !(
        disposition !== "selected" ||
        (!selfOwned && !explicitlySelected && !bareCorrection) ||
        questionOnly ||
        uncertainCorrection ||
        hasSecondaryEmailContext(clause) ||
        hasHistoricalEmailContext(clause) ||
        hasExplicitNonEmailWebContext(clause) ||
        hasThirdPartyEmailOwnershipContext(clause) ||
        emailTurnRejectsTarget(clause, mention.email)
      );
      return {
        email: mention.email,
        disposition,
        selected,
        correctionClause: hasEmailCorrectionLanguage(clause),
        decisiveRevision: /\b(?:i\s+mean(?:t)?|correction|make\s+that|on\s+second\s+thought|thinking\s+again)\b/iu.test(
          clause,
        ),
        order: mentionOrder++,
      };
    });
  });
  const selected = literalMentions.filter((mention) => mention.selected);
  const distinctSelections = [...new Set(selected.map((selection) => selection.email))];
  let selectedEmail = distinctSelections.length === 1 ? distinctSelections[0] : undefined;
  let allowsEarlierSelections = false;

  // A later explicit correction may supersede an earlier plain declaration in
  // the same turn. Multiple competing correction clauses remain ambiguous.
  const correctionSelections = selected.filter((selection) => selection.correctionClause);
  const finalSelection = selected.at(-1);
  if (!selectedEmail && correctionSelections.length === 1 && finalSelection?.correctionClause) {
    selectedEmail = finalSelection.email;
    allowsEarlierSelections = true;
  } else if (!selectedEmail && finalSelection?.decisiveRevision) {
    selectedEmail = finalSelection.email;
    allowsEarlierSelections = true;
  }
  if (!selectedEmail) return undefined;

  // Every different literal in the turn must be explicitly rejected, except
  // earlier selections superseded by a final decisive “I mean”/“correction”
  // clause (or one plain declaration followed by one explicit correction).
  const selectedOrder = selected.findLast((selection) => selection.email === selectedEmail)?.order ?? -1;
  const competingMentionsAreResolved = literalMentions.every(
    (mention) =>
      mention.email === selectedEmail ||
      mention.disposition === "rejected" ||
      (allowsEarlierSelections && mention.selected && mention.order < selectedOrder),
  );
  return competingMentionsAreResolved ? selectedEmail : undefined;
}

function hasThirdPartyEmailOwnershipContext(text: string) {
  return /\b(?:his|her|their|someone\s+else'?s|(?:my\s+)?(?:colleague|coworker|co-worker|manager|assistant|friend|supplier|customer|client|partner)'?s|[\p{Letter}][\p{Letter}'’-]*'s)\s+(?:e-?mail|contact\s+address)\b/iu.test(
    text,
  );
}

function hasContextualEmailCorrection(text: string, groundedEmail: string) {
  const stronglyAnaphoricCorrection =
    /\b(?:i mean(?:t)?|i said)\b/i.test(text) &&
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
      ((domainTokens.length <= 4 && domainTokens.every((candidate) => /^[\p{Letter}\p{Number}-]+$/u.test(candidate))) ||
        (domainTokens.length <= 12 && domainTokens.every((candidate) => /^[\p{Letter}\p{Number}]$/u.test(candidate))));
    const suffixTokens = tokens.slice(atIndex + markerOffset + 2, atIndex + markerOffset + 12);
    const spelledSuffixEnd = suffixTokens.findIndex((candidate) => !/^[\p{Letter}]/u.test(candidate));
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
  const normalizedText = expandAnaphoricContractions(normalizeEmailDecisionText(text));
  const exactMentions = getLiteralEmailMentions(normalizedText).filter((mention) => mention.email === groundedEmail);
  if (exactMentions.length > 1) {
    let finalExplicitDisposition: "selected" | "rejected" | undefined;
    for (const mention of exactMentions) {
      if (literalEmailMentionIsIrrelevant(normalizedText, mention.start, mention.email.length)) continue;
      const disposition = getLiteralEmailMentionDisposition(normalizedText, mention.start, mention.email.length);
      if (disposition !== "neutral") finalExplicitDisposition = disposition;
    }
    // Repeated mentions form a temporal correction chain. A later explicit
    // reaffirmation of the same address wins over an earlier rejection; a
    // later neutral repetition does not silently restore authority.
    if (finalExplicitDisposition === "selected") return false;
    if (finalExplicitDisposition === "rejected") return true;
  }
  const exactGroundedIndex = normalizedText.indexOf(groundedEmail);
  const beforeExactGrounded =
    exactGroundedIndex < 0 ? "" : normalizedText.slice(Math.max(0, exactGroundedIndex - 100), exactGroundedIndex);
  const afterExactGrounded =
    exactGroundedIndex < 0 ? "" : normalizedText.slice(exactGroundedIndex + groundedEmail.length);
  if (
    /(?:my\s+(?:e-?mail|address)|the\s+(?:right|correct)\s+(?:e-?mail|address))\s+(?:is\s+not|isn['’]?t)\s*$/iu.test(
      beforeExactGrounded,
    ) ||
    /^\s*(?:(?:is|was)\s+)?(?:not\s+(?:my\s+(?:e-?mail|address)|the\s+(?:(?:right|correct)\s+(?:e-?mail|address)|one))|isn['’]?t\s+(?:my\s+(?:e-?mail|address)|the\s+(?:(?:right|correct)\s+(?:e-?mail|address)|one)))\b/iu.test(
      afterExactGrounded,
    )
  ) {
    return true;
  }
  if (exactGroundedIndex >= 0 && anaphoricEmailRejectionStarts(afterExactGrounded)) {
    return true;
  }
  if (
    new RegExp(
      `(?:forget\\s+|instead\\s+of\\s+|rather\\s+than\\s+|in\\s+place\\s+of\\s+|replacement\\s+for\\s+|replace\\s+|over\\s+|versus\\s+|bukan\\s+|(?:do\\s+not|don't|dont|not)\\s+(?:use\\s+)?)${escapedEmail}|${escapedEmail}\\s+(?:(?:was|is|looks?)\\s+)?(?:wrong|incorrect|not\\s+(?:right|correct|mine|the\\s+one)|a\\s+typo)|${escapedEmail}\\s+isn['’]?t\\s+(?:right|correct|mine|my\\s+(?:e-?mail|address))|${escapedEmail}\\s*[,;:—–-]?\\s*(?:(?:actually|no|nope|sorry)[,;:\\s—–-]*)?(?:(?:that(?:\\s+(?:one|e-?mail|address))?|this(?:\\s+(?:one|e-?mail|address))?|it)\\s+(?:(?:is|was|looks?)\\s+)?(?:wrong|incorrect|not\\s+(?:right|correct|mine|it|the\\s+one)|isn['’]?t\\s+(?:right|correct|mine|it)|a\\s+typo|my\\s+(?:old|previous|former|historical)\\s+(?:e-?mail|address))|not\\s+(?:that(?:\\s+(?:one|e-?mail|address))?|this(?:\\s+(?:one|e-?mail|address))?|it))|(?:change|replace|update)\\s+${escapedEmail}\\s+(?:to|with)`,
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
    /^(?:(?:was|is|looks?)?(?:wrong|incorrect|notright|notcorrect|notmine|atypo)|isnt(?:right|correct|mine))/.test(
      afterGrounded,
    ) ||
    /^(?:(?:actually|no|nope|sorry))?(?:thatone|thatemail|thataddress|that|thisone|thisemail|thisaddress|this|it)(?:(?:is|was|looks?))?(?:wrong|incorrect|notright|notcorrect|notmine|isntright|isntcorrect|isntmine|atypo)/.test(
      afterGrounded,
    ) ||
    /^(?:(?:actually|no|nope|sorry))?not(?:thatone|thatemail|thataddress|that|thisone|thisemail|thisaddress|this|it)/.test(
      afterGrounded,
    ) ||
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
    /(?:instead\s+of|rather\s+than|bukan|do\s+not\s+use|don't\s+use|dont\s+use|not|(?:my\s+(?:e-?mail|address))\s+(?:is\s+not|isn['’]?t))\s*$/i.test(
      before,
    ) ||
    /^\s*(?:(?:was|is|looks?)\s+)?(?:wrong|incorrect|not\s+(?:right|correct|mine|my\s+(?:e-?mail|address)|the\s+(?:(?:right|correct)\s+(?:e-?mail|address)|one))|isn['’]?t\s+(?:right|correct|mine|my\s+(?:e-?mail|address)|the\s+(?:(?:right|correct)\s+(?:e-?mail|address)|one)))/i.test(
      after,
    )
  ) {
    return "rejected";
  }
  if (
    /(?:use|choose|select|prefer|keep|go\s+with|switch\s+to|contact\s+(?:me|us)\s+at|contact\s+address(?:\s+is)?|reach\s+(?:me|us)\s+at|send\s+it\s+to|my\s+(?:(?:correct|preferred|primary|current)\s+)*e-?mail(?:\s+address)?\s+is|it(?:\s+is|['’]s)|that(?:\s+is|['’]s)|changed?\s+to|guna)\s*$/i.test(
      before,
    ) ||
    new RegExp(`${CAPTURE_ANY_CORRECTION_CUE_SOURCE}\\b${CAPTURE_CORRECTION_CUE_NOISE_SOURCE}$`, "iu").test(before) ||
    /^\s*(?:(?:is|was)\s+)?(?:right|correct|still\s+my\s+(?:e-?mail|address)|my\s+(?:e-?mail|address)|the\s+(?:right|correct)\s+(?:e-?mail|address|one))\b/i.test(
      after,
    )
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
      `(?:use|choose|select|prefer|keep|go\\s+with|switch\\s+to|contact\\s+(?:me|us)\\s+at|contact\\s+address(?:\\s+is)?|reach\\s+(?:me|us)\\s+at|send\\s+it\\s+to|(?:my\\s+)?(?:correct\\s+)?e-?mail(?:\\s+address)?\\s+is|changed?\\s+to|guna)\\s+${escapedEmail}|(?:use|choose|select|prefer|keep)\\s+(?:my|this|that)\\s+(?:[\\p{Letter}][\\p{Letter}&'’-]*\\s+){0,3}(?:e-?mail|address|contact)\\s+${escapedEmail}`,
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
      /(?:use|choose|select|prefer|keep|gowith|switchto|contactmeat|contactusat|contactaddress|contactaddressis|reachmeat|reachusat|senditto|myemailis|myemailaddressis|correctemailis|changedto|guna)$/.test(
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
  const separator = either
    ? firstAlternativeOr.exec(text)?.index
    : (both?.index ?? firstAlternativeOr.exec(text)?.index);
  if (separator === undefined) return undefined;

  const cues = Array.from(
    text.matchAll(
      /\b(?:actually|i\s+meant|correction|use|choose|select|prefer|keep|go\s+with|switch\s+to|changed?\s+to|guna)\b/gi,
    ),
  ).filter((match) => (match.index ?? -1) > separator);
  const cue = cues.at(-1);
  return cue?.index === undefined ? undefined : text.slice(cue.index);
}

function getFinalAlternativeLiteralSelection(text: string) {
  const finalSelectionText = postAlternativeSelectionText(text);
  if (!finalSelectionText) return undefined;
  const selected = getLiteralEmailMentions(finalSelectionText)
    .filter((mention) => emailTurnSelectsTarget(finalSelectionText, mention.email))
    .map((mention) => mention.email);
  const distinct = [...new Set(selected)];
  return distinct.length === 1 ? (distinct[0] as string) : undefined;
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
type SpokenEmailSubstitutionMatch = {
  candidate: string;
  distance: number;
  start: number;
  end: number;
  tokens: string[];
};

function findSpokenEmailSubstitutions(text: string, groundedEmail: string): SpokenEmailSubstitutionMatch[] {
  const tokens = getEmailSpeechTokens(text);
  let bestDistance = Number.POSITIVE_INFINITY;
  let best: SpokenEmailSubstitutionMatch[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      for (const candidate of emailSpeechInterpretationsForWindow(tokens, start, end).map(({ value }) => value)) {
        if (candidate.length !== groundedEmail.length || !isLikelyEmail(candidate)) continue;
        if (introducesUnspokenHomophoneDigit(tokens, start, end, candidate, groundedEmail)) continue;
        const distance = fullEditDistance(candidate, groundedEmail);
        const match = { candidate, distance, start, end, tokens };
        if (distance < bestDistance) {
          bestDistance = distance;
          best = [match];
        } else if (
          distance === bestDistance &&
          !best.some(
            (existing) =>
              existing.start === match.start && existing.end === match.end && existing.candidate === match.candidate,
          )
        ) {
          best.push(match);
        }
      }
    }
  }
  return best.sort((left, right) => left.start - right.start || left.end - right.end);
}

function spokenEmailSubstitutionDistance(left: string, right: string) {
  return findSpokenEmailSubstitutions(left, right)[0]?.distance ?? Number.POSITIVE_INFINITY;
}

function getEmailSpeechTokens(text: string) {
  return (
    text
      .match(/[\p{Letter}\p{Number}@._+-]+/gu)
      ?.map((token) => token.replace(/^[._+-]+|[._+-]+$/gu, ""))
      .filter((token) => /[\p{Letter}\p{Number}@]/u.test(token)) ?? []
  );
}

function introducesUnspokenHomophoneDigit(
  tokens: string[],
  start: number,
  end: number,
  candidate: string,
  groundedEmail: string,
) {
  const introducesDigit = [...groundedEmail].some(
    (character, index) => /[0-9]/u.test(character) && !/[0-9]/u.test(candidate[index] ?? ""),
  );
  if (!introducesDigit) return false;
  return tokens.slice(start, end).some((token) => /^(?:to|too|for)$/iu.test(token));
}

function hasEmbeddedEmailCollision(text: string, groundedEmail: string) {
  const tokens = getEmailSpeechTokens(text);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      for (const candidate of emailSpeechInterpretationsForWindow(tokens, start, end).map(({ value }) => value)) {
        if (
          candidate !== groundedEmail &&
          isLikelyEmail(candidate) &&
          (candidate.includes(groundedEmail) || groundedEmail.includes(candidate))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function hasAmbiguousSpokenDigitEmail(text: string, groundedEmail: string) {
  const target = groundedEmail.trim().toLowerCase();
  const selectedLiteralTarget =
    getLiteralEmailMentions(text).some((mention) => mention.email === target) &&
    resolveLiteralEmailSelection(text, target) === "current";
  if (selectedLiteralTarget) return false;

  for (const clause of getEmailDecisionClauses(text)) {
    const tokens = getEmailSpeechTokens(clause);
    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
        const interpretations = getSpokenEmailInterpretations(tokens.slice(start, end).join(" "))
          .map(({ value }) => value)
          .filter(isLikelyEmail);
        if (
          new Set(interpretations).size > 1 &&
          interpretations.includes(target) &&
          !emailWindowHasExplicitDigitIntent(tokens, start, end)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function emailWindowHasExplicitDigitIntent(tokens: string[], start: number, end: number) {
  const targetContainsSpokenDigit = tokens
    .slice(start, end)
    .some((token) => Object.hasOwn(SPOKEN_DIGIT_WORDS, token.toLowerCase()));
  if (!targetContainsSpokenDigit) return false;

  for (let contextIndex = start - 1; contextIndex >= 0; contextIndex -= 1) {
    const context = tokens[contextIndex]?.toLowerCase() ?? "";
    if (!/^(?:digit|digits|number|numbers|numeric|numeral|numerals)$/u.test(context)) continue;
    const preceding = tokens.slice(0, contextIndex).map((token) => token.toLowerCase());
    if (preceding.some((token) => /^(?:no|not|never|without|don['’]?t|dont|isn['’]?t|isnt)$/u.test(token))) {
      continue;
    }
    const attachment = tokens
      .slice(contextIndex + 1, start)
      .map((token) => token.toLowerCase())
      .join(" ");
    if (
      !/^(?:(?:(?:for\s+)?(?:my\s+)?e-?mail(?:\s+address)?(?:\s+is)?)|(?:(?:for\s+)?(?:the\s+)?(?:local\s+part|mailbox)(?:\s+is)?))?$/u.test(
        attachment,
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function emailSpeechInterpretationsForWindow(tokens: string[], start: number, end: number) {
  const interpretations = getSpokenEmailInterpretations(tokens.slice(start, end).join(" "));
  return emailWindowHasExplicitDigitIntent(tokens, start, end)
    ? interpretations.filter(({ kind }) => kind !== "literal")
    : interpretations;
}

function findExactEmailTokenWindow(text: string, groundedEmail: string, minimumStart = 0) {
  // Canonicalize bounded token windows rather than the whole sentence. This
  // accepts "q a dot nebula at example dot test" while preventing
  // a@example.com from matching inside qa@example.com.
  const tokens = getEmailSpeechTokens(text);
  for (let start = minimumStart; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 18); end += 1) {
      if (!emailSpeechInterpretationsForWindow(tokens, start, end).some(({ value }) => value === groundedEmail))
        continue;
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
      const nextToken = tokens[end]?.toLowerCase();
      const endsInsideSpelledDomain = Boolean(
        nextToken && (/^[\p{Letter}\p{Number}]$/u.test(nextToken) || /^(?:dot|point|dash|hyphen)$/.test(nextToken)),
      );
      if (!startsInsideSpelledLocalPart && !endsInsideSpelledDomain) return { start, end, tokens };
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

const SPOKEN_DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function canonicalizeEmailSpeech(value: string, foldSpokenDigits = true): string {
  let canonical = collapseHyphenSeparatedLetterRun(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "");
  if (foldSpokenDigits) {
    canonical = canonical.replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gu,
      (word) => SPOKEN_DIGIT_WORDS[word] ?? word,
    );
  }
  return canonical
    .replace(/\bat\s+sign\b/gu, " @ ")
    .replace(/\b(at)\b/gu, " @ ")
    .replace(/\b(dot|point)\b/gu, " . ")
    .replace(/\b(underscore)\b/gu, " _ ")
    .replace(/\b(dash|hyphen)\b/gu, " - ")
    .replace(/\b(plus)\b/gu, " + ")
    .replace(/[^\p{Letter}\p{Number}@._+-]+/gu, "");
}

type SpokenEmailInterpretation = {
  value: string;
  kind: "numeric" | "literal" | "unambiguous";
};

function getSpokenEmailInterpretations(value: string): SpokenEmailInterpretation[] {
  const numeric = canonicalizeEmailSpeech(value, true);
  const literal = canonicalizeEmailSpeech(value, false);
  return numeric === literal
    ? [{ value: numeric, kind: "unambiguous" }]
    : [
        { value: numeric, kind: "numeric" },
        { value: literal, kind: "literal" },
      ];
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
  const fragments = text.split(/(?:[!?]+|[.;]+\s+(?=[A-Z]))\s*/u).filter(Boolean);
  const candidates = fragments.length > 1 ? fragments : [text];
  const expected = email.trim().toLowerCase();
  if (getLiteralEmailMentions(text).some((mention) => mention.email !== expected)) return false;
  let foundExpected = false;

  for (const value of candidates) {
    const stripTrailingContext = (candidate: string) =>
      candidate
        .replace(
          /[,.!;:\-–—\s]*(?:(?:is|was)\s+that(?:\s+exactly)?\s+(?:right|correct)|did\s+i\s+(?:get|hear|capture)\s+that\s+(?:right|correct)|have\s+i\s+got\s+that\s+(?:right|correct)|(?:right|correct))\s*[?.!]*$/iu,
          "",
        )
        .replace(/[\s"'“”‘’\])}.!?,;:]+$/u, "")
        .trim();
    let candidate = stripTrailingContext(value.trim());

    let previous = "";
    while (candidate && candidate !== previous) {
      // Stop before conversational-prefix stripping can eat a legitimate
      // local part such as `right@`, `okay@`, or `confirm@`.
      if (canonicalizeEmailSpeech(candidate) === expected) {
        foundExpected = true;
        candidate = "";
        break;
      }
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
    }
  }

  foundExpected ||= hasExpectedEmailReadbackWindow(text, expected);
  return (
    foundExpected &&
    !finalExpectedReadbackIsRetracted(text, expected) &&
    !earlierReadbackDiscourseIsUncertain(text, expected) &&
    !hasCompetingSpokenEmailReadback(text, expected)
  );
}

function earlierReadbackDiscourseIsUncertain(text: string, expected: string) {
  const clauses = text
    .split(/(?:[!?;]+|[.]+\s+(?=[A-Z]))\s*/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const finalTargetClause = clauses.findLastIndex((clause) => findExactEmailTokenWindow(clause, expected));
  if (finalTargetClause < 1) return false;
  return clauses.slice(0, finalTargetClause).some((clause) => {
    const normalized = clause.trim().replace(/^[,;:.!?\s-]+|[,;:.!?\s-]+$/gu, "");
    if (
      /\byour\s+(?:e-?mail(?:\s+address)?|address)\b/iu.test(normalized) &&
      /\b(?:not|cannot|can['’]?t|cant|doubt|doubtful|unclear|uncertain|unsure|tentative|wrong|mistaken|hesitant|unconvinced|guarantee|verify|confirm|anybody['’]?s\s+guess)\b/iu.test(
        normalized,
      )
    ) {
      return true;
    }
    return /^(?:no|maybe|perhaps|possibly|unclear|uncertain|tentatively|not\s+sure|no\s+idea|who\s+knows|hard\s+to\s+say|low\s+confidence|confidence\s+is\s+low|without\s+confidence|pure\s+speculation|take\s+this\s+with\s+a\s+grain\s+of\s+salt|i\s+(?:do\s+not|don['’]?t|dont)\s+know|i\s+have\s+(?:no\s+idea|no\s+confidence)|i\s+(?:cannot|can['’]?t|cant)\s+tell|i\s+(?:am\s+)?(?:not\s+convinced|not\s+certain|not\s+sure|not\s+confident|unsure|uncertain|hesitant(?:\s+to\s+say)?|unconvinced|(?:only\s+)?guessing|speculating)|i\s+(?:have|have\s+only)\s+low\s+confidence|i\s+(?:do\s+not|don['’]?t|dont)\s+believe|i\s+(?:cannot|can['’]?t|cant)\s+(?:confirm|verify|guarantee|establish|be\s+sure|vouch)|i\s+(?:may|might)\s+be\s+wrong|i\s+could\s+be\s+(?:wrong|mistaken)|i\s+(?:doubt|question)(?:\s+whether)?|it\s+is\s+(?:doubtful|unclear|uncertain)|this\s+is\s+(?:my\s+best\s+guess|speculative)|(?:that|this|it)\s+(?:may|might|could)\s+be\s+(?:wrong|mistaken))$/iu.test(
      normalized,
    );
  });
}

function finalExpectedReadbackIsRetracted(text: string, expected: string) {
  let finalWindow = findExactEmailTokenWindow(text, expected);
  if (!finalWindow) return false;
  let nextWindow = findExactEmailTokenWindow(text, expected, finalWindow.end);
  while (nextWindow) {
    finalWindow = nextWindow;
    nextWindow = findExactEmailTokenWindow(text, expected, finalWindow.end);
  }
  const preceding = finalWindow.tokens.slice(0, finalWindow.start).join(" ").toLowerCase().trim();
  if (emailIntroductionRejectsFinalMention(preceding)) return true;
  const following = finalWindow.tokens.slice(finalWindow.end, finalWindow.end + 24).join(" ");
  const normalized = following
    .toLowerCase()
    .replace(/^(?:(?:but|though|however|which|and|or)\s+)+/u, "")
    .replace(/^(?:(?:actually|no|nope|sorry)\s+)+/u, "")
    .trim();
  if (!normalized || /^if\b/u.test(normalized)) return false;
  if (anaphoricEmailRejectionStarts(normalized)) return true;
  return /^(?:i\s+got\s+(?:that|it)\s+wrong|(?:that|this|it)(?:\s+(?:one|e-?mail|address))?\s+(?:is|was)\s+(?:wrong|incorrect|outdated|the\s+(?:old|previous|former)\s+e-?mail)|(?:is\s+)?(?:wrong|incorrect|outdated|not\s+correct|maybe\s+not)|at\s+first\b.{0,40}\bnot\s+anymore|(?:scratch|forget|ignore)\s+(?:that|this|it)|(?:do\s+not|don't|dont)\s+use\s+(?:that|this|it))\b/iu.test(
    normalized,
  );
}

function emailIntroductionRejectsFinalMention(text: string) {
  const action = "(?:use|send(?:\\s+to)?|contact|route(?:\\s+to)?)";
  const readbackWrapper =
    "(?:your\\s+(?:e-?mail|address)(?:\\s+address)?\\s+(?:is|was)|the\\s+(?:e-?mail|address)(?:\\s+address)?\\s+(?:is|was)|i\\s+(?:heard|got|captured)?)";
  if (
    new RegExp(
      `(?:^|\\s)(?:it\\s+(?:would\\s+be\\s+wrong|is\\s+incorrect)\\s+(?:to\\s+say|that)|i\\s+(?:cannot|can\\s+t|cant)\\s+(?:confirm|verify|say)|i\\s+am\\s+not\\s+saying|i\\s+(?:am\\s+)?(?:unsure|uncertain)|i\\s+doubt|(?:do\\s+not|don\\s+t|dont)\\s+assume|maybe|possibly|perhaps)(?:\\s+${readbackWrapper})?\\s*$`,
      "iu",
    ).test(text)
  ) {
    return true;
  }
  return new RegExp(
    `(?:^|\\s)(?:(?:please\\s+)?(?:(?:(?:you|we|i)\\s+)?(?:do|should|must|can)\\s+not\\s+${action}|(?:(?:you|we|i)\\s+)?(?:cannot|can\\s+t|cant|never|no\\s+longer)\\s+${action}|(?:(?:(?:you|we|i)\\s+)?(?:are|is)\\s+)?not\\s+supposed\\s+to\\s+${action}|stop\\s+(?:using|sending(?:\\s+to)?|contacting|routing(?:\\s+to)?)|(?:avoid|exclude|discard|reject|remove|forget|ignore|scratch|retract)|instead\\s+of|rather\\s+than|not|i\\s+did\\s+not\\s+hear|i\\s+didn\\s+t\\s+hear|i\\s+never\\s+heard))\\s*$`,
    "iu",
  ).test(text);
}

function hasExpectedEmailReadbackWindow(text: string, expected: string) {
  const clauses = text
    .split(/(?:[!?;]+|[.]+\s+(?=[A-Z]))\s*/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    let window = findExactEmailTokenWindow(clause, expected);
    while (window) {
      const prefix = window.tokens
        .slice(0, window.start)
        .map((token) => token.toLowerCase())
        .join("");
      const prefixText = window.tokens
        .slice(0, window.start)
        .map((token) => token.toLowerCase())
        .join(" ");
      const wrappersOnly = /^(?:(?:okay|ok|alright|right|so|and|great|perfect|thanks|thankyou))*$/.test(prefix);
      const positiveReadback =
        /^(?:(?:okay|ok|alright|right|so|and|great|perfect|thanks|thankyou))*(?:iheard|ialsoheard|ihave|ialsohave|icaptured|iwrotedown|youremailis|youremailwas|theemailis|theaddressis|theaddressiheardis|justtoconfirmyouremailis|toconfirmyouremailis|confirmyouremailis|readthatbackas|readitbackas)$/.test(
          prefix,
        );
      const wrappedAfterNonEmailContext =
        /(?:^|\s)(?:(?:and|so)\s+)?(?:your\s+(?:e-?mail|address)(?:\s+address)?|the\s+(?:e-?mail|address)(?:\s+address)?)\s+(?:is|was)\s*$/u.exec(
          prefixText,
        );
      const leadingContext = wrappedAfterNonEmailContext
        ? prefixText.slice(0, wrappedAfterNonEmailContext.index).trim()
        : "";
      if (
        wrappersOnly ||
        positiveReadback ||
        (leadingContext.length > 0 && hasExplicitNonEmailReadbackContext(leadingContext))
      ) {
        return true;
      }
      window = findExactEmailTokenWindow(clause, expected, window.end);
    }
  }
  return false;
}

/**
 * Remove every exact target token window, then look for a second address shape
 * inside the remaining clause-local gaps. Clause-local cues catch wrapped
 * readbacks; a strict address-at-clause-start rule catches bare readbacks while
 * ignoring prose such as "read more at oriental dot mereka dot io".
 */
function hasCompetingSpokenEmailReadback(text: string, expected: string) {
  const clauses = text
    .split(/(?:[!?;]+|[.]+\s+(?=[A-Z]))\s*/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  for (const clause of clauses) {
    const gaps = emailTokenGapsWithoutExpected(clause, expected);
    for (const gap of gaps) {
      if (!containsReadbackEmailShape(gap)) continue;
      if (!hasExplicitNonEmailReadbackContext(gap)) return true;
    }
  }
  return false;
}

function emailTokenGapsWithoutExpected(text: string, expected: string) {
  const tokens = getEmailSpeechTokens(text);
  const ranges: Array<{ start: number; end: number }> = [];
  let window = findExactEmailTokenWindow(text, expected);
  while (window) {
    ranges.push({ start: window.start, end: window.end });
    window = findExactEmailTokenWindow(text, expected, window.end);
  }
  if (ranges.length === 0) return [text];

  const gaps: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) gaps.push(tokens.slice(cursor, range.start).join(" "));
    cursor = range.end;
  }
  if (cursor < tokens.length) gaps.push(tokens.slice(cursor).join(" "));
  return gaps;
}

function containsReadbackEmailShape(text: string) {
  const tokens = getReadbackEmailSpeechTokens(text).map((token) => token.toLowerCase());
  for (let marker = 0; marker < tokens.length; marker += 1) {
    const markerToken = tokens[marker] ?? "";
    if (markerToken !== "at" && markerToken !== "@" && !markerToken.includes("@")) continue;
    const localStart = readbackLocalPartStart(tokens, marker);
    if (localStart === null || !readbackCandidateHasEmailContext(tokens, localStart, marker)) continue;
    for (let end = marker + 1; end <= Math.min(tokens.length, localStart + 28); end += 1) {
      if (isLikelyEmail(canonicalizeEmailSpeech(tokens.slice(localStart, end).join(" ")))) return true;
    }
  }
  return false;
}

function readbackLocalPartStart(tokens: string[], marker: number) {
  const markerToken = tokens[marker] ?? "";
  if (markerToken.includes("@") && markerToken !== "@") {
    return markerToken.split("@")[0]?.length ? marker : null;
  }
  if (marker < 1) return null;
  let start = marker - 1;
  if (/^[\p{Letter}\p{Number}]$/u.test(tokens[start] ?? "")) {
    while (
      start > 0 &&
      (/^[\p{Letter}\p{Number}]$/u.test(tokens[start - 1] ?? "") ||
        /^(?:dot|point|underscore|dash|hyphen|plus)$/u.test(tokens[start - 1] ?? ""))
    ) {
      start -= 1;
    }
  }
  return start;
}

function readbackCandidateHasEmailContext(tokens: string[], localStart: number, marker: number) {
  if (localStart === marker) return /[\p{Letter}\p{Number}]@/u.test(tokens[marker] ?? "");
  return localStart < marker && tokens.slice(localStart, marker).some((token) => /[\p{Letter}\p{Number}]/u.test(token));
}

function getReadbackEmailSpeechTokens(text: string) {
  return (
    text
      .match(/[\p{Letter}\p{Number}@._+-]+/gu)
      ?.map((token) => (token === "." ? "dot" : token.replace(/^[+_-]+|[+_-]+$/gu, "")))
      .filter((token) => /[\p{Letter}\p{Number}@]/u.test(token)) ?? []
  );
}

function hasExplicitNonEmailReadbackContext(text: string) {
  if (/\b(?:e-?mail|address|heard|captured|wrote\s+down|do\s+not\s+use|don't\s+use|dont\s+use)\b/iu.test(text)) {
    return false;
  }
  const atCount = getEmailSpeechTokens(text).filter((token) => token.toLowerCase() === "at").length;
  if (atCount !== 1) return false;
  return (
    /\b(?:the|our)\s+(?:website|web\s*site|url|homepage|site\s+link|directions)\s+(?:is|are)\s+at\b/iu.test(text) ||
    /\b(?:read\s+more|learn\s+more|find\s+us|follow\s+us|see\s+us|contact\s+us|reach\s+us|visit\s+us|meet(?:ing)?(?:\s+us)?|located|our\s+office\s+is)\s+at\b/iu.test(
      text,
    ) ||
    /\b(?:i|we|they)\s+have\s+(?:a|an)\s+(?:workshop|call|session|booking|meeting|event|class|visit)\s+at\b/iu.test(
      text,
    ) ||
    /\b(?:the|our|my)\s+(?:workshop|call|session|booking|meeting|event|class|visit)\s+(?:is|was)\s+at\b/iu.test(text) ||
    /\b(?:workshop|call|session|meeting|event|class)\s+(?:starts?|begins?)\s+at\s+(?:[\p{Number}]|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(?:dot|point)\s+(?:[\p{Number}]|zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty))?\b/iu.test(
      text,
    ) ||
    /\b(?:section|appendix|version)\s+at\b/iu.test(text) ||
    /\b(?:the|our)\s+(?:budget|rating|score|cost|price)\s+(?:is|was|sits?)\s+at\s+(?:[\p{Number}]|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)+(?:\s+(?:point|dot)\s+(?:[\p{Number}]|zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|million|billion)+)?\b/iu.test(
      text,
    ) ||
    /\b(?:the|our)\s+release\s+(?:is|was)\s+at\s+version\s+(?:dot|point)\s+[\p{Letter}\p{Number}]+\b/iu.test(text) ||
    /^(?:at\s+(?:level|floor|unit|room|hall|table|zoom|the\s+(?:building|venue|location)))\b/iu.test(text) ||
    /\b(?:i\s+am|we\s+are|they\s+are)\s+at\s+(?:level|floor|unit|room|hall|table|zoom|the\s+(?:building|venue|location))\b/iu.test(
      text,
    )
  );
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
