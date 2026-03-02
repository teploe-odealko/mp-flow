import React, { useState, useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "./auth-provider"
import { apiGet } from "../lib/api"
import { ColumnDocsProvider } from "../components/column-docs-provider"
import {
  Package,
  Warehouse,
  Calculator,
  Truck,
  ShoppingCart,
  Wallet,
  BarChart3,
  Puzzle,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  LogOut,
  type LucideIcon,
} from "lucide-react"

const coreNavItems: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "/catalog", label: "Каталог", icon: Package },
  { path: "/warehouse", label: "Склад", icon: Warehouse },
  { path: "/procurement", label: "Закупки", icon: Calculator },
  { path: "/suppliers", label: "Поступления", icon: Truck },
  { path: "/sales", label: "Продажи", icon: ShoppingCart },
  { path: "/finance", label: "Финансы", icon: Wallet },
  { path: "/analytics", label: "Аналитика", icon: BarChart3 },
]

function NavLink({
  path,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  path: string
  label: string
  icon: LucideIcon
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      to={path}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-accent-glow text-accent"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
      } ${collapsed ? "justify-center" : ""}`}
    >
      <Icon size={18} strokeWidth={1.8} className="shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}

const SIDEBAR_KEY = "mpflow-sidebar-collapsed"

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "1" } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0") } catch {}
  }, [collapsed])

  const { data: pluginsData } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => apiGet<{ plugins: Array<{ is_enabled: boolean; adminNav?: Array<{ path: string; label: string }> }> }>("/api/plugins"),
    enabled: !!user,
    staleTime: 30_000,
  })

  const pluginNavItems = pluginsData?.plugins
    ?.filter((p) => p.is_enabled && p.adminNav?.length)
    ?.flatMap((p) => p.adminNav!) || []

  return (
    <div className="flex h-screen bg-bg-deep text-text-primary">
      {/* Sidebar */}
      <aside
        className={`${
          collapsed ? "w-16" : "w-56"
        } bg-bg-surface border-r border-bg-border flex flex-col transition-[width] duration-200 shrink-0`}
      >
        {/* Logo + collapse toggle */}
        <div className={`flex items-center border-b border-bg-border ${collapsed ? "justify-center p-3" : "justify-between p-4"}`}>
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <img src="/logo.png" alt="MPFlow" className="w-8 h-8 rounded-lg shrink-0" />
            {!collapsed && <span className="text-base font-semibold text-text-primary truncate">MPFlow</span>}
          </Link>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="text-text-muted hover:text-text-secondary transition-colors shrink-0"
              title="Свернуть меню"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>

        {/* Expand button (collapsed state) */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="flex justify-center py-2.5 text-text-muted hover:text-text-secondary transition-colors"
            title="Развернуть меню"
          >
            <PanelLeftOpen size={18} />
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {coreNavItems.map((item) => (
            <NavLink
              key={item.path}
              path={item.path}
              label={item.label}
              icon={item.icon}
              active={pathname.startsWith(item.path)}
              collapsed={collapsed}
            />
          ))}
          {pluginNavItems.length > 0 && (
            <>
              <div className="border-t border-bg-border my-2" />
              {pluginNavItems.map((item) => (
                <NavLink
                  key={item.path}
                  path={item.path}
                  label={item.label}
                  icon={Puzzle}
                  active={pathname.startsWith(item.path)}
                  collapsed={collapsed}
                />
              ))}
            </>
          )}
          <div className="border-t border-bg-border my-2" />
          <NavLink path="/plugins" label="Плагины" icon={Puzzle} active={pathname.startsWith("/plugins")} collapsed={collapsed} />
        </nav>

        {/* Bottom: Docs + User */}
        <div className="border-t border-bg-border">
          {/* Docs link */}
          <a
            href="https://docs.mp-flow.ru"
            target="_blank"
            rel="noopener noreferrer"
            title={collapsed ? "Документация" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 text-sm text-text-muted hover:text-text-secondary transition-colors ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <BookOpen size={18} strokeWidth={1.8} className="shrink-0" />
            {!collapsed && <span>Документация</span>}
          </a>

          {/* User */}
          {user && (
            <div className={`border-t border-bg-border px-3 py-3 ${collapsed ? "flex justify-center" : ""}`}>
              {collapsed ? (
                <button
                  onClick={logout}
                  title="Выйти"
                  className="text-text-muted hover:text-outflow transition-colors"
                >
                  <LogOut size={18} />
                </button>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted truncate max-w-[140px]">{user.email}</p>
                  <button
                    onClick={logout}
                    title="Выйти"
                    className="text-text-muted hover:text-outflow transition-colors"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <ColumnDocsProvider>
          {children}
        </ColumnDocsProvider>
      </main>
    </div>
  )
}
