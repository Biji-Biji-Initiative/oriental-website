"use client";

import { Mic2Icon, PhoneOffIcon, RadioIcon, SendIcon, SparklesIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { tourTopics } from "@/lib/content";
import type { getSegment } from "@/lib/segments";
import { cn } from "@/lib/utils";
import type { VoiceTurnPhase } from "@/lib/voice/latency";
import type { CapturedLead } from "@/lib/voice/realtime-events";
import type { VoiceCloseReason, VoiceConnectionStatus } from "./useRealtimeVoiceSession";
import { useMicAudioLevel, useVoiceAudioLevel } from "./useVoiceAudioLevel";
import { handoffCompletion, voiceStatusCopy } from "./voice-dialog-copy";

export const WAITING_COPY_DELAY_MS = 300;

const NebulaM = dynamic(() => import("@/components/brand-motion/NebulaM").then((module) => module.NebulaM), {
  loading: () => (
    <div className="relative">
      <MiniOrb size={120} />
    </div>
  ),
  ssr: false,
});

type VoiceSessionStageProps = {
  activeTopicId: string | null;
  assistantDraft: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  captured: CapturedLead;
  connectionStatus: VoiceConnectionStatus;
  getLocalStream: () => MediaStream | null;
  /** Last completed assistant utterance, shown when no draft is streaming. */
  lastAssistantLine: string;
  onConnect: () => void;
  onDisconnect: (reason: VoiceCloseReason) => void;
  onSendText: (text: string) => boolean;
  onTopicToggle: (topicId: string) => void;
  onLocalSpeechEnded: (at: number) => void;
  onRemoteAudioStarted: (at: number) => void;
  selectedSegment: ReturnType<typeof getSegment>;
  status: "idle" | "submitted";
  turnPhase: VoiceTurnPhase;
};

export function VoiceSessionStage({
  activeTopicId,
  assistantDraft,
  audioRef,
  captured,
  connectionStatus,
  getLocalStream,
  lastAssistantLine,
  onConnect,
  onDisconnect,
  onSendText,
  onTopicToggle,
  onLocalSpeechEnded,
  onRemoteAudioStarted,
  selectedSegment,
  status,
  turnPhase,
}: VoiceSessionStageProps) {
  const activeTopic = tourTopics.find((topic) => topic.id === activeTopicId) ?? null;
  const [showWaitingCopy, setShowWaitingCopy] = useState(false);
  useEffect(() => {
    if (turnPhase !== "waiting_for_response") {
      setShowWaitingCopy(false);
      return;
    }
    const timer = window.setTimeout(() => setShowWaitingCopy(true), WAITING_COPY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [turnPhase]);
  const statusCopy = voiceStatusCopy(connectionStatus, turnPhase, showWaitingCopy);
  const completion = handoffCompletion(captured);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const brandMotionLevelsRef = useRef({ user: 0, voice: 0 });
  const [draft, setDraft] = useState("");
  const micPermission = useMicrophonePermissionState();
  useVoiceAudioLevel(audioRef, orbRef, connectionStatus === "listening", {
    onLevel: (level) => {
      brandMotionLevelsRef.current.voice = level;
    },
    onActivityStart: onRemoteAudioStarted,
  });
  useMicAudioLevel(getLocalStream, orbRef, connectionStatus === "listening", {
    onLevel: (level) => {
      brandMotionLevelsRef.current.user = level;
    },
    onActivityStop: onLocalSpeechEnded,
  });

  const handleComposerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (onSendText(text)) setDraft("");
  };

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
      <div className="mx-auto grid max-w-[min(740px,100%)] place-items-center text-center" data-voice-session-stage>
        <div className="flex flex-wrap justify-center gap-2" data-voice-stage-status>
          <Chip active={connectionStatus === "listening"} aria-live="polite" className="h-9">
            <RadioIcon className={cn("size-3.5", connectionStatus === "listening" && "motion-safe:animate-pulse")} />
            {statusCopy.label}
          </Chip>
          <Chip active={completion.ready} className="h-9">
            <SparklesIcon className="size-3.5" />
            {completion.completedCount}/{completion.totalCount} details
          </Chip>
        </div>

        <div
          className="voice-orb voice-orb--nebula mt-8 grid size-44 place-items-center sm:size-56"
          data-status={connectionStatus}
          data-turn={turnPhase}
          data-voice-stage-orb
          ref={orbRef}
        >
          <NebulaM connectionStatus={connectionStatus} levelsRef={brandMotionLevelsRef} turnPhase={turnPhase} />
        </div>

        {connectionStatus === "listening" && (assistantDraft || lastAssistantLine) ? (
          // The transcript log is the accessible live region; this caption is visual.
          // The last completed line stays up between turns so the visitor can
          // re-read the question instead of watching it vanish mid-thought.
          <p
            aria-hidden
            className="mt-6 min-h-14 w-full max-w-2xl whitespace-normal break-words text-pretty text-base leading-7 text-white/85"
            data-voice-stage-caption
          >
            {captionTail(assistantDraft || lastAssistantLine)}
          </p>
        ) : (
          <p
            className="mt-8 max-w-2xl text-[clamp(1.8rem,3vw,2.9rem)] font-medium leading-tight text-balance"
            data-voice-stage-headline
          >
            What would you like to build at Oriental?
          </p>
        )}
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/58" data-voice-stage-detail>
          {statusCopy.detail}
        </p>
        <p className="mt-2 text-sm text-white/55" data-voice-stage-opener>
          {selectedSegment.voiceOpener}
        </p>

        <Button
          className="mt-6 h-12 rounded-full bg-white px-7 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon disabled:cursor-not-allowed disabled:opacity-55"
          data-voice-primary-action
          disabled={
            connectionStatus === "connecting" ||
            connectionStatus === "reconnecting" ||
            connectionStatus === "requesting_mic"
          }
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
        <p className="mt-3 text-xs text-white/55" data-voice-mic-guidance>
          {micPermission === "prompt" && connectionStatus === "idle"
            ? "Choose your browser’s every-visit option to remember the mic. One-time access will ask again later."
            : "Speak or type anytime. Reka says a quick goodbye if you go quiet, and your typed details stay here."}
        </p>

        {connectionStatus === "listening" ? (
          <form className="mt-6 flex w-full max-w-xl gap-2" data-voice-stage-composer onSubmit={handleComposerSubmit}>
            <Input
              aria-label="Type a message to Reka"
              className="rounded-full px-5"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Prefer typing? Reka reads it instantly."
              value={draft}
              variant="glass"
            />
            <Button
              aria-label="Send typed message"
              className="size-11 rounded-full bg-white/10 text-white transition hover:bg-mk-horizon hover:text-mk-off-black disabled:opacity-40"
              disabled={!draft.trim()}
              size="icon"
              type="submit"
            >
              <SendIcon className="size-4" />
            </Button>
          </form>
        ) : null}

        <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2" data-voice-stage-topics>
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
          <div className="mt-5 w-full max-w-2xl rounded-lg border border-white/10 bg-white/[0.045] p-4 text-left shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mk-horizon/80">
              Oriental note
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{activeTopic.blurb}</p>
            <p className="mt-2 text-sm leading-6 text-white/60">{activeTopic.script}</p>
          </div>
        ) : null}
        {/* biome-ignore lint/a11y/useMediaCaption: Live WebRTC audio streams live captions above; the transcript log is the accessible record. */}
        <audio autoPlay ref={audioRef} />
      </div>
    </div>
  );
}

/**
 * Live microphone permission state. `prompt` can mean first use or an expired
 * one-time grant, so the copy explains both without assuming lifecycle history.
 * Returns null when the Permissions API cannot answer (e.g. Firefox).
 */
function useMicrophonePermissionState() {
  const [state, setState] = useState<PermissionState | null>(null);
  useEffect(() => {
    let cancelled = false;
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        setState(result.state);
        result.onchange = () => setState(result.state);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);
  return state;
}

function captionTail(text: string, maxChars = 220) {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const firstSpace = tail.indexOf(" ");
  // Drop the leading word fragment so the caption never starts mid-word.
  return `…${firstSpace > 0 && firstSpace < 40 ? tail.slice(firstSpace + 1) : tail}`;
}
