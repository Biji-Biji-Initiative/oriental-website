"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useTurnstile } from "@/components/security/useTurnstile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { leadFormSchema } from "@/lib/schemas";
import { getSegment, type SegmentId, segmentOptions } from "@/lib/segments";
import { cn } from "@/lib/utils";
import { serializeHandoffContext, serializeRealtimeCommand, serializeResponseCreate } from "@/lib/voice/client-events";
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
  type RealtimeClientCommand,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";
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
import { VoiceSessionStage } from "./VoiceSessionStage";
import { openingVoiceInstruction, voiceCloseReasonToast } from "./voice-dialog-copy";

type VoiceAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: SegmentId;
  prefill?: { email?: string; mode?: "voice" | "form" };
  turnstileSiteKey?: string;
};

export function VoiceAgentDialog({ open, onOpenChange, intent, prefill, turnstileSiteKey }: VoiceAgentDialogProps) {
  const [segment, setSegment] = useState<SegmentId>(intent ?? "other");
  const [captured, setCaptured] = useState<CapturedLead>({ ...emptyCapturedLead, email: prefill?.email ?? "" });
  const [status, setStatus] = useState<"idle" | "submitted">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ role: "assistant" | "user"; text: string }>>([]);
  const form = useForm<CapturedLead>({
    defaultValues: { ...emptyCapturedLead, email: prefill?.email ?? "" },
    mode: "onChange",
    reValidateMode: "onChange",
    resolver: zodResolver(leadFormSchema),
    values: captured,
  });
  const turnstile = useTurnstile("oriental-intake", turnstileSiteKey);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<VoiceRuntimeState>({ segment, captured, transcript });
  const submittingRef = useRef(false);
  const lastSyncedHandoffRef = useRef("");
  const openedVoiceTurnRef = useRef(false);
  const reviewRef = useRef<VoiceReviewMetadata | null>(null);
  const localReviewRef = useRef<VoiceReviewCredentials | null>(null);
  const teardownVoiceRef = useRef<((reason: VoiceCloseReason) => void) | null>(null);
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
      toast.error(copy.title, { description: copy.description });
      return;
    }
    if (copy.tone === "warning") {
      toast.warning(copy.title, { description: copy.description });
      return;
    }
    toast.message(copy.title, { description: copy.description });
  }, []);

  const submit = useCallback(
    async (source: "form" | "voice" = "form", override?: VoiceRuntimeState): Promise<Record<string, unknown>> => {
      if (submittingRef.current) return { ok: false, error: "submission_in_progress" };
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const leadState = override ?? stateRef.current;
        const parsed = leadFormSchema.safeParse(leadState.captured);
        if (!parsed.success) {
          if (source === "form") void form.trigger();
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
            ? "The handoff was saved and the routing notification was delivered."
            : "Saved locally. Owner notifications are not configured in this environment.",
        });
        return { ok: true, submitted: true, id: responseBody?.id, segment: leadState.segment, routedTo };
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [turnstile, form, currentReviewCredentials],
  );

  const submitVoiceCommand = useCallback(
    (
      channel: RTCDataChannel,
      command: Extract<RealtimeClientCommand, { type: "submit_voice" }>,
      leadState: VoiceRuntimeState,
    ) => {
      submit("voice", leadState)
        .then((output) => {
          if (output.submitted !== true) {
            stateRef.current = { ...stateRef.current, routeRequested: false };
          }
          sendRealtimeCommand(channel, {
            type: "function_result",
            callId: command.callId,
            createResponse: output.submitted !== true,
            output,
          });
        })
        .catch(() => {
          stateRef.current = { ...stateRef.current, routeRequested: false };
          toast.error("Could not finish voice routing. You can still send from the handoff panel.");
        });
    },
    [submit],
  );

  const handleRealtimeEvent = useCallback(
    (serverEvent: RealtimeServerEvent, channel: RTCDataChannel) => {
      const reduced = reduceRealtimeServerEvent(serverEvent, stateRef.current);
      const previousErrorCount = stateRef.current.errors?.length ?? 0;
      stateRef.current = reduced.state;
      setSegment(reduced.state.segment);
      setCaptured(reduced.state.captured);
      setTranscript(reduced.state.transcript);
      if ((reduced.state.errors?.length ?? 0) > previousErrorCount) {
        toast.error("Voice session reported an error. The form is still available.");
      }
      for (const command of reduced.commands) {
        if (command.type === "function_result") {
          if (command.output.error === "ungrounded_identity_capture") {
            toast.warning("Ignored an unverified contact detail.", {
              description: "Please type it in the handoff panel or say it clearly once.",
            });
          }
          sendRealtimeCommand(channel, command);
        }
        if (command.type === "submit_voice") submitVoiceCommand(channel, command, reduced.state);
        if (command.type === "end_voice") {
          teardownVoiceRef.current?.("manual");
        }
      }
    },
    [submitVoiceCommand],
  );

  const { connectVoice, connectionStatus, sendClientEvents, teardownVoice } = useRealtimeVoiceSession({
    audioRef,
    getTurnstileToken: turnstile.execute,
    onClose: handleVoiceClose,
    onEvent: handleRealtimeEvent,
    onSessionReady: (metadata) => {
      reviewRef.current = metadata;
    },
    segment,
  });
  teardownVoiceRef.current = teardownVoice;
  connectionStatusRef.current = connectionStatus;

  useEffect(() => {
    if (!open) return;
    setSegment(intent ?? "other");
    setCaptured({ ...emptyCapturedLead, email: prefill?.email ?? "" });
    setTranscript([]);
    setStatus("idle");
    setActiveTopicId(null);
    setSubmitting(false);
    submittingRef.current = false;
    lastSyncedHandoffRef.current = "";
    openedVoiceTurnRef.current = false;
    reviewRef.current = null;
    localReviewRef.current = null;
    stateRef.current = {
      segment: intent ?? "other",
      captured: { ...emptyCapturedLead, email: prefill?.email ?? "" },
      transcript: [],
      handledCallIds: [],
    };
  }, [intent, open, prefill]);

  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      segment,
      captured,
      transcript,
    };
  }, [captured, segment, transcript]);

  useEffect(() => {
    if (status === "submitted") teardownVoice("manual");
  }, [status, teardownVoice]);

  useEffect(() => {
    if (connectionStatus !== "listening") {
      openedVoiceTurnRef.current = false;
      return;
    }
    toast.success("Voice is live.");
    const current = { segment: stateRef.current.segment, captured: stateRef.current.captured };
    lastSyncedHandoffRef.current = handoffSyncKey(current);
    sendClientEvents([serializeHandoffContext(current), serializeResponseCreate(openingVoiceInstruction)]);
    openedVoiceTurnRef.current = true;
  }, [connectionStatus, sendClientEvents]);

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
  }, [captured, connectionStatus, currentReviewCredentials, open, segment, status, transcript]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange, open]);

  const selectedSegment = getSegment(segment);
  const updateCaptured = useCallback((key: keyof CapturedLead, value: string) => {
    setCaptured((current) => ({ ...current, [key]: value }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94svh] w-[min(1500px,96vw)] overflow-hidden rounded-[22px] border-white/10 bg-mk-off-black p-0 text-white shadow-2xl sm:max-w-none">
        <DialogTitle className="sr-only">Talk to Reka</DialogTitle>
        <div className="grid max-h-[94svh] grid-cols-1 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="border-b border-white/10 p-5 lg:row-span-2 lg:border-r lg:border-b-0 xl:row-span-1">
            <div className="mb-5 text-xs uppercase tracking-[0.16em] text-white/48">Partner type</div>
            <div className="flex gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
              {segmentOptions().map((option) => (
                <button
                  className={cn(
                    "min-w-56 rounded-[18px] border border-white/10 p-4 text-left transition hover:border-white/28 hover:bg-white/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon lg:min-w-0",
                    option.id === segment && "border-mk-horizon bg-white/10",
                  )}
                  key={option.id}
                  onClick={() => setSegment(option.id)}
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
              audioRef={audioRef}
              captured={captured}
              connectionStatus={connectionStatus}
              onConnect={connectVoice}
              onDisconnect={teardownVoice}
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
            onChange={updateCaptured}
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

function sendRealtimeCommand(
  channel: RTCDataChannel,
  command: Extract<RealtimeClientCommand, { type: "function_result" }>,
) {
  if (channel.readyState !== "open") return;
  for (const event of serializeRealtimeCommand(command)) {
    channel.send(JSON.stringify(event));
  }
}
