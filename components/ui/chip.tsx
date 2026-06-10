import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const chipVariants = cva("inline-flex items-center gap-2 rounded-full border px-3 text-xs font-semibold", {
  variants: {
    tone: {
      idle: "border-white/12 bg-white/[0.045] text-white/60",
      active: "border-mk-horizon/45 bg-mk-horizon/15 text-mk-horizon",
    },
  },
  defaultVariants: { tone: "idle" },
});

/** Dark-surface status chip for the voice workspace; `active` lights it in the horizon accent. */
function Chip({ active = false, className, ...props }: React.ComponentProps<"div"> & { active?: boolean }) {
  return (
    <div data-slot="chip" className={cn(chipVariants({ tone: active ? "active" : "idle" }), className)} {...props} />
  );
}

export { Chip, chipVariants };
