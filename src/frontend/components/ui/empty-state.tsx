import * as React from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-10 px-6 gap-3", className)}>
      {icon && (
        <div className="size-10 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-[var(--color-muted-foreground)]">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs text-[var(--color-muted-foreground)] mt-1 max-w-md">{description}</p>}
      </div>
      {action}
    </div>
  );
}
