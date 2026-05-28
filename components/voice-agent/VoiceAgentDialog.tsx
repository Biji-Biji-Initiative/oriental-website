"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Mic2Icon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useTurnstile } from "@/components/security/useTurnstile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tourTopics } from "@/lib/content";
import { leadFormSchema } from "@/lib/schemas";
import { getSegment, type SegmentId, segmentOptions } from "@/lib/segments";
import { cn } from "@/lib/utils";
import { serializeHandoffContext, serializeRealtimeCommand, serializeResponseCreate } from "@/lib/voice/client-events";
import {
  type CapturedLead,
  emptyCapturedLead,
  type RealtimeClientCommand,
  type RealtimeServerEvent,
  reduceRealtimeServerEvent,
  type VoiceRuntimeState,
} from "@/lib/voice/realtime-events";
import { useRealtimeVoiceSession, type VoiceCloseReason } from "./useRealtimeVoiceSession";

type VoiceAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: SegmentId;
  prefill?: { email?: string; mode?: "voice" | "form" };
  turnstileSiteKey?: string;
};

const leadSubmitTimeoutMs = 18_000;

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
  const teardownVoiceRef = useRef<((reason: VoiceCloseReason) => void) | null>(null);

  const handleVoiceClose = useCallback((reason: VoiceCloseReason) => {
    if (reason === "error") {
      toast.error("Voice unavailable. You can keep typing here.");
    }
    if (reason === "idle_timeout") toast.message("Voice ended after inactivity. Your details are still here.");
    if (reason === "max_duration") toast.message("Voice ended after 2.5 minutes. Your details are still here.");
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
          leadSubmitTimeoutMs,
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
        setStatus("submitted");
        toast.success(`Sent to ${routedTo.name}.`, {
          description: notificationDelivered(responseBody)
            ? "The handoff was saved and the routing notification was delivered."
            : "Saved locally. Owner notifications are not configured in this environment.",
        });
        return { ok: true, submitted: true, segment: leadState.segment, routedTo };
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [turnstile, form],
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
    segment,
  });
  teardownVoiceRef.current = teardownVoice;

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
    sendClientEvents([
      serializeHandoffContext(current),
      serializeResponseCreate(
        "Start the intake now as Reka, pronounced REH-ka. Sound like a bright KL Malaysian host, not American: faster, upbeat, practical, warm. Say one short opener: we are moving into Oriental, it is a new chapter for Mereka, and we are excited to build it with the right people. Then ask what the visitor wants to build or explore. Do not explain pronunciation, tools, limitations, privacy, or the form.",
      ),
    ]);
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
    if (!open || process.env.NODE_ENV === "production") return;
    const timeout = window.setTimeout(() => {
      void fetch("/api/voice/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment,
          captured,
          transcript,
          status,
          connectionStatus,
          usage: stateRef.current.usage,
          errors: stateRef.current.errors,
        }),
      }).catch(() => null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [captured, connectionStatus, open, segment, status, transcript]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange, open]);

  const selectedSegment = getSegment(segment);
  const activeTopic = useMemo(() => tourTopics.find((topic) => topic.id === activeTopicId) ?? null, [activeTopicId]);
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
            {status === "submitted" ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <MiniOrb size={72} />
                  <h2 className="mt-6 text-4xl font-semibold">Sent to {selectedSegment.routedTo.name}.</h2>
                  <p className="mx-auto mt-3 max-w-md text-white/62">
                    The right Mereka team member has the context and will follow up within 2 working days.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <div ref={turnstile.containerRef} />
                <div className="mx-auto grid max-w-[min(680px,100%)] place-items-center text-center">
                  <div className="relative grid size-44 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#c9d5ec,#5c7db8_44%,#1f3f7c_68%,#100d18)] shadow-[0_0_90px_rgba(92,125,184,0.42)] sm:size-56">
                    <div className="absolute inset-[-24px] rounded-full border border-white/10 motion-safe:animate-pulse" />
                    <MiniOrb size={120} />
                  </div>
                  <p
                    aria-live="polite"
                    className="mt-8 max-w-2xl text-[clamp(1.7rem,3vw,2.8rem)] font-medium leading-tight text-balance"
                  >
                    Hi, I&apos;m Reka. Talk it through, or type on the side while we go.
                  </p>
                  <p className="mt-3 text-sm text-white/58">
                    I&apos;ll pick up useful details as you speak. You can edit the handoff anytime before sending.
                  </p>
                  <p className="mt-2 text-sm text-white/42">{selectedSegment.voiceOpener}</p>
                  <div className="mt-8 flex max-w-2xl flex-wrap justify-center gap-2">
                    {tourTopics.map((topic) => (
                      <button
                        aria-pressed={topic.id === activeTopicId}
                        className={cn(
                          "rounded-full border border-white/12 px-4 py-2 text-sm text-white/72 transition hover:border-mk-horizon hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mk-horizon",
                          topic.id === activeTopicId && "border-mk-horizon bg-white/10 text-white",
                        )}
                        key={topic.id}
                        onClick={() => setActiveTopicId((current) => (current === topic.id ? null : topic.id))}
                        type="button"
                      >
                        {topic.label}
                      </button>
                    ))}
                  </div>
                  {activeTopic ? (
                    <div className="mt-5 w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mk-horizon/80">
                        Story cue
                      </div>
                      <p className="mt-2 text-sm font-semibold text-white">{activeTopic.blurb}</p>
                      <p className="mt-2 text-sm leading-6 text-white/60">{activeTopic.script}</p>
                    </div>
                  ) : null}
                  <Button
                    className="mt-8 h-12 rounded-full bg-white px-7 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={!turnstile.ready || connectionStatus === "connecting"}
                    onClick={connectionStatus === "listening" ? () => teardownVoice("manual") : connectVoice}
                    type="button"
                  >
                    <Mic2Icon data-icon="inline-start" />
                    {connectionStatus === "connecting"
                      ? "Connecting..."
                      : connectionStatus === "listening"
                        ? "End voice"
                        : "Start voice"}
                  </Button>
                  <p className="mt-3 text-xs text-white/42">
                    Auto-ends after 20 seconds of inactivity or 2.5 minutes total.
                  </p>
                  {/* biome-ignore lint/a11y/useMediaCaption: Live WebRTC audio has no static caption asset; captured text appears in the transcript state. */}
                  <audio autoPlay ref={audioRef} />
                </div>
              </div>
            )}
          </main>

          <HandoffPanel
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

function HandoffPanel({
  className,
  form,
  onChange,
  onSubmit,
  ready,
  selectedSegment,
  submitting,
  transcript,
}: {
  className?: string;
  form: UseFormReturn<CapturedLead>;
  onChange: (key: keyof CapturedLead, value: string) => void;
  onSubmit: (values: CapturedLead) => Promise<Record<string, unknown>> | Record<string, unknown> | undefined;
  ready: boolean;
  selectedSegment: ReturnType<typeof getSegment>;
  submitting: boolean;
  transcript: Array<{ role: "assistant" | "user"; text: string }>;
}) {
  const fieldClassName =
    "h-11 rounded-[16px] border-white/12 bg-white/[0.045] px-4 text-white placeholder:text-white/30 focus-visible:border-mk-horizon focus-visible:ring-mk-horizon/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20";
  const messageClassName = "text-xs leading-5 text-[#ffb4ab]";
  const invalidCount = Object.keys(form.formState.errors).length;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptTurnCount = transcript.length;
  const latestTranscriptKey = transcript.at(-1) ? `${transcript.at(-1)?.role}:${transcript.at(-1)?.text}` : "";

  useEffect(() => {
    if (!latestTranscriptKey) return;
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [latestTranscriptKey]);

  return (
    <aside className={cn("border-t border-white/10 p-5 lg:border-l xl:border-t-0", className)}>
      <div className="text-xs uppercase tracking-[0.16em] text-white/48">Handoff details</div>
      <p className="mt-2 text-sm leading-5 text-white/58">
        Voice and typing work together. Edit anything here before sending.
      </p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/42">Routing</div>
        <div className="mt-1 text-sm font-semibold text-white/84">{selectedSegment.label}</div>
        <div className="mt-1 text-xs leading-5 text-white/52">
          {selectedSegment.routedTo.name} · {selectedSegment.routedTo.role}
        </div>
      </div>
      <Form {...form}>
        <form
          className="mt-5 grid gap-4"
          onSubmit={form.handleSubmit(
            (values) => onSubmit(values),
            () => {
              toast.error("Please fix the highlighted details.", {
                description: "The handoff needs a name, valid email, organisation, and short brief.",
              });
            },
          )}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className={fieldClassName}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("name", event.target.value);
                    }}
                    placeholder="Your name"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className={fieldClassName}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("email", event.target.value);
                    }}
                    placeholder="name@example.com"
                    type="email"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="org"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">Organisation</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    className={fieldClassName}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("org", event.target.value);
                    }}
                    placeholder="Company, school, collective, or Individual"
                  />
                </FormControl>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white/78">What would you bring to Oriental?</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    className={cn(fieldClassName, "min-h-28 resize-none py-3")}
                    onChange={(event) => {
                      field.onChange(event);
                      onChange("message", event.target.value);
                    }}
                    placeholder="A short note on the partnership, programme, tenancy, demo, or question."
                  />
                </FormControl>
                <FormDescription className="text-xs leading-5 text-white/42">
                  You can type this directly, let voice draft it, then edit before sending.
                </FormDescription>
                <FormMessage className={messageClassName} />
              </FormItem>
            )}
          />
          {invalidCount > 0 ? (
            <div
              className="flex gap-2 rounded-2xl border border-[#ffb4ab]/25 bg-[#ffb4ab]/10 p-3 text-xs leading-5 text-[#ffd8d2]"
              role="alert"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              Fix the highlighted fields before sending the handoff.
            </div>
          ) : null}
          <Button
            className="h-12 rounded-full bg-mk-horizon px-5 text-sm font-semibold text-mk-off-black transition hover:bg-white disabled:opacity-45"
            disabled={!ready || submitting}
            type="submit"
          >
            <SendIcon data-icon="inline-start" />
            {submitting ? "Sending..." : "Send to Mereka"}
          </Button>
        </form>
      </Form>
      {transcriptTurnCount > 0 ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/42">Live notes</div>
            <div className="text-[11px] text-white/36">{transcriptTurnCount} turns</div>
          </div>
          <div
            aria-label="Conversation transcript"
            aria-live="polite"
            className="mt-3 max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-2"
            ref={transcriptRef}
            role="log"
          >
            {transcript.map((entry) => (
              <p className="text-xs leading-5 text-white/62" key={`${entry.role}:${entry.text}`}>
                <span className="font-semibold text-white/78">{entry.role === "user" ? "You" : "Reka"}:</span>{" "}
                {entry.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type LeadSubmitResponse = {
  ok?: boolean;
  error?: string;
  persisted?: boolean;
  notifications?: {
    email?: NotificationResult;
    slack?: NotificationResult;
  };
};

type NotificationResult = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

function notificationDelivered(response: LeadSubmitResponse | null) {
  return response?.notifications?.email?.ok === true || response?.notifications?.slack?.ok === true;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function handoffSyncKey(state: Pick<VoiceRuntimeState, "segment" | "captured">) {
  return JSON.stringify({ segment: state.segment, captured: state.captured });
}

function leadSubmitErrorCopy(status: number | undefined, response: LeadSubmitResponse | null) {
  if (response?.error === "notification_failed" && response.persisted) {
    return {
      title: "Saved, but notifications need attention.",
      description:
        "Your details were stored, but the owner notification did not complete. Please use team@mereka.io if this is urgent.",
    };
  }
  if (response?.error === "turnstile_failed") {
    return {
      title: "Browser verification failed.",
      description: "Refresh and try again. If it keeps failing, email team@mereka.io.",
    };
  }
  if (response?.error === "rate_limited" || status === 429) {
    return {
      title: "Too many attempts.",
      description: "Please wait a few minutes before sending again.",
    };
  }
  if (response?.error === "invalid_payload") {
    return {
      title: "Some details look incomplete.",
      description: "Please check the highlighted fields and send again.",
    };
  }
  return {
    title: "Could not send this yet.",
    description: "Your handoff is still here. Please try again or email team@mereka.io.",
  };
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
