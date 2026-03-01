import React from "react"
import { Link, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "./auth-provider"
import { apiGet } from "../lib/api"

const coreNavItems = [
  { path: "/catalog", label: "Каталог" },
  { path: "/warehouse", label: "Склад" },
  { path: "/suppliers", label: "Закупки" },
  { path: "/sales", label: "Продажи" },
  { path: "/finance", label: "Финансы" },
  { path: "/analytics", label: "Аналитика" },
]

function NavLink({ path, label, active }: { path: string; label: string; active: boolean }) {
  return (
    <Link
      to={path}
      className={`block px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-accent-glow text-accent"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
      }`}
    >
      {label}
    </Link>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()

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
      <aside className="w-56 bg-bg-surface border-r border-bg-border flex flex-col">
        <div className="p-4 border-b border-bg-border">
          <h1 className="text-lg font-semibold text-accent">MPFlow</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {coreNavItems.map((item) => (
            <NavLink key={item.path} path={item.path} label={item.label} active={pathname.startsWith(item.path)} />
          ))}
          {pluginNavItems.length > 0 && (
            <>
              <div className="border-t border-bg-border my-2" />
              {pluginNavItems.map((item) => (
                <NavLink key={item.path} path={item.path} label={item.label} active={pathname.startsWith(item.path)} />
              ))}
            </>
          )}
          <div className="border-t border-bg-border my-2" />
          <NavLink path="/plugins" label="Плагины" active={pathname.startsWith("/plugins")} />
        </nav>
        {user && (
          <div className="p-3 border-t border-bg-border">
            <p className="text-xs text-text-muted truncate">{user.email}</p>
            <button onClick={logout} className="text-xs text-text-secondary hover:text-text-primary mt-1">
              Выйти
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {children}
      </main>
    </div>
  )
}
