import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "./app/auth-provider"
import { Layout } from "./app/layout"
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

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-bg-deep text-text-secondary">Загрузка...</div>
  }

  if (!user) {
    return <LoginScreen />
  }

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
        <Route path="*" element={<Navigate to="/catalog" replace />} />
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
