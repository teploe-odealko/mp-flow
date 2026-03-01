import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet, apiPost } from "../../lib/api"

interface PluginInfo {
  name: string
  label: string
  description: string
  is_enabled: boolean
  adminNav: Array<{ path: string; label: string }>
  apiPrefixes: string[]
}

interface PluginsResponse {
  plugins: PluginInfo[]
  mode: "cloud" | "selfhosted"
}

export default function PluginsPage() {
  const queryClient = useQueryClient()
  const [installPkg, setInstallPkg] = useState("")

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
              className="flex items-center justify-between bg-bg-surface border border-bg-border rounded-lg p-4"
            >
              <div>
                <h3 className="font-medium">{plugin.label}</h3>
                {plugin.description && (
                  <p className="text-sm text-text-secondary mt-0.5">{plugin.description}</p>
                )}
                <p className="text-xs text-text-muted mt-1">{plugin.name}</p>
              </div>
              <div className="flex items-center gap-3">
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
                  onClick={() =>
                    toggleMutation.mutate({
                      name: plugin.name,
                      is_enabled: !plugin.is_enabled,
                    })
                  }
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
    </div>
  )
}
