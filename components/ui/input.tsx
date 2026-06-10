import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const inputVariants = cva(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "",
        // Dark-surface field used across the voice workspace.
        glass:
          "h-11 rounded-[16px] border-white/12 bg-white/[0.045] px-4 text-white placeholder:text-white/30 focus-visible:border-mk-horizon focus-visible:ring-mk-horizon/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return <input type={type} data-slot="input" className={cn(inputVariants({ variant }), className)} {...props} />;
}

export { Input, inputVariants };
