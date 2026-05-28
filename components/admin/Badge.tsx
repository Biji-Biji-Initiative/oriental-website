import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em]",
        tone === "neutral" && "border-mk-ash/20 bg-mk-paper text-mk-ash",
        tone === "blue" && "border-mk-blue/20 bg-mk-blue/10 text-mk-blue",
        tone === "green" && "border-emerald-700/20 bg-emerald-700/10 text-emerald-800",
        tone === "red" && "border-destructive/20 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}
