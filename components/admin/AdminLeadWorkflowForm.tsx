"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ADMIN_LEAD_PRIORITIES,
  ADMIN_LEAD_STATUSES,
  type AdminLeadPriority,
  type AdminLeadStatus,
  adminLeadPriorityLabels,
  adminLeadStatusLabels,
} from "@/lib/admin-workflow";

type AdminLeadWorkflowFormProps = {
  compact?: boolean;
  leadId: string;
  initialOwner?: string | null;
  initialPriority: AdminLeadPriority;
  initialStatus: AdminLeadStatus;
};

export function AdminLeadWorkflowForm({
  compact = false,
  leadId,
  initialOwner,
  initialPriority,
  initialStatus,
}: AdminLeadWorkflowFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [priority, setPriority] = useState(initialPriority);
  const [owner, setOwner] = useState(initialOwner ?? "");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const response = await fetch(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priority, owner, note }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null;
        toast.error("Workflow update failed.", {
          description: body?.reason ?? body?.error ?? `HTTP ${response.status}`,
        });
        return;
      }
      setNote("");
      toast.success("Workflow updated.");
      router.refresh();
    });
  }

  return (
    <form className="mt-4 grid gap-3 rounded-lg border border-mk-ash/15 bg-white p-3" onSubmit={submit}>
      <div className={compact ? "grid gap-3 2xl:grid-cols-3" : "grid gap-3 sm:grid-cols-3"}>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
          Status
          <select
            className="h-9 rounded-lg border border-mk-ash/20 bg-mk-paper px-2 text-sm font-medium normal-case tracking-normal text-mk-off-black outline-none focus:border-mk-blue"
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
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
          Priority
          <select
            className="h-9 rounded-lg border border-mk-ash/20 bg-mk-paper px-2 text-sm font-medium normal-case tracking-normal text-mk-off-black outline-none focus:border-mk-blue"
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
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
          Owner
          <input
            className="h-9 rounded-lg border border-mk-ash/20 bg-mk-paper px-2 text-sm font-medium normal-case tracking-normal text-mk-off-black outline-none focus:border-mk-blue"
            maxLength={80}
            placeholder="Unassigned"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
      </div>
      <Textarea
        className="min-h-20 bg-mk-paper text-sm"
        maxLength={600}
        placeholder="Add a short handoff note or next action"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex justify-end">
        <Button disabled={isPending} size="sm" type="submit">
          <CheckIcon className="size-4" />
          {isPending ? "Saving" : "Save workflow"}
        </Button>
      </div>
    </form>
  );
}
