import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[oklch(0.45_0.2_258)] shadow-[var(--shadow-xs)]",
        secondary:
          "bg-[var(--color-card)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] hover:bg-[var(--color-muted)]",
        ghost:
          "bg-transparent text-[var(--color-foreground)] hover:bg-[var(--color-muted)]",
        outline:
          "bg-transparent text-[var(--color-primary)] border border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]",
        destructive:
          "bg-[var(--color-danger)] text-white hover:bg-[oklch(0.5_0.2_25)]",
        link: "bg-transparent text-[var(--color-primary)] underline-offset-4 hover:underline px-0"
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)] [&_svg]:size-3.5",
        md: "h-9 px-4 text-sm rounded-[var(--radius-md)] [&_svg]:size-4",
        lg: "h-10 px-5 text-sm rounded-[var(--radius-md)] [&_svg]:size-4",
        icon: "h-9 w-9 rounded-[var(--radius-md)] [&_svg]:size-4"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, children, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      return React.cloneElement(child, {
        className: cn(buttonVariants({ variant, size }), className, child.props.className),
        ref,
        ...props
      });
    }
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
