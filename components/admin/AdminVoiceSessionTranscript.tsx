"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type TranscriptEntry = {
  role: string;
  text: string;
};

type VoiceSessionDetailResponse =
  | { ok: true; session: { transcript: TranscriptEntry[] } }
  | { ok: false; error?: string };

type AdminVoiceSessionTranscriptProps = {
  reviewId: string;
  expectedTurnCount: number;
};

export function AdminVoiceSessionTranscript({ reviewId, expectedTurnCount }: AdminVoiceSessionTranscriptProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(false);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; transcript: TranscriptEntry[] }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const loadTranscript = useCallback(async () => {
    if (requestedRef.current || expectedTurnCount <= 0) return;
    requestedRef.current = true;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/admin/voice-sessions/${encodeURIComponent(reviewId)}`, {
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => null)) as VoiceSessionDetailResponse | null;
      if (!response.ok || !body?.ok) {
        setState({
          status: "error",
          message: body && !body.ok ? (body.error ?? "detail_failed") : `HTTP ${response.status}`,
        });
        requestedRef.current = false;
        return;
      }
      setState({ status: "loaded", transcript: body.session.transcript });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "network_failed" });
      requestedRef.current = false;
    }
  }, [expectedTurnCount, reviewId]);

  useEffect(() => {
    const root = rootRef.current;
    const details = root?.closest("details");
    if (!details) return;

    const loadWhenOpen = () => {
      if (details.open) void loadTranscript();
    };

    loadWhenOpen();
    details.addEventListener("toggle", loadWhenOpen);
    return () => details.removeEventListener("toggle", loadWhenOpen);
  }, [loadTranscript]);

  if (expectedTurnCount <= 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-mk-ash/15 bg-white p-3" ref={rootRef}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mk-ash">
          Transcript · {expectedTurnCount} {expectedTurnCount === 1 ? "turn" : "turns"}
        </div>
        {state.status === "error" ? (
          <Button onClick={() => void loadTranscript()} size="sm" type="button" variant="outline">
            Retry
          </Button>
        ) : null}
      </div>
      {state.status === "loading" ? <p className="mt-2 text-xs leading-5 text-mk-ash">Loading transcript...</p> : null}
      {state.status === "error" ? (
        <p className="mt-2 text-xs leading-5 text-destructive">Could not load transcript: {state.message}</p>
      ) : null}
      {state.status === "loaded" ? (
        <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto">
          {state.transcript.length > 0 ? (
            state.transcript.map((entry) => (
              <p className="text-xs leading-5 text-mk-ash" key={`${entry.role}:${entry.text.slice(0, 120)}`}>
                <span className="font-semibold text-mk-off-black">
                  {entry.role === "assistant" ? "Reka" : "Visitor"}:
                </span>{" "}
                {entry.text}
              </p>
            ))
          ) : (
            <p className="text-xs leading-5 text-mk-ash">No transcript turns were stored for this session.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
