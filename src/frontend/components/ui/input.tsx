import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-9 w-full rounded-[var(--radius-md)] border bg-[var(--color-card)] px-3 text-sm transition-colors",
        "border-[var(--color-border-strong)] placeholder:text-[var(--color-muted-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:border-[var(--color-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "numeric",
        invalid && "border-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[72px] w-full rounded-[var(--radius-md)] border bg-[var(--color-card)] px-3 py-2 text-sm transition-colors leading-relaxed",
        "border-[var(--color-border-strong)] placeholder:text-[var(--color-muted-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:border-[var(--color-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
          {label}
          {required && <span aria-hidden="true" className="text-[var(--color-danger)] ml-0.5">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="text-[11px] text-[var(--color-muted-foreground)]">{hint}</span>}
      {error && <span className="text-[11px] text-[var(--color-danger)]">{error}</span>}
    </label>
  );
}
