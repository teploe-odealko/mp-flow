import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  Box,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  HomeIcon,
  Landmark,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  Wallet,
  Warehouse
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  label: string;
  path: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  match: { path: string; end?: boolean }[];
}

const NAV: NavItem[] = [
  { label: "Главная", path: "/", Icon: HomeIcon, match: [{ path: "/", end: true }] },
  { label: "Товары", path: "/products", Icon: Box, match: [{ path: "/products" }] },
  { label: "Поставки", path: "/procurement", Icon: Truck, match: [{ path: "/procurement" }] },
  { label: "Склад", path: "/inventory", Icon: Warehouse, match: [{ path: "/inventory" }] },
  { label: "Продажи", path: "/sales", Icon: ShoppingBag, match: [{ path: "/sales" }, { path: "/returns" }] },
  {
    label: "Маркетплейсы",
    path: "/channels",
    Icon: Store,
    match: [
      { path: "/channels" },
      { path: "/integrations/channels" },
      { path: "/integrations/inbox" },
      { path: "/integrations/finance-events" }
    ]
  },
  { label: "Деньги", path: "/money", Icon: Wallet, match: [{ path: "/money" }, { path: "/finance/payouts" }, { path: "/expenses" }, { path: "/finance/expenses" }] },
  {
    label: "Отчеты",
    path: "/reports",
    Icon: BarChart3,
    match: [
      { path: "/reports", end: true },
      { path: "/reports/profit-and-loss" },
      { path: "/reports/balance-sheet" },
      { path: "/reports/unit-economics" }
    ]
  },
  { label: "Документы", path: "/documents", Icon: FileText, match: [{ path: "/documents" }] },
  {
    label: "Учет",
    path: "/accounting",
    Icon: Landmark,
    match: [{ path: "/accounting" }, { path: "/settings/chart-accounts" }, { path: "/reports/journal" }, { path: "/reports/ledger" }]
  },
  {
    label: "Контроль",
    path: "/controls",
    Icon: CalendarDays,
    match: [
      { path: "/controls", end: true },
      { path: "/controls/corrections" },
      { path: "/controls/audit" }
    ]
  },
  {
    label: "Настройки",
    path: "/settings",
    Icon: Settings,
    match: [{ path: "/setup" }, { path: "/settings" }]
  }
];

interface Props {
  collapsed: boolean;
  onToggle(): void;
}

export function Sidebar({ collapsed, onToggle }: Props) {
  const { pathname } = useLocation();
  return (
    <aside
      className={cn(
        "sidebar flex flex-col bg-[var(--color-card)] border-r border-[var(--color-border)] transition-[width] duration-150 sticky top-0 h-screen shrink-0",
        collapsed ? "w-[68px]" : "w-[232px]"
      )}
    >
      <div className="px-4 h-14 flex items-center gap-2 border-b border-[var(--color-border)]">
        <div className="size-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] grid place-items-center text-white shrink-0">
          <BarChart3 size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight leading-tight">MPFlow</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted-foreground)] leading-tight">
              Управленческий учет
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 scrollbar-thin">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ label, path, Icon, match }) => {
            const active = isActive(pathname, match);
            return (
              <li key={path}>
                <Link
                  to={path}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-3 h-9 rounded-[var(--radius-md)] transition-colors text-sm",
                    collapsed ? "justify-center px-2" : "px-3",
                    active
                      ? "active bg-[var(--color-primary-soft)] text-[var(--color-primary)] font-medium"
                      : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "h-10 mx-2 mb-2 rounded-[var(--radius-md)] flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors",
          collapsed ? "justify-center" : "justify-start px-3"
        )}
        aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        {!collapsed && <span>Свернуть</span>}
      </button>
    </aside>
  );
}

function isActive(pathname: string, matchers: { path: string; end?: boolean }[]) {
  return matchers.some((m) => pathname === m.path || (!m.end && m.path !== "/" && pathname.startsWith(`${m.path}/`)));
}
