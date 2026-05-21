import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const kpiVariants = cva("rounded-[var(--radius-lg)] border p-4 flex items-start gap-3 transition-colors", {
  variants: {
    tone: {
      neutral: "bg-[var(--color-card)] border-[var(--color-border)]",
      primary: "bg-[var(--color-primary-soft)] border-[oklch(0.88_0.06_258)]",
      success: "bg-[var(--color-success-soft)] border-[oklch(0.88_0.06_155)]",
      warning: "bg-[var(--color-warning-soft)] border-[oklch(0.88_0.08_70)]",
      danger: "bg-[var(--color-danger-soft)] border-[oklch(0.88_0.06_25)]",
      info: "bg-[var(--color-info-soft)] border-[oklch(0.88_0.05_230)]"
    }
  },
  defaultVariants: { tone: "neutral" }
});

export interface KpiProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof kpiVariants> {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

export function Kpi({ icon, label, value, hint, tone, className, ...props }: KpiProps) {
  return (
    <div className={cn(kpiVariants({ tone }), className)} {...props}>
      {icon && (
        <div
          className={cn(
            "size-9 rounded-[var(--radius-md)] grid place-items-center shrink-0",
            tone === "primary" && "bg-[var(--color-primary)] text-white",
            tone === "success" && "bg-[var(--color-success)] text-white",
            tone === "warning" && "bg-[var(--color-warning)] text-white",
            tone === "danger" && "bg-[var(--color-danger)] text-white",
            tone === "info" && "bg-[var(--color-info)] text-white",
            (!tone || tone === "neutral") && "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</span>
        <span className="text-xl font-semibold tracking-tight leading-tight numeric">{value}</span>
        {hint && <span className="text-[11px] text-[var(--color-muted-foreground)]">{hint}</span>}
      </div>
    </div>
  );
}
