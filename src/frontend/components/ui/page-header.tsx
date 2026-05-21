import * as React from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, badge, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4 mb-5", className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] mb-1.5">
            {breadcrumbs.map((bc, i) => (
              <React.Fragment key={i}>
                {bc.to ? (
                  <Link to={bc.to} className="hover:text-[var(--color-foreground)] transition-colors">
                    {bc.label}
                  </Link>
                ) : (
                  <span>{bc.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <ChevronRight size={12} className="text-[var(--color-muted-foreground)]/60" />}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-[var(--color-muted-foreground)] mt-1.5 max-w-3xl leading-relaxed">{subtitle}</p>}
      </div>
      {actions && <div className="specActions flex items-center gap-2">{actions}</div>}
    </header>
  );
}
