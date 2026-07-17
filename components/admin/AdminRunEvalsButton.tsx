"use client";

import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MODEL_CHOICES = [
  { value: "", label: "Configured judge model" },
  { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
];

type AdminRunEvalsButtonProps = {
  /** Target specific sessions; omit to evaluate the recent window. */
  reviewIds?: string[];
  /** Compact variant renders a single small button without the model picker. */
  compact?: boolean;
  children?: string;
};

export function AdminRunEvalsButton({ reviewIds, compact, children }: AdminRunEvalsButtonProps) {
  const router = useRouter();
  const [model, setModel] = useState("");
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const response = await fetch("/api/admin/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          ...(reviewIds?.length ? { reviewIds } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; model: string; judged: number; persisted: number; failures: number }
        | { ok: false; error?: string }
        | null;
      if (!response.ok || !body?.ok) {
        const error = body && !body.ok ? body.error : undefined;
        toast.error("Evaluation run failed.", {
          description:
            error === "unconfigured"
              ? "OPENAI_API_KEY or Convex credentials are missing in this environment."
              : error === "no_sessions"
                ? "No judgeable customer sessions found in the recent window."
                : (error ?? `HTTP ${response.status}`),
        });
        return;
      }
      toast.success(`Scored ${body.persisted} of ${body.judged} sessions with ${body.model}.`, {
        description: body.failures > 0 ? `${body.failures} session(s) could not be judged — retry later.` : undefined,
      });
      router.refresh();
    });
  }

  if (compact) {
    return (
      <Button disabled={isPending} onClick={run} size="sm" type="button" variant="outline">
        <SparklesIcon className="size-3.5" />
        {isPending ? "Scoring..." : (children ?? "Evaluate now")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="admin-eval-model">
        Judge model
      </label>
      <select
        className="h-8 rounded-lg border border-white/15 bg-white/[0.04] px-2 text-xs font-medium text-slate-300 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
        disabled={isPending}
        id="admin-eval-model"
        onChange={(event) => setModel(event.target.value)}
        value={model}
      >
        {MODEL_CHOICES.map((choice) => (
          <option key={choice.value || "default"} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <Button disabled={isPending} onClick={run} type="button">
        <SparklesIcon className="size-4" />
        {isPending ? "Scoring sessions..." : (children ?? "Run evaluation")}
      </Button>
    </div>
  );
}
