import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const toneClasses = {
  neutral: "border-white/10 bg-white/[0.05] text-slate-300",
  blue: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  green: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  red: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
} as const;

const dotClasses = {
  neutral: "bg-slate-400",
  blue: "bg-sky-400",
  green: "bg-emerald-400",
  red: "bg-rose-400",
  amber: "bg-amber-400",
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof toneClasses }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] tabular-nums",
        toneClasses[tone],
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dotClasses[tone])} />
      {children}
    </span>
  );
}
