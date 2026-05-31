"use client";

import { Mic2Icon, PhoneOffIcon, RadioIcon, SparklesIcon } from "lucide-react";
import type { RefObject } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { Button } from "@/components/ui/button";
import { tourTopics } from "@/lib/content";
import type { getSegment } from "@/lib/segments";
import { cn } from "@/lib/utils";
import type { CapturedLead } from "@/lib/voice/realtime-events";
import type { VoiceCloseReason, VoiceConnectionStatus } from "./useRealtimeVoiceSession";
import { handoffCompletion, voiceStatusCopy } from "./voice-dialog-copy";

type VoiceSessionStageProps = {
  activeTopicId: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  captured: CapturedLead;
  connectionStatus: VoiceConnectionStatus;
  onConnect: () => void;
  onDisconnect: (reason: VoiceCloseReason) => void;
  onTopicToggle: (topicId: string) => void;
  selectedSegment: ReturnType<typeof getSegment>;
  status: "idle" | "submitted";
  turnstileReady: boolean;
};

export function VoiceSessionStage({
  activeTopicId,
  audioRef,
  captured,
  connectionStatus,
  onConnect,
  onDisconnect,
  onTopicToggle,
  selectedSegment,
  status,
  turnstileReady,
}: VoiceSessionStageProps) {
  const activeTopic = tourTopics.find((topic) => topic.id === activeTopicId) ?? null;
  const statusCopy = voiceStatusCopy(connectionStatus);
  const completion = handoffCompletion(captured);

  if (status === "submitted") {
    return (
      <div className="grid h-full min-h-[520px] place-items-center text-center">
        <div>
          <MiniOrb size={72} />
          <h2 className="mt-6 text-4xl font-semibold">Sent to {selectedSegment.routedTo.name}.</h2>
          <p className="mx-auto mt-3 max-w-md text-white/62">
            The right Mereka team member has the context and will follow up within 2 working days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto grid max-w-[min(740px,100%)] place-items-center text-center">
        <div className="flex flex-wrap justify-center gap-2">
          <div
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold",
              connectionStatus === "listening"
                ? "border-mk-horizon/45 bg-mk-horizon/14 text-mk-horizon"
                : "border-white/12 bg-white/[0.045] text-white/62",
            )}
            aria-live="polite"
          >
            <RadioIcon className={cn("size-3.5", connectionStatus === "listening" && "motion-safe:animate-pulse")} />
            {statusCopy.label}
          </div>
          <div
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold",
              completion.ready
                ? "border-mk-horizon/45 bg-mk-horizon/14 text-mk-horizon"
                : "border-white/12 bg-white/[0.045] text-white/62",
            )}
          >
            <SparklesIcon className="size-3.5" />
            {completion.completedCount}/{completion.totalCount} details
          </div>
        </div>

        <div
          className={cn(
            "relative mt-8 grid size-44 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#c9d5ec,#5c7db8_44%,#1f3f7c_68%,#100d18)] shadow-[0_0_90px_rgba(92,125,184,0.42)] sm:size-56",
            connectionStatus === "listening" && "shadow-[0_0_120px_rgba(183,216,255,0.5)]",
          )}
        >
          <div
            className={cn(
              "absolute inset-[-24px] rounded-full border border-white/10",
              connectionStatus !== "idle" && "motion-safe:animate-pulse",
            )}
          />
          <div className="absolute inset-[-44px] rounded-full border border-mk-horizon/10" />
          <MiniOrb size={120} />
        </div>

        <p className="mt-8 max-w-2xl text-[clamp(1.8rem,3vw,2.9rem)] font-medium leading-tight text-balance">
          What would you like to build at Oriental?
        </p>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/58">{statusCopy.detail}</p>
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
              onClick={() => onTopicToggle(topic.id)}
              type="button"
            >
              {topic.label}
            </button>
          ))}
        </div>

        {activeTopic ? (
          <div className="mt-5 w-full max-w-2xl rounded-[18px] border border-white/10 bg-white/[0.045] p-4 text-left shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mk-horizon/80">
              Oriental note
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{activeTopic.blurb}</p>
            <p className="mt-2 text-sm leading-6 text-white/60">{activeTopic.script}</p>
          </div>
        ) : null}

        <Button
          className="mt-8 h-12 rounded-full bg-white px-7 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!turnstileReady || connectionStatus === "connecting"}
          onClick={connectionStatus === "listening" ? () => onDisconnect("manual") : onConnect}
          type="button"
        >
          {connectionStatus === "listening" ? (
            <PhoneOffIcon data-icon="inline-start" />
          ) : (
            <Mic2Icon data-icon="inline-start" />
          )}
          {statusCopy.button}
        </Button>
        <p className="mt-3 text-xs text-white/42">Auto-ends after 20 seconds of inactivity or 2.5 minutes total.</p>
        {/* biome-ignore lint/a11y/useMediaCaption: Live WebRTC audio has no static caption asset; captured text appears in the transcript state. */}
        <audio autoPlay ref={audioRef} />
      </div>
    </div>
  );
}
