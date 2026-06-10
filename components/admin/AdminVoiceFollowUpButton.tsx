"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type AdminVoiceFollowUpButtonProps = {
  reviewId: string;
  markAs: boolean;
  children: string;
  variant?: "default" | "outline" | "ghost";
};

export function AdminVoiceFollowUpButton({
  reviewId,
  markAs,
  children,
  variant = "outline",
}: AdminVoiceFollowUpButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const response = await fetch(`/api/admin/voice-sessions/${encodeURIComponent(reviewId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followedUp: markAs }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error("Could not update follow-up state.", {
          description: body?.error ?? `HTTP ${response.status}`,
        });
        return;
      }
      toast.success(markAs ? "Marked as followed up." : "Moved back to the queue.");
      router.refresh();
    });
  }

  return (
    <Button disabled={isPending} onClick={submit} size="sm" type="button" variant={variant}>
      {isPending ? "Saving..." : children}
    </Button>
  );
}
