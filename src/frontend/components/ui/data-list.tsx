import * as React from "react";
import { cn } from "@/lib/cn";

export interface DataListProps {
  items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode }[];
  className?: string;
  columns?: 1 | 2 | 3;
}

export function DataList({ items, className, columns = 1 }: DataListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3 text-sm",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 md:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-3",
        className
      )}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)] font-semibold">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium truncate">{item.value}</dd>
          {item.hint && <p className="text-[11px] text-[var(--color-muted-foreground)] mt-0.5">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}
