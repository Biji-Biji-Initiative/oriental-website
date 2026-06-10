"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import { useTurnstile } from "@/components/security/useTurnstile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { leadFormSchema } from "@/lib/schemas";
import { getSegment, type SegmentId, segmentOptions } from "@/lib/segments";
import { cn } from "@/lib/utils";
import {
  type RealtimeOutboundEvent,
  serializeHandoffContext,
  serializeResponseCreate,
  serializeTypedInterruption,
  serializeUserText,
} from "@/lib/voice/client-events";
import {
  fetchWithTimeout,
  LEAD_SUBMIT_TIMEOUT_MS,
  type LeadSubmitResponse,
  leadSubmitErrorCopy,
  notificationDelivered,
} from "@/lib/voice/lead-submit";
import { type CapturedLead, emptyCapturedLead, type VoiceRuntimeState } from "@/lib/voice/realtime-events";
import {
  buildVoiceReviewSnapshot,
  postVoiceReviewSnapshot,
  type VoiceReviewCredentials,
} from "@/lib/voice/review-snapshot";
import { HandoffPanel } from "./HandoffPanel";
import {
  useRealtimeVoiceSession,
  type VoiceCloseReason,
  type VoiceConnectionStatus,
  type VoiceReviewMetadata,
} from "./useRealtimeVoiceSession";
import { useVoiceRuntime } from "./useVoiceRuntime";
import { VoiceSessionStage } from "./VoiceSessionStage";
import {
  idleGoodbyeInstruction,
  openingVoiceInstruction,
  reconnectVoiceInstruction,
  voiceCloseReasonToast,
  voiceToastIds,
} from "./voice-dialog-copy";

type VoiceAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: SegmentId;
  prefill?: { email?: string; mode?: "voice" | "form" };
  turnstileSiteKey?: string;
};

export function VoiceAgentDialog({ open, onOpenChange, intent, prefill, turnstileSiteKey }: VoiceAgentDialogProps) {
  const [status, setStatus] = useState<"idle" | "submitted">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const turnstile = useTurnstile("oriental-intake", turnstileSiteKey);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const submittingRef = useRef(false);
  const lastSyncedHandoffRef = useRef("");
  const openedVoiceTurnRef = useRef(false);
  const reviewRef = useRef<VoiceReviewMetadata | null>(null);
  const localReviewRef = useRef<VoiceReviewCredentials | null>(null);
  const teardownVoiceRef = useRef<((reason: VoiceCloseReason) => void) | null>(null);
  const sendClientEventsRef = useRef<((events: RealtimeOutboundEvent | RealtimeOutboundEvent[]) => boolean) | null>(
    null,
  );
  const connectionStatusRef = useRef<VoiceConnectionStatus>("idle");

  const currentReviewCredentials = useCallback((): VoiceReviewCredentials | null => {
    if (reviewRef.current) return reviewRef.current;
    if (process.env.NODE_ENV === "production") return null;
    localReviewRef.current ??= { id: crypto.randomUUID(), token: "local-development-review-token" };
    return localReviewRef.current;
  }, []);

  const handleVoiceClose = useCallback((reason: VoiceCloseReason) => {
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

  const submit = useCallback(
    async (source: "form" | "voice", leadState: VoiceRuntimeState): Promise<Record<string, unknown>> => {
      if (submittingRef.current) return { ok: false, error: "submission_in_progress" };
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const parsed = leadFormSchema.safeParse(leadState.captured);
        if (!parsed.success) {
          if (source === "form") void formRef.current?.trigger();
          toast.error("Please fix the highlighted details.", {
            description: "Name, a valid email, organisation, and a short brief are required before sending.",
          });
          return { ok: false, error: "invalid_lead", details: parsed.error.flatten() };
        }
        let turnstileToken = "";
        try {
          turnstileToken = await turnstile.execute();
        } catch {
          toast.error("Could not verify this browser. Try again in a moment.");
          return { ok: false, error: "turnstile_unavailable" };
        }
        const response = await fetchWithTimeout(
          "/api/leads",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source,
              segment: leadState.segment,
              form: parsed.data,
              transcript: leadState.transcript,
              turnstileToken,
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
          return {
            ok: false,
            error: responseBody?.error ?? "lead_submission_failed",
            persisted: responseBody?.persisted ?? false,
          };
        }
        const routedTo = getSegment(leadState.segment).routedTo;
        if (source === "voice") {
          const review = currentReviewCredentials();
          if (review) {
            void postVoiceReviewSnapshot(
              review,
              buildVoiceReviewSnapshot(review, leadState, connectionStatusRef.current, {
                leadId: responseBody?.id ?? null,
                submittedAt: Date.now(),
              }),
            );
          }
        }
        setStatus("submitted");
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
    [turnstile, currentReviewCredentials],
  );

  const runtime = useVoiceRuntime({
    initialSegment: intent ?? "other",
    prefillEmail: prefill?.email,
    submitLead: (leadState) => submit("voice", leadState),
    onEndVoice: () => teardownVoiceRef.current?.("manual"),
  });
  const { segment, captured, transcript, stateRef } = runtime;

  const form = useForm<CapturedLead>({
    defaultValues: { ...emptyCapturedLead, email: prefill?.email ?? "" },
    mode: "onChange",
    reValidateMode: "onChange",
    resolver: zodResolver(leadFormSchema),
    values: captured,
  });
  formRef.current = form;

  const { connectVoice, connectionStatus, sendClientEvents, teardownVoice } = useRealtimeVoiceSession({
    audioRef,
    getTurnstileToken: turnstile.execute,
    onClose: handleVoiceClose,
    onEvent: runtime.handleRealtimeEvent,
    onIdleWarning: () => {
      sendClientEventsRef.current?.(serializeResponseCreate(idleGoodbyeInstruction));
    },
    onSessionReady: (metadata) => {
      reviewRef.current = metadata;
    },
    segment,
  });
  teardownVoiceRef.current = teardownVoice;
  sendClientEventsRef.current = sendClientEvents;
  connectionStatusRef.current = connectionStatus;

  useEffect(() => {
    if (!open) return;
    runtime.reset({ segment: intent ?? "other", email: prefill?.email });
    setStatus("idle");
    setActiveTopicId(null);
    setSubmitting(false);
    submittingRef.current = false;
    lastSyncedHandoffRef.current = "";
    openedVoiceTurnRef.current = false;
    reviewRef.current = null;
    localReviewRef.current = null;
  }, [intent, open, prefill, runtime.reset]);

  useEffect(() => {
    if (status === "submitted") teardownVoice("manual");
  }, [status, teardownVoice]);

  useEffect(() => {
    if (connectionStatus !== "listening") {
      openedVoiceTurnRef.current = false;
      return;
    }
    toast.success("Voice is live.", { id: voiceToastIds.live });
    const current = { segment: stateRef.current.segment, captured: stateRef.current.captured };
    const resumedTranscript = stateRef.current.transcript.slice(-12);
    lastSyncedHandoffRef.current = handoffSyncKey(current);
    sendClientEvents([
      serializeHandoffContext(current, undefined, resumedTranscript.length > 0 ? { resumedTranscript } : {}),
      serializeResponseCreate(resumedTranscript.length > 0 ? reconnectVoiceInstruction : openingVoiceInstruction),
    ]);
    openedVoiceTurnRef.current = true;
  }, [connectionStatus, sendClientEvents, stateRef]);

  const handleSendText = useCallback(
    (text: string) => {
      const events: RealtimeOutboundEvent[] = [
        ...(stateRef.current.activeResponse ? serializeTypedInterruption() : []),
        serializeUserText(text),
        serializeResponseCreate(),
      ];
      const sent = sendClientEvents(events);
      if (sent) runtime.appendUserText(text);
      return sent;
    },
    [runtime.appendUserText, sendClientEvents, stateRef],
  );

  useEffect(() => {
    if (connectionStatus !== "listening" || !openedVoiceTurnRef.current) return;
    const current = { segment, captured };
    const key = handoffSyncKey(current);
    if (key === lastSyncedHandoffRef.current) return;
    const timeout = window.setTimeout(() => {
      lastSyncedHandoffRef.current = key;
      sendClientEvents(serializeHandoffContext(current));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [captured, connectionStatus, segment, sendClientEvents]);

  useEffect(() => {
    if (!open) return;
    const review = currentReviewCredentials();
    if (!review) return;
    const snapshotState = { ...stateRef.current, segment, captured, transcript };
    const timeout = window.setTimeout(() => {
      void postVoiceReviewSnapshot(
        review,
        buildVoiceReviewSnapshot(review, snapshotState, connectionStatus, { status }),
      ).catch(() => null);
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [captured, connectionStatus, currentReviewCredentials, open, segment, stateRef, status, transcript]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange, open]);

  const selectedSegment = getSegment(segment);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94svh] w-[min(1500px,96vw)] overflow-hidden rounded-xl border-white/10 bg-mk-off-black p-0 text-white shadow-2xl sm:max-w-none">
        <DialogTitle className="sr-only">Talk to Reka</DialogTitle>
        <div className="grid max-h-[94svh] grid-cols-1 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="border-b border-white/10 p-5 lg:row-span-2 lg:border-r lg:border-b-0 xl:row-span-1">
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

          <main className="min-w-0 border-t border-white/10 p-5 sm:p-8 lg:border-t-0">
            <div ref={turnstile.containerRef} />
            <VoiceSessionStage
              activeTopicId={activeTopicId}
              assistantDraft={runtime.assistantDraft}
              audioRef={audioRef}
              captured={captured}
              connectionStatus={connectionStatus}
              onConnect={connectVoice}
              onDisconnect={teardownVoice}
              onSendText={handleSendText}
              onTopicToggle={(topicId) => setActiveTopicId((current) => (current === topicId ? null : topicId))}
              selectedSegment={selectedSegment}
              status={status}
              turnstileReady={turnstile.ready}
            />
          </main>

          <HandoffPanel
            captured={captured}
            className="lg:col-start-2 xl:col-start-auto"
            form={form}
            onChange={runtime.updateCaptured}
            onSubmit={(values) =>
              submit("form", {
                ...stateRef.current,
                captured: values,
                segment,
                transcript,
              })
            }
            ready={turnstile.ready}
            selectedSegment={selectedSegment}
            submitting={submitting}
            transcript={transcript}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function handoffSyncKey(state: Pick<VoiceRuntimeState, "segment" | "captured">) {
  return JSON.stringify({ segment: state.segment, captured: state.captured });
}
