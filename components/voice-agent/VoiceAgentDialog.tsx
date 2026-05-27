"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { useTurnstile } from "@/components/security/useTurnstile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { tourTopics } from "@/lib/content";
import { leadFormSchema } from "@/lib/schemas";
import { getSegment, type SegmentId, segmentOptions } from "@/lib/segments";
import { cn } from "@/lib/utils";
import { serializeRealtimeCommand } from "@/lib/voice/client-events";
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

export function VoiceAgentDialog({ open, onOpenChange, intent, prefill, turnstileSiteKey }: VoiceAgentDialogProps) {
  const [segment, setSegment] = useState<SegmentId>(intent ?? "other");
  const [mode, setMode] = useState<"voice" | "form">(prefill?.mode ?? "voice");
  const [captured, setCaptured] = useState<CapturedLead>({ ...emptyCapturedLead, email: prefill?.email ?? "" });
  const [status, setStatus] = useState<"idle" | "submitted">("idle");
  const [transcript, setTranscript] = useState<Array<{ role: "assistant" | "user"; text: string }>>([]);
  const turnstile = useTurnstile("oriental-intake", turnstileSiteKey);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stateRef = useRef<VoiceRuntimeState>({ segment, captured, transcript });

  const handleVoiceClose = useCallback((reason: VoiceCloseReason) => {
    if (reason === "error") {
      setMode("form");
      toast.error("Voice unavailable - switched to form.");
    }
    if (reason === "idle_timeout") toast.message("Voice paused after inactivity. The form is still ready.");
    if (reason === "max_duration") toast.message("Voice paused after three minutes. The form is still ready.");
  }, []);

  const submit = useCallback(
    async (source: "form" | "voice" = "form", override?: VoiceRuntimeState): Promise<Record<string, unknown>> => {
      const leadState = override ?? stateRef.current;
      const parsed = leadFormSchema.safeParse(leadState.captured);
      if (!parsed.success) {
        toast.error("Add name, email, organisation, and a short brief.");
        setMode("form");
        return { ok: false, error: "invalid_lead", details: parsed.error.flatten() };
      }
      let turnstileToken = "";
      try {
        turnstileToken = await turnstile.execute();
      } catch {
        toast.error("Could not verify this browser. Try again in a moment.");
        return { ok: false, error: "turnstile_unavailable" };
      }
      const response = await fetch("/api/leads", {
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
      }).catch(() => null);
      if (!response?.ok) {
        toast.error("Could not send this yet. Your form is still here.");
        return { ok: false, error: "lead_submission_failed" };
      }
      const routedTo = getSegment(leadState.segment).routedTo;
      setStatus("submitted");
      toast.success(`Sent to ${routedTo.name}.`);
      return { ok: true, submitted: true, segment: leadState.segment, routedTo };
    },
    [turnstile],
  );

  const submitVoiceCommand = useCallback(
    async (
      channel: RTCDataChannel,
      command: Extract<RealtimeClientCommand, { type: "submit_voice" }>,
      leadState: VoiceRuntimeState,
    ) => {
      const output = await submit("voice", leadState);
      sendRealtimeCommand(channel, { type: "function_result", callId: command.callId, createResponse: true, output });
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
        if (command.type === "function_result") sendRealtimeCommand(channel, command);
        if (command.type === "submit_voice") void submitVoiceCommand(channel, command, reduced.state);
      }
    },
    [submitVoiceCommand],
  );

  const { connectVoice, connectionStatus, teardownVoice } = useRealtimeVoiceSession({
    audioRef,
    getTurnstileToken: turnstile.execute,
    onClose: handleVoiceClose,
    onEvent: handleRealtimeEvent,
    segment,
  });

  useEffect(() => {
    if (!open) return;
    setSegment(intent ?? "other");
    setMode(prefill?.mode ?? "voice");
    setCaptured({ ...emptyCapturedLead, email: prefill?.email ?? "" });
    setTranscript([]);
    setStatus("idle");
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
    if (connectionStatus === "listening") toast.success("Voice is live.");
  }, [connectionStatus]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenChange, open]);

  const selectedSegment = getSegment(segment);
  const ready = leadFormSchema.safeParse(captured).success;

  const capturedRows = useMemo(
    () => [
      ["Partner type", selectedSegment.label],
      ["Routed to", `${selectedSegment.routedTo.name} · ${selectedSegment.routedTo.role}`],
      ["Name", captured.name || "Not captured yet"],
      ["Email", captured.email || "Not captured yet"],
      ["Organisation", captured.org || "Not captured yet"],
      ["What you bring", captured.message || "Not captured yet"],
    ],
    [captured, selectedSegment],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94svh] w-[min(1340px,94vw)] overflow-hidden rounded-[22px] border-white/10 bg-mk-off-black p-0 text-white shadow-2xl sm:max-w-none">
        <DialogTitle className="sr-only">Talk to Mereka</DialogTitle>
        <div className="grid max-h-[94svh] grid-cols-1 overflow-y-auto lg:grid-cols-[280px_minmax(0,1fr)_330px]">
          <aside className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
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

          <main className="min-h-[620px] p-5 sm:p-8">
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
              <Tabs value={mode} onValueChange={(value) => setMode(value as "voice" | "form")}>
                <TabsList className="mb-8 bg-white/8">
                  <TabsTrigger value="voice">Voice</TabsTrigger>
                  <TabsTrigger value="form">Form</TabsTrigger>
                </TabsList>
                <div ref={turnstile.containerRef} />
                <TabsContent value="voice">
                  <div className="mx-auto grid max-w-2xl place-items-center text-center">
                    <div className="relative grid size-56 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#c9d5ec,#5c7db8_44%,#1f3f7c_68%,#100d18)] shadow-[0_0_90px_rgba(92,125,184,0.42)]">
                      <div className="absolute inset-[-24px] rounded-full border border-white/10 motion-safe:animate-pulse" />
                      <MiniOrb size={120} />
                    </div>
                    <p aria-live="polite" className="mt-8 max-w-xl text-2xl font-medium leading-tight">
                      Hi, I&apos;m Mereka. Tell me what brings you to Oriental today.
                    </p>
                    <p className="mt-3 text-sm text-white/58">{selectedSegment.voiceOpener}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-2">
                      {tourTopics.map((topic) => (
                        <button
                          className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/72 transition hover:border-mk-horizon hover:text-white"
                          key={topic.id}
                          onClick={() => {
                            setTranscript((rows) => [...rows, { role: "assistant", text: topic.script }]);
                            toast.message(topic.blurb);
                          }}
                          type="button"
                        >
                          {topic.label}
                        </button>
                      ))}
                    </div>
                    <button
                      className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={!turnstile.ready || connectionStatus !== "idle"}
                      onClick={connectVoice}
                      type="button"
                    >
                      {connectionStatus === "connecting"
                        ? "Connecting..."
                        : connectionStatus === "listening"
                          ? "Listening"
                          : "Start voice"}
                    </button>
                    {/* biome-ignore lint/a11y/useMediaCaption: Live WebRTC audio has no static caption asset; captured text appears in the transcript state. */}
                    <audio autoPlay ref={audioRef} />
                  </div>
                </TabsContent>
                <TabsContent value="form">
                  <LeadForm
                    captured={captured}
                    onChange={setCaptured}
                    onSubmit={() => submit("form")}
                    ready={ready && turnstile.ready}
                  />
                </TabsContent>
              </Tabs>
            )}
          </main>

          <aside className="border-t border-white/10 p-5 lg:border-l lg:border-t-0">
            <div className="text-xs uppercase tracking-[0.16em] text-white/48">Captured</div>
            <dl className="mt-5 space-y-4">
              {capturedRows.map(([label, value]) => (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" key={label}>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-white/42">{label}</dt>
                  <dd className="mt-1 text-sm leading-5 text-white/82">{value}</dd>
                </div>
              ))}
            </dl>
            <button
              className="mt-5 w-full rounded-full bg-mk-horizon px-5 py-3 text-sm font-semibold text-mk-off-black transition hover:bg-white disabled:opacity-45"
              disabled={!ready || !turnstile.ready}
              onClick={() => submit("form")}
              type="button"
            >
              Send to Mereka
            </button>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeadForm({
  captured,
  onChange,
  onSubmit,
  ready,
}: {
  captured: CapturedLead;
  onChange: (captured: CapturedLead) => void;
  onSubmit: () => void;
  ready: boolean;
}) {
  const field = (key: keyof CapturedLead, value: string) => onChange({ ...captured, [key]: value });
  return (
    <form
      className="mx-auto grid max-w-2xl gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="lead-name">Name</Label>
        <Input id="lead-name" onChange={(event) => field("name", event.target.value)} value={captured.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="lead-email">Email</Label>
        <Input
          id="lead-email"
          onChange={(event) => field("email", event.target.value)}
          type="email"
          value={captured.email}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="lead-org">Organisation</Label>
        <Input id="lead-org" onChange={(event) => field("org", event.target.value)} value={captured.org} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="lead-message">What would you bring to Oriental?</Label>
        <Textarea
          className="min-h-36"
          id="lead-message"
          onChange={(event) => field("message", event.target.value)}
          value={captured.message}
        />
      </div>
      <button
        className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon disabled:opacity-45"
        disabled={!ready}
        type="submit"
      >
        Send to Mereka
      </button>
    </form>
  );
}

function sendRealtimeCommand(
  channel: RTCDataChannel,
  command: Extract<RealtimeClientCommand, { type: "function_result" }>,
) {
  for (const event of serializeRealtimeCommand(command)) {
    channel.send(JSON.stringify(event));
  }
}
