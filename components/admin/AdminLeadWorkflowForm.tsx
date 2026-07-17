"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ADMIN_LEAD_OWNERS,
  ADMIN_LEAD_PRIORITIES,
  ADMIN_LEAD_STATUSES,
  type AdminLeadPriority,
  type AdminLeadStatus,
  adminLeadPriorityLabels,
  adminLeadStatusLabels,
  isActiveAdminLeadStatus,
  isTerminalAdminLeadStatus,
} from "@/lib/admin-workflow";

type AdminLeadWorkflowFormProps = {
  compact?: boolean;
  leadId: string;
  initialOwner?: string | null;
  initialNextActionAt?: number | null;
  initialNextActionNote?: string | null;
  initialOutcomeReason?: string | null;
  initialPriority: AdminLeadPriority;
  initialRevision?: number | null;
  initialStatus: AdminLeadStatus;
};

export function AdminLeadWorkflowForm({
  compact = false,
  leadId,
  initialOwner,
  initialNextActionAt,
  initialNextActionNote,
  initialOutcomeReason,
  initialPriority,
  initialRevision,
  initialStatus,
}: AdminLeadWorkflowFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [priority, setPriority] = useState(initialPriority);
  const [owner, setOwner] = useState(initialOwner ?? "");
  const [note, setNote] = useState("");
  const [nextActionAt, setNextActionAt] = useState(toDateTimeLocal(initialNextActionAt));
  const [nextActionNote, setNextActionNote] = useState(initialNextActionNote ?? "");
  const [outcomeReason, setOutcomeReason] = useState(initialOutcomeReason ?? "");
  const [reason, setReason] = useState("");
  const [revision, setRevision] = useState(initialRevision ?? 0);
  const [isPending, startTransition] = useTransition();
  const active = isActiveAdminLeadStatus(status);
  const terminal = isTerminalAdminLeadStatus(status);
  const historicalOwner = owner && !ADMIN_LEAD_OWNERS.includes(owner as (typeof ADMIN_LEAD_OWNERS)[number]);

  useEffect(() => {
    setStatus(initialStatus);
    setPriority(initialPriority);
    setOwner(initialOwner ?? "");
    setNextActionAt(toDateTimeLocal(initialNextActionAt));
    setNextActionNote(initialNextActionNote ?? "");
    setOutcomeReason(initialOutcomeReason ?? "");
    setRevision(initialRevision ?? 0);
  }, [
    initialNextActionAt,
    initialNextActionNote,
    initialOutcomeReason,
    initialOwner,
    initialPriority,
    initialRevision,
    initialStatus,
  ]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const response = await fetch(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          priority,
          owner,
          note,
          nextActionAt: nextActionAt ? new Date(nextActionAt).getTime() : null,
          nextActionNote,
          outcomeReason,
          expectedRevision: revision,
          reason,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          currentRevision?: number;
          error?: string;
          fields?: Record<string, string>;
        } | null;
        const fieldMessage = body?.fields ? Object.values(body.fields)[0] : undefined;
        toast.error(response.status === 409 ? "This enquiry changed in another session." : "Workflow update failed.", {
          description:
            response.status === 409
              ? "The latest record is being loaded. Review it before saving again."
              : (fieldMessage ?? body?.error ?? `HTTP ${response.status}`),
        });
        if (response.status === 409) router.refresh();
        return;
      }
      const body = (await response.json()) as { changed: boolean; revision: number };
      setRevision(body.revision);
      setNote("");
      setReason("");
      toast.success(body.changed ? "Workflow updated." : "No workflow fields changed.");
      router.refresh();
    });
  }

  return (
    <form
      className="mt-4 grid gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4"
      data-admin-workflow-form
      onSubmit={submit}
    >
      <div className={compact ? "grid gap-3 2xl:grid-cols-3" : "grid gap-3 sm:grid-cols-3"}>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Status
          <select
            className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminLeadStatus)}
          >
            {ADMIN_LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {adminLeadStatusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Priority
          <select
            className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
            value={priority}
            onChange={(event) => setPriority(event.target.value as AdminLeadPriority)}
          >
            {ADMIN_LEAD_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {adminLeadPriorityLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Owner
          <select
            className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
            required={active}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">Unassigned</option>
            {historicalOwner ? <option value={owner}>Historical · {owner}</option> : null}
            {ADMIN_LEAD_OWNERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Next action
          <input
            className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
            maxLength={500}
            placeholder="Call to confirm programme scope"
            required={active}
            value={nextActionNote}
            onChange={(event) => setNextActionNote(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Due
          <input
            className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
            required={active}
            type="datetime-local"
            value={nextActionAt}
            onChange={(event) => setNextActionAt(event.target.value)}
          />
        </label>
      </div>
      {terminal ? (
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Outcome reason
          <Textarea
            className="min-h-16 bg-white/[0.04] text-sm normal-case tracking-normal"
            maxLength={500}
            placeholder="What was agreed, won, declined, duplicated, or disqualified?"
            required
            value={outcomeReason}
            onChange={(event) => setOutcomeReason(event.target.value)}
          />
        </label>
      ) : null}
      <Textarea
        className="min-h-20 bg-white/[0.04] text-sm"
        maxLength={600}
        placeholder="Internal context for the next person who opens this record"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        Reason for this change
        <input
          className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal text-slate-100 outline-none focus:border-sky-400"
          maxLength={300}
          minLength={3}
          placeholder="Assigned after morning intake review"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-slate-400">
          Revision {revision} · every saved change is attributed and added to the activity trail.
        </p>
        <Button disabled={isPending} size="sm" type="submit">
          <CheckIcon className="size-4" />
          {isPending ? "Saving" : "Save workflow"}
        </Button>
      </div>
    </form>
  );
}

function toDateTimeLocal(value: number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
