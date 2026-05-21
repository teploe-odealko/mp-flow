import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral:
          "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] border border-[var(--color-border)]",
        success:
          "bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[oklch(0.85_0.08_155)]",
        warning:
          "bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[oklch(0.85_0.1_70)]",
        danger:
          "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[oklch(0.86_0.08_25)]",
        info:
          "bg-[var(--color-info-soft)] text-[var(--color-info)] border border-[oklch(0.86_0.06_230)]",
        primary:
          "bg-[var(--color-primary-soft)] text-[var(--color-primary)] border border-[oklch(0.86_0.06_258)]"
      },
      size: {
        sm: "text-[10px] px-1.5 py-px",
        md: "text-[11px] px-2 py-0.5"
      }
    },
    defaultVariants: { tone: "neutral", size: "md" }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
