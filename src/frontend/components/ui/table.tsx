import * as React from "react";
import { cn } from "@/lib/cn";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="tableScroll relative w-full overflow-x-auto">
      <table ref={ref} className={cn("w-full text-sm border-collapse", className)} {...props} />
    </div>
  )
);
Table.displayName = "Table";

export const THead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]",
        className
      )}
      {...props}
    />
  )
);
THead.displayName = "THead";

export const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("divide-y divide-[var(--color-border)]", className)} {...props} />
  )
);
TBody.displayName = "TBody";

export const TR = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }>(
  ({ className, interactive, selected, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "transition-colors",
        interactive && "cursor-pointer hover:bg-[var(--color-muted)]",
        selected && "bg-[var(--color-primary-soft)]",
        className
      )}
      {...props}
    />
  )
);
TR.displayName = "TR";

export const TH = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(
  ({ className, numeric, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-9 px-3 text-left align-middle font-semibold border-b border-[var(--color-border-strong)] bg-[var(--color-muted)]/40 first:rounded-tl-[var(--radius-md)] last:rounded-tr-[var(--radius-md)]",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
);
TH.displayName = "TH";

export const TD = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; muted?: boolean }>(
  ({ className, numeric, muted, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-3 py-2.5 align-middle",
        numeric && "text-right numeric",
        muted && "text-[var(--color-muted-foreground)]",
        className
      )}
      {...props}
    />
  )
);
TD.displayName = "TD";
