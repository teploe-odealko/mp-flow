import React, { Suspense } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./app/auth-provider"
import { Layout } from "./app/layout"
import { apiGet } from "./lib/api"
import CatalogPage from "./pages/catalog/page"
import SalesPage from "./pages/sales/page"
import WarehousePage from "./pages/warehouse/page"
import FinancePage from "./pages/finance/page"
import AnalyticsPage from "./pages/analytics/page"
import SuppliersPage from "./pages/suppliers/page"
import PluginsPage from "./pages/plugins/page"
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

function LoginScreen() {
  const { login } = useAuth()
  return (
    <div className="flex items-center justify-center h-screen bg-bg-deep text-text-primary">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-4">MPFlow</h1>
        <p className="text-text-secondary mb-4">Войдите через Logto для доступа</p>
        <button
          onClick={login}
          className="px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-dark"
        >
          Войти
        </button>
      </div>
    </div>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()

  // Fetch enabled plugins to create dynamic routes (deduped with Layout's query)
  const { data: pluginsData, isLoading: pluginsLoading } = useQuery({
    queryKey: ["plugins"],
    queryFn: () => apiGet<{ plugins: Array<{ is_enabled: boolean; adminNav?: Array<{ path: string; label: string }> }> }>("/api/plugins"),
    enabled: !!user,
    staleTime: 30_000,
  })

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-bg-deep text-text-secondary">Загрузка...</div>
  }

  if (!user) {
    return <LoginScreen />
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
        <Route path="/warehouse" element={<WarehousePage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/plugins" element={<PluginsPage />} />
        {dynamicRoutes}
        {!pluginsLoading && <Route path="*" element={<Navigate to="/catalog" replace />} />}
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
