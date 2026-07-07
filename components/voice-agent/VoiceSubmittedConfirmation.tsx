"use client";

import { CheckIcon } from "lucide-react";
import { MiniOrb } from "@/components/orb/MiniOrb";
import { Button } from "@/components/ui/button";
import type { getSegment } from "@/lib/segments";
import type { CapturedLead } from "@/lib/voice/realtime-events";

type VoiceSubmittedConfirmationProps = {
  captured: CapturedLead;
  selectedSegment: ReturnType<typeof getSegment>;
  onClose: () => void;
};

/**
 * The focused "done" state shown after a handoff is sent. The intake chrome —
 * partner picker, live orb, editable form — collapses to a single confirmation:
 * who it routed to, a read-only recap of what was captured, and one clear way
 * out. Nothing here is editable; the lead is already on its way.
 */
export function VoiceSubmittedConfirmation({ captured, selectedSegment, onClose }: VoiceSubmittedConfirmationProps) {
  const { routedTo } = selectedSegment;
  const summaryRows: Array<{ label: string; value: string }> = [
    { label: "Name", value: captured.name },
    { label: "Email", value: captured.email },
    { label: "Organisation", value: captured.org },
    { label: "Phone", value: captured.phone },
    { label: "Website / Socials", value: captured.website },
  ].filter((row) => row.value.trim().length > 0);
  const brief = captured.message.trim();

  return (
    <div className="grid min-h-[520px] place-items-center px-6 py-10 text-center">
      <div className="w-full max-w-md">
        <div className="mx-auto grid size-16 place-items-center">
          <MiniOrb size={64} />
        </div>
        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-mk-horizon/30 bg-mk-horizon/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-mk-horizon">
          <CheckIcon className="size-3.5" />
          Sent
        </div>
        <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">Sent to {routedTo.name}.</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/62">
          {routedTo.name} · {routedTo.role} has the context and will follow up within 2 working days.
        </p>

        <div className="mt-7 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/48">Routed as</div>
            <div className="mt-1 text-sm font-semibold text-white/88">{selectedSegment.label}</div>
          </div>
          <dl className="divide-y divide-white/8">
            {summaryRows.map((row) => (
              <div className="flex items-baseline gap-3 px-4 py-2.5" key={row.label}>
                <dt className="w-32 shrink-0 text-[11px] uppercase tracking-[0.12em] text-white/44">{row.label}</dt>
                <dd className="min-w-0 flex-1 break-words text-sm text-white/82">{row.value}</dd>
              </div>
            ))}
            {brief ? (
              <div className="px-4 py-2.5">
                <dt className="text-[11px] uppercase tracking-[0.12em] text-white/44">Brief</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-white/72">{brief}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <Button
          className="mt-7 h-12 w-full rounded-full bg-white px-7 text-sm font-semibold text-mk-off-black transition hover:bg-mk-horizon"
          onClick={onClose}
          type="button"
        >
          Done
        </Button>
        <p className="mt-3 text-xs text-white/50">
          You can close this — a copy of the handoff is on its way to the team.
        </p>
      </div>
    </div>
  );
}
