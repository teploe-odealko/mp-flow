import React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "./auth-provider"

const navItems = [
  { path: "/catalog", label: "Каталог" },
  { path: "/warehouse", label: "Склад" },
  { path: "/suppliers", label: "Закупки" },
  { path: "/sales", label: "Продажи" },
  { path: "/finance", label: "Финансы" },
  { path: "/analytics", label: "Аналитика" },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen bg-bg-deep text-text-primary">
      {/* Sidebar */}
      <aside className="w-56 bg-bg-surface border-r border-bg-border flex flex-col">
        <div className="p-4 border-b border-bg-border">
          <h1 className="text-lg font-semibold text-accent">MPFlow</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                pathname.startsWith(item.path)
                  ? "bg-accent-glow text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >
              {item.label}
            </Link>
          ))}
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
