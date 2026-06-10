"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Keeps the operations console fresh: silent refresh on an interval (visible tabs only) plus a manual button. */
export function AdminAutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, router]);

  return (
    <Button
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
      variant="outline"
    >
      <RefreshCwIcon data-icon="inline-start" />
      {isPending ? "Refreshing..." : "Refresh"}
    </Button>
  );
}
