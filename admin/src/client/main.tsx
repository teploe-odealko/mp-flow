import React, { Suspense, useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./app/auth-provider"
import { Layout } from "./app/layout"
import { apiGet } from "./lib/api"
import CatalogPage from "./pages/catalog/page"
const CatalogDetailPage = React.lazy(() => import("./pages/catalog/detail-page"))
import SalesPage from "./pages/sales/page"
import WarehousePage from "./pages/warehouse/page"
import FinancePage from "./pages/finance/page"
import AnalyticsPage from "./pages/analytics/page"
import ProcurementPage from "./pages/procurement/page"
import SuppliersPage from "./pages/suppliers/page"
const SupplierDetailPage = React.lazy(() => import("./pages/suppliers/detail-page"))
import PluginsPage from "./pages/plugins/page"
import { Paywall } from "./components/paywall"
import "./styles/globals.css"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// Discover plugin client pages via Vite glob — core knows nothing about specific plugins
const pluginPageModules = import.meta.glob<{ default: React.ComponentType }>(
  "../../plugins/*/src/client/page.tsx",
)

// Build map: directory name → lazy component
const pluginPages: Record<string, React.LazyExoticComponent<React.ComponentType>> = {}
for (const path in pluginPageModules) {
  const match = path.match(/\/plugins\/([^/]+)\/src\/client\/page\.tsx$/)
  if (match) {
    pluginPages[match[1]] = React.lazy(pluginPageModules[path])
  }
}

function SetupScreen() {
  const { setUser } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!email || !password) {
      setError("Заполните email и пароль")
      return
    }
    if (password.length < 6) {
      setError("Пароль должен быть минимум 6 символов")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name: name || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Ошибка создания пользователя")
        return
      }
      setUser(data.user)
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-bg-deep text-text-primary">
      <form onSubmit={handleSubmit} className="w-80">
        <h1 className="text-2xl font-semibold mb-2 text-center">MPFlow</h1>
        <p className="text-text-secondary text-sm mb-6 text-center">Создайте администратора</p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Имя</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Администратор"
              className="w-full px-3 py-2 bg-bg-surface border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 bg-bg-surface border border-bg-border rounded text-sm text-text-primary"
              required
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 6 символов"
              className="w-full px-3 py-2 bg-bg-surface border border-bg-border rounded text-sm text-text-primary"
              required
            />
          </div>
        </div>

        {error && <p className="text-outflow text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Создаю..." : "Создать администратора"}
        </button>
      </form>
    </div>
  )
}

function LoginScreen() {
  const { setUser } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!email || !password) {
      setError("Заполните email и пароль")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Ошибка авторизации")
        return
      }
      setUser(data.user)
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-bg-deep text-text-primary">
      <form onSubmit={handleSubmit} className="w-80">
        <h1 className="text-2xl font-semibold mb-2 text-center">MPFlow</h1>
        <p className="text-text-secondary text-sm mb-6 text-center">Войдите в систему</p>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 bg-bg-surface border border-bg-border rounded text-sm text-text-primary"
              required
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-bg-surface border border-bg-border rounded text-sm text-text-primary"
              required
            />
          </div>
        </div>

        {error && <p className="text-outflow text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? "Вхожу..." : "Войти"}
        </button>
      </form>
    </div>
  )
}

function LogtoRedirect() {
  useEffect(() => {
    window.location.href = "/auth/login"
  }, [])
  return (
    <div className="flex items-center justify-center h-screen bg-bg-deep text-text-secondary">
      Перенаправление...
    </div>
  )
}

function AppRoutes() {
  const { user, loading, authMode, needsSetup, subscription } = useAuth()

  // Fetch enabled plugins to create dynamic routes (deduped with Layout's query)
  const { data: pluginsData } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => apiGet<{ plugins: Array<{ is_enabled: boolean; adminNav?: Array<{ path: string; label: string }> }> }>("/api/plugins"),
    enabled: !!user,
    staleTime: 30_000,
  })

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-bg-deep text-text-secondary">Загрузка...</div>
  }

  if (!user) {
    // Setup wizard: first-time admin creation
    if (needsSetup && authMode === "selfhosted") {
      return <SetupScreen />
    }

    // Selfhosted: email+password login form
    if (authMode === "selfhosted") {
      return <LoginScreen />
    }

    // Logto: redirect immediately, no intermediate screen
    if (authMode === "logto") {
      return <LogtoRedirect />
    }

    // Fallback (loading state or unknown mode)
    return <LoginScreen />
  }

  // Subscription check: show paywall if expired (only in logto/cloud mode)
  if (subscription && !subscription.active) {
    return <Paywall />
  }

  // Build dynamic plugin routes from adminNav + glob-discovered pages
  const dynamicRoutes = pluginsData?.plugins
    ?.filter((p) => p.is_enabled && p.adminNav?.length)
    ?.flatMap((p) => p.adminNav!)
    ?.map((nav) => {
      const dirName = nav.path.replace(/^\//, "")
      const LazyPage = pluginPages[dirName]
      if (!LazyPage) return null
      return (
        <Route
          key={nav.path}
          path={nav.path}
          element={
            <Suspense fallback={<div className="text-text-secondary">Загрузка...</div>}>
              <LazyPage />
            </Suspense>
          }
        />
      )
    })
    ?.filter(Boolean) || []

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/catalog" replace />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:id" element={<Suspense fallback={<div className="text-text-secondary">Загрузка...</div>}><CatalogDetailPage /></Suspense>} />
        <Route path="/warehouse" element={<WarehousePage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/new" element={<Suspense fallback={<div className="text-text-secondary">Загрузка...</div>}><SupplierDetailPage /></Suspense>} />
        <Route path="/suppliers/:id" element={<Suspense fallback={<div className="text-text-secondary">Загрузка...</div>}><SupplierDetailPage /></Suspense>} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/plugins" element={<PluginsPage />} />
        {dynamicRoutes}
        {pluginsData && <Route path="*" element={<Navigate to="/catalog" replace />} />}
      </Routes>
    </Layout>
  )
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
