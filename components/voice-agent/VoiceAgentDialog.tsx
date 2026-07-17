"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import { type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import { trackIntakeEvent } from "@/lib/client-analytics";
import { leadFormSchema } from "@/lib/schemas";
import { getSegment, type SegmentId, segmentOptions } from "@/lib/segments";
import { cn } from "@/lib/utils";
import {
  type RealtimeOutboundEvent,
  serializeHandoffContext,
  serializeResponseCreate,
  serializeTypedTurn,
} from "@/lib/voice/client-events";
import {
  endConversation,
  resolveConversationId,
  shouldResumeVoiceConversation,
  touchConversation,
} from "@/lib/voice/conversation";
import { forgetHandoff, recallHandoff, rememberHandoff } from "@/lib/voice/handoff-memory";
import {
  fieldProvenanceCounts,
  type SubmissionMethod,
  summarizeFieldProvenance,
  type VoiceEntryMethod,
  type VoiceEntryPoint,
} from "@/lib/voice/interaction-attribution";
import type { VoiceToolName, VoiceToolOutcome } from "@/lib/voice/latency";
import {
  fetchWithTimeout,
  LEAD_SUBMIT_TIMEOUT_MS,
  type LeadSubmitResponse,
  leadSubmitErrorCopy,
  notificationDelivered,
} from "@/lib/voice/lead-submit";
import {
  type CapturedLead,
  emptyCapturedLead,
  isVoiceEmailConfirmed,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";
import {
  buildVoiceReviewSnapshot,
  postVoiceReviewSnapshot,
  type VoiceReviewCredentials,
} from "@/lib/voice/review-snapshot";
import { DEFAULT_VOICE_VARIANT_ID, VOICE_VARIANTS, type VoiceVariantId } from "@/lib/voice/variants";
import { HandoffPanel } from "./HandoffPanel";
import { playArmCue, playLiveCue } from "./live-chime";
import {
  useRealtimeVoiceSession,
  type VoiceCloseReason,
  type VoiceConnectionStatus,
  type VoiceReviewMetadata,
} from "./useRealtimeVoiceSession";
import { useVoiceRuntime } from "./useVoiceRuntime";
import { VoiceSessionStage } from "./VoiceSessionStage";
import { VoiceSubmittedConfirmation } from "./VoiceSubmittedConfirmation";
import {
  idleGoodbyeInstruction,
  openingVoiceInstruction,
  reconnectVoiceInstruction,
  voiceCloseReasonToast,
  voiceToastIds,
} from "./voice-dialog-copy";
import { useVoice } from "./voice-state";
import { readTunerFlag } from "./voice-tuner";

// How often a live call persists a full review snapshot, so state survives even
// when the final close snapshot is lost to a tab close or network drop.
const VOICE_HEARTBEAT_INTERVAL_MS = 12_000;

type VoiceAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: SegmentId;
  prefill?: {
    email?: string;
    mode?: "voice" | "form";
    autoStart?: boolean;
    activation?: ReturnType<typeof playArmCue>;
    entryPoint?: VoiceEntryPoint;
    entryMethod?: VoiceEntryMethod;
  };
  /** Bumped on talk-CTA hover/focus: pre-mint a session before the tap. */
  prewarmSignal?: number;
  /** QA voice variant id, threaded to the session mint. */
  voiceVariant?: VoiceVariantId;
};

export function VoiceAgentDialog({
  open,
  onOpenChange,
  intent,
  prefill,
  prewarmSignal,
  voiceVariant,
}: VoiceAgentDialogProps) {
  const [status, setStatus] = useState<"idle" | "submitted">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [emailAttention, setEmailAttention] = useState<"rejected" | "pending" | "route_blocked" | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  // Stable across every call/reconnect in one intake; resolved on open so a
  // dropped-and-resumed conversation stitches to a single thread in review.
  const [conversationId, setConversationId] = useState<string>("");
  const conversationIdRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const submittingRef = useRef(false);
  const submittedLeadIdRef = useRef<string | null>(null);
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const dialogLayoutRef = useRef<HTMLDivElement | null>(null);
  const mobileEmailRef = useRef<HTMLInputElement | null>(null);
  const emailEditorOwnedFocusRef = useRef(false);
  const lastSyncedHandoffRef = useRef("");
  const openedVoiceTurnRef = useRef(false);
  const activeEntryPointRef = useRef<VoiceEntryPoint | null>(null);
  const activeEntryMethodRef = useRef<VoiceEntryMethod | null>(null);
  const voiceStartTrackedRef = useRef(false);
  const reviewRef = useRef<VoiceReviewMetadata | null>(null);
  const localReviewRef = useRef<VoiceReviewCredentials | null>(null);
  const teardownVoiceRef = useRef<((reason: VoiceCloseReason) => void) | null>(null);
  const sendClientEventsRef = useRef<((events: RealtimeOutboundEvent | RealtimeOutboundEvent[]) => boolean) | null>(
    null,
  );
  const connectionStatusRef = useRef<VoiceConnectionStatus>("idle");
  const postCloseSnapshotRef = useRef<((reason: VoiceCloseReason) => void) | null>(null);
  const recordToolDurationRef = useRef<
    ((sample: { at: number; durationMs: number; name: VoiceToolName; outcome: VoiceToolOutcome }) => void) | null
  >(null);
  const prewarmSnapshotIdsRef = useRef<Set<string>>(new Set());
  const [reviewMetadata, setReviewMetadata] = useState<VoiceReviewMetadata | null>(null);

  const currentReviewCredentials = useCallback((): VoiceReviewCredentials | null => {
    if (reviewRef.current) return reviewRef.current;
    if (process.env.NODE_ENV === "production") return null;
    localReviewRef.current ??= { id: crypto.randomUUID(), token: "local-development-review-token" };
    return localReviewRef.current;
  }, []);

  const handleVoiceClose = useCallback((reason: VoiceCloseReason) => {
    postCloseSnapshotRef.current?.(reason);
    const copy = voiceCloseReasonToast(reason);
    if (!copy) return;
    if (copy.tone === "error") {
      toast.error(copy.title, { description: copy.description, id: voiceToastIds.close });
      return;
    }
    if (copy.tone === "warning") {
      toast.warning(copy.title, { description: copy.description, id: voiceToastIds.close });
      return;
    }
    toast.message(copy.title, { description: copy.description, id: voiceToastIds.close });
  }, []);

  const formRef = useRef<UseFormReturn<CapturedLead> | null>(null);

  const focusCapturedField = useCallback(
    (key: keyof CapturedLead, reason: "rejected" | "pending" | "route_blocked" = "rejected") => {
      if (key !== "email") {
        formRef.current?.setFocus(key);
        return;
      }
      setEmailAttention(reason);
      window.requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 63.999rem)").matches) {
          const editor = mobileEmailRef.current;
          editor?.focus();
          editor?.select();
          editor?.closest<HTMLElement>("[data-email-quick-capture]")?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          });
          return;
        }
        formRef.current?.setFocus("email");
      });
    },
    [],
  );

  const submit = useCallback(
    async (submissionMethod: SubmissionMethod, leadState: VoiceRuntimeState): Promise<Record<string, unknown>> => {
      if (submittingRef.current) return { ok: false, error: "submission_in_progress" };
      submittingRef.current = true;
      setSubmitting(true);
      const fieldProvenance = summarizeFieldProvenance(leadState.captured, leadState.fieldProvenance);
      const fieldCounts = fieldProvenanceCounts(fieldProvenance);
      const entryPoint = activeEntryPointRef.current ?? "unknown";
      const entryMethod = activeEntryMethodRef.current ?? "unknown";
      const voiceEngaged =
        submissionMethod === "voice_command" ||
        Boolean(reviewRef.current?.activationAttempted || reviewRef.current?.connectedAt || openedVoiceTurnRef.current);
      const source = voiceEngaged ? "voice" : "form";
      const analytics = {
        entry_point: entryPoint,
        entry_method: entryMethod,
        submission_method: submissionMethod,
        session_mode: source,
        completed_field_count: fieldCounts.completed,
        voice_field_count: fieldCounts.voice,
        manual_field_count: fieldCounts.manual,
        mixed_field_count: fieldCounts.mixed,
        corrected_field_count: fieldCounts.corrected,
      } as const;
      trackIntakeEvent("intake_submit_attempt", analytics);
      try {
        if (submissionMethod === "voice_command" && !isVoiceEmailConfirmed(leadState)) {
          focusCapturedField("email", "route_blocked");
          toast.error("Please check the highlighted email once.", {
            description: "Edit it if needed, then press Send enquiry. Reka will not make you spell it out again.",
          });
          trackIntakeEvent("intake_submit_failure", { ...analytics, failure_class: "email_check_required" });
          return { ok: false, error: "voice_email_unconfirmed" };
        }
        const parsed = leadFormSchema.safeParse(leadState.captured);
        if (!parsed.success) {
          if (submissionMethod === "handoff_button") void formRef.current?.trigger();
          toast.error("Please fix the highlighted details.", {
            description: "A valid email is required before sending — everything else is optional.",
          });
          trackIntakeEvent("intake_submit_failure", { ...analytics, failure_class: "invalid_fields" });
          return { ok: false, error: "invalid_lead", details: parsed.error.flatten() };
        }
        const response = await fetchWithTimeout(
          "/api/leads",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              entryPoint,
              entryMethod,
              submissionMethod,
              fieldProvenance,
              segment: leadState.segment,
              form: parsed.data,
              transcript: leadState.transcript,
              ...(source === "voice"
                ? {
                    ...buildVoiceLeadMetadata(currentReviewCredentials()),
                    voiceEmailVerified: submissionMethod === "handoff_button" || isVoiceEmailConfirmed(leadState),
                    voiceEmailVerificationSource: leadState.emailVerification?.source,
                  }
                : {}),
              utm: {},
            }),
          },
          LEAD_SUBMIT_TIMEOUT_MS,
        ).catch(() => null);
        const responseBody = (await response?.json().catch(() => null)) as LeadSubmitResponse | null;
        if (!response?.ok) {
          const copy = leadSubmitErrorCopy(response?.status, responseBody);
          const notify = responseBody?.persisted ? toast.warning : toast.error;
          notify(copy.title, { description: copy.description });
          trackIntakeEvent("intake_submit_failure", {
            ...analytics,
            failure_class: response ? "server_rejected" : "network",
          });
          return {
            ok: false,
            error: responseBody?.error ?? "lead_submission_failed",
            persisted: responseBody?.persisted ?? false,
          };
        }
        const routedTo = getSegment(leadState.segment).routedTo;
        rememberHandoff(parsed.data, leadState.segment);
        // The handoff landed: this conversation is complete, so a later enquiry
        // begins a new thread rather than resuming this one.
        endConversation();
        if (source === "voice") {
          const review = currentReviewCredentials();
          submittedLeadIdRef.current = responseBody?.id ?? null;
          if (review) {
            void postVoiceReviewSnapshot(
              review,
              buildVoiceReviewSnapshot(review, leadState, connectionStatusRef.current, {
                leadId: responseBody?.id ?? null,
                submittedAt: Date.now(),
                entryPoint,
                entryMethod,
                submissionMethod,
              }),
            );
          }
        }
        setStatus("submitted");
        trackIntakeEvent("intake_submit_success", analytics);
        trackEvent(source === "voice" ? "voice_lead_submitted" : "lead_submitted", {
          segment: leadState.segment,
          source,
        });
        toast.success(`Sent to ${routedTo.name}.`, {
          description: notificationDelivered(responseBody)
            ? responseBody?.persisted
              ? "The handoff was saved and the routing notification was delivered."
              : "The handoff was delivered straight to the team."
            : "Saved locally. Owner notifications are not configured in this environment.",
        });
        return { ok: true, submitted: true, id: responseBody?.id, segment: leadState.segment, routedTo };
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [currentReviewCredentials, focusCapturedField],
  );

  const runtime = useVoiceRuntime({
    initialSegment: intent ?? "other",
    prefillEmail: prefill?.email,
    submitLead: (leadState) => submit("voice_command", leadState),
    onEndVoice: () => teardownVoiceRef.current?.("manual"),
    onToolDuration: (sample) => recordToolDurationRef.current?.(sample),
    onCaptureNeedsAttention: (key) => focusCapturedField(key),
    onClearFields: forgetHandoff,
  });
  const { segment, captured, emailVerification, transcript, stateRef } = runtime;
  const emailValid = leadFormSchema.shape.email.safeParse(captured.email).success;
  const handoffReady = emailValid;
  const markEmailEditorFocused = useCallback(() => {
    emailEditorOwnedFocusRef.current = true;
  }, []);
  const handleCapturedChange = useCallback(
    (key: keyof CapturedLead, value: string) => {
      const activeField =
        document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
          ? document.activeElement
          : null;
      const retainFieldFocus = activeField === mobileEmailRef.current || activeField?.getAttribute("name") === key;
      runtime.updateCaptured(key, value);
      if (key === "email") {
        setEmailTouched(true);
        setEmailAttention(leadFormSchema.shape.email.safeParse(value).success ? null : "rejected");
      }
      if (retainFieldFocus) {
        window.requestAnimationFrame(() => {
          // Controlled-value synchronization may briefly drop focus to body,
          // but never steal it back after the visitor has moved to another
          // field between this change event and the next animation frame.
          if (document.activeElement === activeField || document.activeElement === document.body) {
            activeField?.focus({ preventScroll: true });
          }
        });
      }
    },
    [runtime.updateCaptured],
  );

  useEffect(() => {
    const verificationMatches =
      Boolean(captured.email.trim()) &&
      emailVerification?.value.trim().toLowerCase() === captured.email.trim().toLowerCase();
    if (emailVerification?.status === "confirmed" && verificationMatches) {
      setEmailAttention(null);
      return;
    }
    if (emailVerification?.status === "pending" && captured.email.trim()) setEmailAttention("pending");
  }, [captured.email, emailVerification]);

  const form = useForm<CapturedLead>({
    defaultValues: { ...emptyCapturedLead, email: prefill?.email ?? "" },
    mode: "onChange",
    reValidateMode: "onChange",
    resolver: zodResolver(leadFormSchema),
    values: captured,
  });
  formRef.current = form;

  // The compact editor owns email below 1024px and the handoff form owns it
  // above that breakpoint. Preserve a visitor's focus and draft when a device
  // rotates or a browser window crosses that ownership boundary.
  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia("(min-width: 64rem)");
    let settleTimer: number | undefined;
    let transferGeneration = 0;
    const visibleEmailEditor = () => {
      if (media.matches) {
        return dialogContentRef.current?.querySelector<HTMLInputElement>('input[name="email"]') ?? null;
      }
      return mobileEmailRef.current;
    };
    const transferFocusedEmail = () => {
      if (!emailEditorOwnedFocusRef.current) return;
      const generation = ++transferGeneration;
      window.clearTimeout(settleTimer);
      let attempts = 0;
      const settleFocus = () => {
        if (generation !== transferGeneration) return;
        visibleEmailEditor()?.focus({ preventScroll: true });
        attempts += 1;
        // Base UI's focus scope also reacts when the old editor becomes
        // display:none. Reassert focus through that bounded transition only.
        if (attempts < 10) settleTimer = window.setTimeout(settleFocus, 50);
      };
      window.requestAnimationFrame(settleFocus);
    };
    const trackDialogFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !dialogContentRef.current?.contains(target)) return;
      const isEmailEditor =
        target === mobileEmailRef.current || (target instanceof HTMLInputElement && target.name === "email");
      if (isEmailEditor) {
        emailEditorOwnedFocusRef.current = true;
        return;
      }
      if (target.matches('input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])')) {
        emailEditorOwnedFocusRef.current = false;
      }
    };
    media.addEventListener("change", transferFocusedEmail);
    window.addEventListener("resize", transferFocusedEmail);
    document.addEventListener("focusin", trackDialogFocus);
    return () => {
      media.removeEventListener("change", transferFocusedEmail);
      window.removeEventListener("resize", transferFocusedEmail);
      document.removeEventListener("focusin", trackDialogFocus);
      transferGeneration += 1;
      window.clearTimeout(settleTimer);
    };
  }, [open]);

  const {
    connectVoice,
    connectionStatus,
    getLocalStream,
    prewarmVoiceSession,
    recordLocalSpeechEnded,
    recordRemoteAudioStarted,
    recordToolDuration,
    sendClientEvents,
    setVoiceActivation,
    teardownVoice,
    turnPhase,
  } = useRealtimeVoiceSession({
    audioRef,
    onClose: handleVoiceClose,
    onEvent: runtime.handleRealtimeEvent,
    onIdleWarning: () => {
      sendClientEventsRef.current?.(serializeResponseCreate(idleGoodbyeInstruction));
    },
    onSessionReady: (metadata) => {
      const current = reviewRef.current;
      const next = current?.id === metadata.id ? { ...current, ...metadata } : metadata;
      reviewRef.current = next;
      setReviewMetadata(next);
    },
    segment,
    variant: voiceVariant,
    conversationId,
  });
  teardownVoiceRef.current = teardownVoice;
  sendClientEventsRef.current = sendClientEvents;
  connectionStatusRef.current = connectionStatus;
  const sessionStartTrackedRef = useRef(false);
  useEffect(() => {
    if (connectionStatus === "idle") {
      sessionStartTrackedRef.current = false;
      return;
    }
    if (connectionStatus === "listening" && !sessionStartTrackedRef.current) {
      sessionStartTrackedRef.current = true;
      trackEvent("voice_session_started", { segment, voice_variant: voiceVariant ?? "default" });
    }
  }, [connectionStatus, segment, voiceVariant]);
  recordToolDurationRef.current = recordToolDuration;

  // Team voice tuning: switch Reka's register from inside the dialog. A switch
  // mid-call tears the session down and reconnects with the new voice — the
  // resumed-transcript handoff keeps the conversation going.
  const { setVoiceVariant } = useVoice();
  const [tunerEnabled, setTunerEnabled] = useState(false);
  const pendingVariantRestartRef = useRef(false);
  useEffect(() => {
    let active = true;
    void readTunerFlag().then((next) => {
      if (active) setTunerEnabled(next);
    });
    return () => {
      active = false;
    };
  }, []);
  const switchVoiceVariant = useCallback(
    (variantId: VoiceVariantId) => {
      if (variantId === (voiceVariant ?? DEFAULT_VOICE_VARIANT_ID)) return;
      const live = connectionStatus !== "idle";
      setVoiceVariant(variantId);
      if (live) {
        pendingVariantRestartRef.current = true;
        teardownVoice("manual");
      }
    },
    [connectionStatus, setVoiceVariant, teardownVoice, voiceVariant],
  );
  useEffect(() => {
    if (!pendingVariantRestartRef.current || connectionStatus !== "idle") return;
    pendingVariantRestartRef.current = false;
    void connectVoice();
  }, [connectionStatus, connectVoice]);

  useEffect(() => {
    if (!open) return;
    // Returning visitors are greeted like known partners: identity fields and
    // segment come back from local memory; the brief always starts fresh.
    const remembered = recallHandoff();
    // Resume the in-flight conversation if the visitor reopens soon after a
    // drop or closes an unfinished typed form. Form mode only controls focus;
    // an explicit external email prefill starts a different handoff.
    const explicitFreshHandoff = Boolean(prefill?.email);
    if (explicitFreshHandoff) endConversation();
    const nextConversationId = resolveConversationId();
    const resumesInFlightConversation = shouldResumeVoiceConversation(
      conversationIdRef.current,
      nextConversationId,
      {
        transcriptLength: stateRef.current.transcript.length,
        hasDraftHandoff:
          stateRef.current.segment !== "other" ||
          Object.values(stateRef.current.captured).some((value) => value.trim().length > 0),
      },
      explicitFreshHandoff,
    );
    if (!resumesInFlightConversation || !activeEntryPointRef.current || !activeEntryMethodRef.current) {
      activeEntryPointRef.current = prefill?.entryPoint ?? "unknown";
      activeEntryMethodRef.current = prefill?.entryMethod ?? "unknown";
    }
    conversationIdRef.current = nextConversationId;
    setConversationId(nextConversationId);
    if (!resumesInFlightConversation) {
      runtime.reset({
        segment: intent ?? remembered?.segment ?? "other",
        email: prefill?.email || remembered?.email,
        name: remembered?.name,
        org: remembered?.org,
      });
    }
    setStatus("idle");
    setActiveTopicId(null);
    setEmailAttention(null);
    setEmailTouched(false);
    emailEditorOwnedFocusRef.current = false;
    setSubmitting(false);
    submittingRef.current = false;
    submittedLeadIdRef.current = null;
    lastSyncedHandoffRef.current = "";
    openedVoiceTurnRef.current = false;
    reviewRef.current = null;
    setReviewMetadata(null);
    localReviewRef.current = null;
  }, [intent, open, prefill, runtime.reset, stateRef]);

  useEffect(() => {
    if (status === "submitted") teardownVoice("manual");
  }, [status, teardownVoice]);

  // The dialog opening IS the intent signal: warm the OpenAI connection. A
  // Realtime session is only pre-minted when microphone permission is already
  // granted, so first-time visitors do not spend quota before consent.
  useEffect(() => {
    if (!open || prefill?.mode === "form") return;
    preconnect("https://api.openai.com");
    prewarmVoiceSession();
  }, [open, prefill, prewarmVoiceSession]);

  // Hover/focus on a talk CTA, before any click: same warm-up, earlier, but
  // still permission-aware inside useRealtimeVoiceSession.
  useEffect(() => {
    if (!prewarmSignal) return;
    preconnect("https://api.openai.com");
    prewarmVoiceSession();
  }, [prewarmSignal, prewarmVoiceSession]);

  // Direct-talk CTAs: the tap that opened the dialog already meant "talk", so
  // begin the permission/connect flow immediately. connectVoice handles known
  // denial and falls back to typing without spending an unnecessary session.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
      voiceStartTrackedRef.current = false;
      return;
    }
    if (!prefill?.autoStart || autoStartedRef.current || status !== "idle") return;
    autoStartedRef.current = true;
    setVoiceActivation(prefill.activation);
    void connectVoice();
  }, [open, prefill?.activation, prefill?.autoStart, status, connectVoice, setVoiceActivation]);

  useEffect(() => {
    if (
      !open ||
      voiceStartTrackedRef.current ||
      (connectionStatus !== "requesting_mic" && connectionStatus !== "connecting" && connectionStatus !== "listening")
    )
      return;
    voiceStartTrackedRef.current = true;
    trackIntakeEvent("voice_start", {
      entry_point: activeEntryPointRef.current ?? "unknown",
      entry_method: activeEntryMethodRef.current ?? "unknown",
    });
  }, [connectionStatus, open]);

  // Closing the workspace must always release the microphone — a live mic
  // behind a closed dialog is a privacy bug, not a resumable session.
  useEffect(() => {
    if (!open) teardownVoiceRef.current?.("manual");
  }, [open]);

  useEffect(() => {
    if (connectionStatus !== "listening") {
      openedVoiceTurnRef.current = false;
      return;
    }
    if (openedVoiceTurnRef.current) return;
    // The chime is the "she's live" cue — presence you hear, not another toast.
    playLiveCue();
    const current = {
      segment: stateRef.current.segment,
      captured: stateRef.current.captured,
      emailVerification: stateRef.current.emailVerification,
    };
    const resumedTranscript = stateRef.current.transcript.slice(-12);
    const knownVisitor = current.captured.name.trim().length > 0 || current.captured.org.trim().length > 0;
    lastSyncedHandoffRef.current = handoffSyncKey(current);
    sendClientEvents([
      serializeHandoffContext(current, undefined, resumedTranscript.length > 0 ? { resumedTranscript } : {}),
      serializeResponseCreate(
        resumedTranscript.length > 0 ? reconnectVoiceInstruction : openingVoiceInstruction(knownVisitor),
      ),
    ]);
    openedVoiceTurnRef.current = true;
  }, [connectionStatus, sendClientEvents, stateRef]);

  const handleSendText = useCallback(
    (text: string) => {
      const events = serializeTypedTurn(text);
      const sent = sendClientEvents(events);
      if (sent) runtime.appendUserText(text);
      return sent;
    },
    [runtime.appendUserText, sendClientEvents],
  );

  useEffect(() => {
    if (connectionStatus !== "listening" || !openedVoiceTurnRef.current) return;
    const current = { segment, captured, emailVerification };
    const key = handoffSyncKey(current);
    if (key === lastSyncedHandoffRef.current) return;
    const timeout = window.setTimeout(() => {
      lastSyncedHandoffRef.current = key;
      sendClientEvents(serializeHandoffContext(current));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [captured, connectionStatus, emailVerification, segment, sendClientEvents]);

  const postReviewSnapshot = useCallback(
    (
      overrides: Parameters<typeof buildVoiceReviewSnapshot>[3] = {},
      options: { allowLocalReview?: boolean; includeEntry?: boolean } = {},
    ) => {
      const review =
        options.allowLocalReview === false ? (reviewRef.current ?? localReviewRef.current) : currentReviewCredentials();
      if (!review) return;
      const snapshotState = { ...stateRef.current, segment, captured, transcript };
      const leadId = overrides.leadId === undefined ? submittedLeadIdRef.current : overrides.leadId;
      void postVoiceReviewSnapshot(
        review,
        buildVoiceReviewSnapshot(review, snapshotState, connectionStatusRef.current, {
          ...(options.includeEntry === false || !activeEntryPointRef.current
            ? {}
            : { entryPoint: activeEntryPointRef.current }),
          ...(options.includeEntry === false || !activeEntryMethodRef.current
            ? {}
            : { entryMethod: activeEntryMethodRef.current }),
          ...overrides,
          ...(leadId ? { leadId } : {}),
        }),
        { keepalive: Boolean(overrides.closedAt) },
      ).catch(() => null);
    },
    [captured, currentReviewCredentials, segment, stateRef, transcript],
  );

  postCloseSnapshotRef.current = (reason: VoiceCloseReason) => {
    postReviewSnapshot({ status, closeReason: reason, closedAt: Date.now() }, { allowLocalReview: false });
  };

  useEffect(() => {
    if (open || !reviewMetadata?.prewarmedAt || prewarmSnapshotIdsRef.current.has(reviewMetadata.id)) return;
    prewarmSnapshotIdsRef.current.add(reviewMetadata.id);
    const timeout = window.setTimeout(() => postReviewSnapshot({ status: "idle" }, { includeEntry: false }), 200);
    return () => window.clearTimeout(timeout);
  }, [open, postReviewSnapshot, reviewMetadata]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => postReviewSnapshot({ status }), 1500);
    return () => window.clearTimeout(timeout);
  }, [open, postReviewSnapshot, status]);

  // Heartbeat: persist a full snapshot every few seconds while the call is live.
  // A long call used to leave only its 1.5s snapshot behind if the close post
  // was lost; now the review always has state that is at most one beat stale,
  // carrying the latest transcript, transport telemetry, and captured fields.
  useEffect(() => {
    if (!open || connectionStatus !== "listening") return;
    const interval = window.setInterval(() => {
      touchConversation();
      postReviewSnapshot({ status });
    }, VOICE_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [open, connectionStatus, postReviewSnapshot, status]);

  // A page unload (tab close / navigation) never runs the normal teardown, so
  // the close reason and final transport would be lost. Flush one keepalive
  // snapshot on the way out whenever a call is still live.
  useEffect(() => {
    if (!open) return;
    const flushOnExit = () => {
      if (connectionStatusRef.current === "idle") return;
      postReviewSnapshot({ status, closeReason: "page_hidden", closedAt: Date.now() }, { allowLocalReview: false });
    };
    const onPageHide = () => flushOnExit();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushOnExit();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, postReviewSnapshot, status]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange, open]);

  const selectedSegment = getSegment(segment);
  const submitted = status === "submitted";

  useEffect(() => {
    if (!open || submitted) return;
    const desktopLayout = window.matchMedia("(min-width: 80rem)");
    let resetFrame = 0;
    let settledReset = 0;
    const resetResponsiveScroll = () => {
      window.cancelAnimationFrame(resetFrame);
      resetFrame = window.requestAnimationFrame(() => {
        const layout = dialogLayoutRef.current;
        if (!layout) return;
        layout.scrollTop = 0;
        layout.scrollLeft = 0;
        for (const region of layout.children) {
          region.scrollTop = 0;
          region.scrollLeft = 0;
        }
        if (!desktopLayout.matches) dialogContentRef.current?.focus({ preventScroll: true });
      });
    };
    resetResponsiveScroll();
    // Base UI finishes its focus-trap setup after the opening frame. Reassert
    // the popup focus once that settles so a lower form field cannot scroll a
    // short mobile viewport to the middle or summon its keyboard on open.
    settledReset = window.setTimeout(resetResponsiveScroll, 120);
    desktopLayout.addEventListener("change", resetResponsiveScroll);
    return () => {
      window.cancelAnimationFrame(resetFrame);
      window.clearTimeout(settledReset);
      desktopLayout.removeEventListener("change", resetResponsiveScroll);
    };
  }, [open, submitted]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className={cn(
          "max-h-[calc(100dvh-1rem)] max-w-none overflow-hidden rounded-xl border-white/10 bg-mk-off-black p-0 text-white shadow-2xl sm:max-h-[94dvh] sm:max-w-none",
          // Once sent, the intake collapses to a compact confirmation — no
          // reason to hold a 1500px canvas for a done state.
          submitted
            ? "w-[min(560px,calc(100vw-1rem))]"
            : "h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] sm:h-[94dvh] sm:w-[min(1500px,96vw)]",
        )}
        data-voice-agent-dialog
        initialFocus={() =>
          window.matchMedia("(max-width: 63.999rem)").matches
            ? dialogContentRef.current
            : (dialogContentRef.current?.querySelector<HTMLInputElement>(
                `input[name="${prefill?.email ? "name" : "email"}"]`,
              ) ?? dialogContentRef.current)
        }
      >
        <DialogTitle className="sr-only">Talk to Reka</DialogTitle>
        {submitted ? (
          <div className="max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain sm:max-h-[94dvh]">
            <VoiceSubmittedConfirmation
              captured={captured}
              onClose={() => onOpenChange(false)}
              selectedSegment={selectedSegment}
            />
          </div>
        ) : (
          <div
            className="grid h-full min-h-0 grid-cols-1 overflow-y-auto overscroll-contain lg:grid-cols-[200px_minmax(0,1fr)_320px] lg:overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_360px]"
            data-voice-dialog-layout
            ref={dialogLayoutRef}
          >
            <main
              className="order-1 min-w-0 p-5 sm:p-8 lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
              data-voice-primary-region
            >
              {tunerEnabled ? (
                <div className="mb-4 flex flex-wrap items-center gap-1.5" data-voice-tuner>
                  <span
                    className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#aaa8af]"
                    data-voice-tuner-label
                  >
                    Voice
                  </span>
                  {VOICE_VARIANTS.map((variant) => {
                    const active = variant.id === (voiceVariant ?? DEFAULT_VOICE_VARIANT_ID);
                    return (
                      <button
                        aria-label={`Switch Reka voice to ${variant.label}`}
                        aria-pressed={active}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon",
                          active
                            ? "border-mk-horizon bg-white/12 text-white"
                            : "border-white/12 text-white/55 hover:border-white/30 hover:text-white",
                        )}
                        key={variant.id}
                        onClick={() => switchVoiceVariant(variant.id)}
                        type="button"
                      >
                        {variant.label.replace("Reka · ", "")}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <VoiceSessionStage
                activeTopicId={activeTopicId}
                assistantDraft={runtime.assistantDraft}
                audioRef={audioRef}
                captured={captured}
                connectionStatus={connectionStatus}
                getLocalStream={getLocalStream}
                lastAssistantLine={transcript.findLast((entry) => entry.role === "assistant")?.text ?? ""}
                onConnect={() => {
                  setVoiceActivation(playArmCue());
                  void connectVoice();
                }}
                onDisconnect={teardownVoice}
                onSendText={handleSendText}
                onTopicToggle={(topicId) => setActiveTopicId((current) => (current === topicId ? null : topicId))}
                selectedSegment={selectedSegment}
                status={status}
                turnPhase={turnPhase}
                onLocalSpeechEnded={recordLocalSpeechEnded}
                onRemoteAudioStarted={recordRemoteAudioStarted}
                emailAttention={emailAttention}
                emailInputRef={mobileEmailRef}
                emailTouched={emailTouched}
                emailValid={emailValid}
                onEmailBlur={() => {
                  runtime.endCapturedEdit("email");
                  setEmailTouched(true);
                  if (!emailValid) setEmailAttention("rejected");
                }}
                onEmailChange={(value) => handleCapturedChange("email", value)}
                onEmailFocus={() => {
                  markEmailEditorFocused();
                  runtime.beginCapturedEdit("email");
                }}
              />
            </main>

            <aside
              className="order-2 border-t border-white/10 p-5 lg:order-none lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-t-0 lg:border-r"
              data-voice-partner-region
            >
              <div className="mb-5 text-xs uppercase tracking-[0.16em] text-white/48">Partner type</div>
              <div className="flex gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
                {segmentOptions().map((option) => (
                  <button
                    className={cn(
                      "min-w-56 rounded-lg border border-white/10 p-4 text-left transition hover:border-white/28 hover:bg-white/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon lg:min-w-0",
                      option.id === segment && "border-mk-horizon bg-white/10",
                    )}
                    key={option.id}
                    onClick={() => runtime.setSegment(option.id)}
                    type="button"
                  >
                    <div className="text-sm font-semibold">{option.label}</div>
                    <div className="mt-1 text-xs leading-5 text-white/58">{option.blurb}</div>
                  </button>
                ))}
              </div>
            </aside>

            <HandoffPanel
              captured={captured}
              className="order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-t-0"
              emailVerification={emailVerification}
              form={form}
              onChange={handleCapturedChange}
              onEmailFocus={markEmailEditorFocused}
              onFieldBlur={runtime.endCapturedEdit}
              onFieldFocus={runtime.beginCapturedEdit}
              onSubmit={(values) =>
                submit("handoff_button", {
                  ...stateRef.current,
                  captured: values,
                  segment,
                  transcript,
                })
              }
              ready={handoffReady}
              selectedSegment={selectedSegment}
              submitted={submitted}
              submitting={submitting}
              transcript={transcript}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function handoffSyncKey(state: Pick<VoiceRuntimeState, "segment" | "captured" | "emailVerification">) {
  return JSON.stringify({
    segment: state.segment,
    captured: state.captured,
    emailVerification: state.emailVerification,
  });
}

function buildVoiceLeadMetadata(review: VoiceReviewCredentials | null) {
  if (!review) return {};
  return {
    voiceReviewId: review.id,
    voiceReviewToken: review.token,
    voiceSessionId: review.sessionId,
    voiceVariant: review.variant ?? undefined,
    voiceModel: review.model,
    voiceModelCell: review.modelCell,
    voiceReasoningCell: review.reasoningCell,
    voiceName: review.voice,
    voiceSpeed: review.speed,
    voiceRuntimeProfile: review.runtimeProfile,
    voiceInputPolicy: review.inputPolicy,
  };
}
