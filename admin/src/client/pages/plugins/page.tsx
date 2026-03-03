import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet, apiPost } from "../../lib/api"
import { X, Coins, ChevronRight } from "lucide-react"

interface BillableOp {
  name: string
  description: string
  creditCost: number
}

interface PluginBilling {
  operations: BillableOp[]
}

interface PluginInfo {
  name: string
  label: string
  description: string
  is_enabled: boolean
  adminNav: Array<{ path: string; label: string }>
  apiPrefixes: string[]
  billing: PluginBilling | null
}

interface PluginsResponse {
  plugins: PluginInfo[]
  mode: "cloud" | "selfhosted"
}

// ── Plugin Detail Sidebar ──

function PluginDetail({ plugin, onClose }: { plugin: PluginInfo; onClose: () => void }) {
  const ops = plugin.billing?.operations ?? []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sidebar */}
      <div className="relative w-full max-w-md bg-bg-deep border-l border-bg-border overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-bg-deep border-b border-bg-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{plugin.label}</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-secondary rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Plugin ID */}
          <div>
            <p className="text-xs text-text-muted mb-1">ID плагина</p>
            <code className="text-sm text-accent">{plugin.name}</code>
          </div>

          {/* Description */}
          {plugin.description && (
            <div>
              <p className="text-xs text-text-muted mb-1">Описание</p>
              <p className="text-sm text-text-secondary">{plugin.description}</p>
            </div>
          )}

          {/* Status */}
          <div>
            <p className="text-xs text-text-muted mb-1">Статус</p>
            <span
              className={`inline-flex items-center text-sm px-2.5 py-1 rounded ${
                plugin.is_enabled
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {plugin.is_enabled ? "Включён" : "Отключён"}
            </span>
          </div>

          {/* API endpoints */}
          {plugin.apiPrefixes.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-2">API эндпоинты</p>
              <div className="space-y-1">
                {plugin.apiPrefixes.map((prefix) => (
                  <code key={prefix} className="block text-xs text-text-secondary bg-bg-surface px-2 py-1 rounded">
                    {prefix}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Navigation */}
          {plugin.adminNav.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-2">Страницы</p>
              <div className="space-y-1">
                {plugin.adminNav.map((nav) => (
                  <div key={nav.path} className="text-sm text-text-secondary">
                    {nav.label} <span className="text-text-muted text-xs">({nav.path})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Billing / Tariffs */}
          {ops.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Coins size={16} className="text-accent" />
                <p className="text-sm font-medium text-text-primary">Тарифы</p>
              </div>
              <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-bg-border text-text-muted text-left">
                      <th className="px-3 py-2 font-medium">Операция</th>
                      <th className="px-3 py-2 font-medium text-right">Токенов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.map((op) => (
                      <tr key={op.name} className="border-b border-bg-border last:border-0">
                        <td className="px-3 py-2">
                          <span className="text-text-primary">{op.description}</span>
                          <span className="block text-[10px] text-text-muted mt-0.5">{op.name}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-accent">{op.creditCost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-text-muted mt-2">
                Токены списываются только в облачной версии. В self-hosted используются ваши API ключи.
              </p>
            </div>
          )}

          {ops.length === 0 && (
            <div className="text-sm text-text-muted bg-bg-surface border border-bg-border rounded-lg px-3 py-2">
              Бесплатный плагин — токены не расходуются.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Plugins Page ──

export default function PluginsPage() {
  const queryClient = useQueryClient()
  const [installPkg, setInstallPkg] = useState("")
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null)

  const { data, isLoading } = useQuery<PluginsResponse>({
    queryKey: ["plugins"],
    queryFn: () => apiGet("/api/plugins"),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ name, is_enabled }: { name: string; is_enabled: boolean }) =>
      apiPost(`/api/plugins/${name}/toggle`, { is_enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plugins"] }),
  })

  const installMutation = useMutation({
    mutationFn: (pkg: string) => apiPost("/api/plugins/install", { package: pkg }),
    onSuccess: () => {
      setInstallPkg("")
      queryClient.invalidateQueries({ queryKey: ["plugins"] })
    },
  })

  if (isLoading) {
    return <p className="text-text-secondary">Загрузка...</p>
  }

  const plugins = data?.plugins || []
  const isSelfHosted = data?.mode !== "cloud"

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Плагины</h1>

      {plugins.length === 0 ? (
        <p className="text-text-secondary">Нет установленных плагинов</p>
      ) : (
        <div className="space-y-3 mb-8">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className="flex items-center justify-between bg-bg-surface border border-bg-border rounded-lg p-4 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
              onClick={() => setSelectedPlugin(plugin)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{plugin.label}</h3>
                  {plugin.billing?.operations?.length ? (
                    <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                      {plugin.billing.operations.length} платн. операц.
                    </span>
                  ) : (
                    <span className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
                      бесплатный
                    </span>
                  )}
                </div>
                {plugin.description && (
                  <p className="text-sm text-text-secondary mt-0.5">{plugin.description}</p>
                )}
                <p className="text-xs text-text-muted mt-1">{plugin.name}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    plugin.is_enabled
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {plugin.is_enabled ? "Включён" : "Отключён"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleMutation.mutate({
                      name: plugin.name,
                      is_enabled: !plugin.is_enabled,
                    })
                  }}
                  disabled={toggleMutation.isPending}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    plugin.is_enabled ? "bg-accent" : "bg-bg-elevated"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      plugin.is_enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <ChevronRight size={16} className="text-text-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isSelfHosted && (
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <h2 className="font-medium mb-3">Установить плагин</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={installPkg}
              onChange={(e) => setInstallPkg(e.target.value)}
              placeholder="npm-пакет, напр. mpflow-plugin-wb"
              className="flex-1 px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary placeholder-text-muted"
            />
            <button
              onClick={() => installPkg.trim() && installMutation.mutate(installPkg.trim())}
              disabled={!installPkg.trim() || installMutation.isPending}
              className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
            >
              {installMutation.isPending ? "Установка..." : "Установить"}
            </button>
          </div>
          {installMutation.isSuccess && (
            <p className="text-sm text-green-400 mt-2">
              Плагин установлен. Перезапустите сервер: <code className="bg-bg-deep px-1 rounded">docker compose restart admin</code>
            </p>
          )}
          {installMutation.isError && (
            <p className="text-sm text-red-400 mt-2">
              Ошибка: {(installMutation.error as Error).message}
            </p>
          )}
        </div>
      )}

      {/* Detail Sidebar */}
      {selectedPlugin && (
        <PluginDetail
          plugin={selectedPlugin}
          onClose={() => setSelectedPlugin(null)}
        />
      )}
    </div>
  )
}
