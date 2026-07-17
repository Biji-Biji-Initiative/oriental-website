"use client";

import { CheckSquare2Icon, UsersRoundIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ADMIN_LEAD_OWNERS } from "@/lib/admin-workflow";

type BulkLead = {
  leadId: string;
  label: string;
  meta: string;
  revision: number;
};

export function AdminBulkAssignmentForm({ leads }: { leads: BulkLead[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [nextActionNote, setNextActionNote] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggle(leadId: string) {
    setSelected((current) =>
      current.includes(leadId) ? current.filter((value) => value !== leadId) : [...current, leadId],
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const selectedLeads = leads
        .filter((lead) => selected.includes(lead.leadId))
        .map((lead) => ({ leadId: lead.leadId, expectedRevision: lead.revision }));
      const response = await fetch("/api/admin/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: selectedLeads,
          owner,
          nextActionAt: nextActionAt ? new Date(nextActionAt).getTime() : 0,
          nextActionNote,
          reason,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        count?: number;
        error?: string;
        fields?: Record<string, string>;
      } | null;
      if (!response.ok) {
        const fieldMessage = body?.fields ? Object.values(body.fields)[0] : undefined;
        toast.error(response.status === 409 ? "Some enquiries changed before assignment." : "Bulk assignment failed.", {
          description:
            response.status === 409
              ? "The current records are being reloaded. Review the selection and try again."
              : (fieldMessage ?? body?.error ?? `HTTP ${response.status}`),
        });
        if (response.status === 409) router.refresh();
        return;
      }

      toast.success(`${body?.count ?? selectedLeads.length} enquiries assigned to ${owner}.`);
      setSelected([]);
      setNextActionNote("");
      setReason("");
      router.refresh();
    });
  }

  if (leads.length === 0) return null;

  return (
    <details className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05]" data-bulk-assignment>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden sm:px-5">
        <span className="flex items-center gap-2 text-sm font-semibold text-sky-300">
          <UsersRoundIcon className="size-4" /> Assign multiple enquiries
        </span>
        <span className="text-xs font-medium text-slate-400">{selected.length} selected</span>
      </summary>
      <form className="grid gap-4 border-t border-sky-400/15 p-4 sm:p-5" onSubmit={submit}>
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Choose active enquiries
          </legend>
          <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.04] p-2 sm:grid-cols-2">
            {leads.map((lead) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-white/[0.04]"
                key={lead.leadId}
              >
                <input
                  checked={selected.includes(lead.leadId)}
                  className="mt-1 size-4 accent-sky-400"
                  onChange={() => toggle(lead.leadId)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{lead.label}</span>
                  <span className="block truncate text-xs text-slate-400">{lead.meta}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Owner
            <select
              className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-sky-400"
              onChange={(event) => setOwner(event.target.value)}
              required
              value={owner}
            >
              <option value="">Choose owner</option>
              {ADMIN_LEAD_OWNERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Shared next action
            <input
              className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-sky-400"
              maxLength={500}
              onChange={(event) => setNextActionNote(event.target.value)}
              placeholder="Review and send tailored introduction"
              required
              value={nextActionNote}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Due
            <input
              className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-sky-400"
              onChange={(event) => setNextActionAt(event.target.value)}
              required
              type="datetime-local"
              value={nextActionAt}
            />
          </label>
        </div>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Reason for assignment
          <input
            className="h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-sky-400"
            maxLength={300}
            minLength={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Morning intake allocation"
            required
            value={reason}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-slate-400">
            The batch is atomic: if any selected record is stale or invalid, none are changed.
          </p>
          <Button disabled={selected.length === 0 || isPending} type="submit">
            <CheckSquare2Icon className="size-4" />
            {isPending ? "Assigning" : `Assign ${selected.length || "selected"}`}
          </Button>
        </div>
      </form>
    </details>
  );
}
