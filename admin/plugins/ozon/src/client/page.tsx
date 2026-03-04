import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost, apiDelete, apiPut } from "@client/lib/api"

const SYNC_FIELD_LABELS: Record<string, string> = {
  title: "Название",
  thumbnail: "Фото",
  weight_g: "Вес",
  length_mm: "Длина",
  width_mm: "Ширина",
  height_mm: "Высота",
}
const ALL_SYNC_FIELDS = Object.keys(SYNC_FIELD_LABELS)

interface OzonAccount {
  id: string
  name: string
  client_id: string
  is_active: boolean
  auto_sync: boolean
  last_sync_at: string | null
  last_error: string | null
  total_products: number
  total_stocks: number
  metadata?: { sync_fields?: string[] }
}

export default function OzonPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: "", client_id: "", api_key: "" })
  const [verified, setVerified] = useState<{ ok: boolean; seller_name?: string; error?: string } | null>(null)
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null)

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ["ozon-accounts"],
    queryFn: () => apiGet<{ accounts: OzonAccount[] }>("/api/ozon-accounts"),
  })

  const { data: syncData } = useQuery({
    queryKey: ["ozon-sync"],
    queryFn: () => apiGet<{ stats: Record<string, number>; accounts: any[] }>("/api/ozon-sync"),
  })

  const verifyMutation = useMutation({
    mutationFn: (data: { client_id: string; api_key: string }) =>
      apiPost<{ ok: boolean; seller_name?: string; error?: string }>("/api/ozon-accounts/verify", data),
    onSuccess: (result) => setVerified(result),
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; client_id: string; api_key: string }) =>
      apiPost("/api/ozon-accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
      setShowForm(false)
      setForm({ name: "", client_id: "", api_key: "" })
      setVerified(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/ozon-accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
    },
  })

  const syncMutation = useMutation({
    mutationFn: () => apiPost("/api/ozon-sync", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-sync"] })
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
    },
  })

  const updateSyncFieldsMutation = useMutation({
    mutationFn: ({ id, sync_fields }: { id: string; sync_fields: string[] }) =>
      apiPut(`/api/ozon-accounts/${id}`, { metadata: { sync_fields } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ozon-accounts"] })
    },
  })

  const accounts = accountsData?.accounts || []
  const stats = syncData?.stats

  function handleVerify() {
    setVerified(null)
    verifyMutation.mutate({ client_id: form.client_id, api_key: form.api_key })
  }

  function handleCreate() {
    createMutation.mutate(form)
  }

  function handleSync() {
    syncMutation.mutate()
  }

  function formatDate(d: string | null) {
    if (!d) return "\u2014"
    return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  }

  function getSyncFields(acc: OzonAccount): string[] {
    return acc.metadata?.sync_fields ?? [...ALL_SYNC_FIELDS]
  }

  function toggleSyncField(acc: OzonAccount, field: string) {
    const current = getSyncFields(acc)
    const next = current.includes(field) ? current.filter((f) => f !== field) : [...current, field]
    updateSyncFieldsMutation.mutate({ id: acc.id, sync_fields: next })
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Ozon</h1>

      {/* Accounts section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">Подключённые аккаунты</h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark"
            >
              Добавить аккаунт
            </button>
          )}
        </div>

        {showForm && (
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <input
                placeholder="Название (напр. Основной)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
              />
              <input
                placeholder="Client ID"
                value={form.client_id}
                onChange={(e) => { setForm({ ...form, client_id: e.target.value }); setVerified(null) }}
                className="px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
              />
              <input
                placeholder="API Key"
                type="password"
                value={form.api_key}
                onChange={(e) => { setForm({ ...form, api_key: e.target.value }); setVerified(null) }}
                className="px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
              />
            </div>

            {verified && (
              <div className={`text-sm mb-3 ${verified.ok ? "text-inflow" : "text-outflow"}`}>
                {verified.ok ? `Подключение успешно: ${verified.seller_name}` : `Ошибка: ${verified.error}`}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleVerify}
                disabled={!form.client_id || !form.api_key || verifyMutation.isPending}
                className="px-3 py-1.5 bg-bg-elevated border border-bg-border rounded text-sm hover:bg-bg-surface disabled:opacity-50"
              >
                {verifyMutation.isPending ? "Проверяю..." : "Проверить"}
              </button>
              <button
                onClick={handleCreate}
                disabled={!verified?.ok || !form.name || createMutation.isPending}
                className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
              >
                {createMutation.isPending ? "Сохраняю..." : "Сохранить"}
              </button>
              <button
                onClick={() => { setShowForm(false); setVerified(null); setForm({ name: "", client_id: "", api_key: "" }) }}
                className="px-3 py-1.5 text-text-secondary text-sm hover:text-text-primary"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-text-secondary">Загрузка...</p>
        ) : accounts.length === 0 ? (
          <p className="text-text-secondary">Нет подключённых аккаунтов</p>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => {
              const syncFields = getSyncFields(acc)
              const isExpanded = expandedSettings === acc.id
              return (
                <div key={acc.id} className="border border-bg-border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-3 p-3 bg-bg-surface">
                    <div className="flex-1 grid grid-cols-5 gap-2 text-sm items-center">
                      <span className="font-medium">{acc.name}</span>
                      <span className="text-text-secondary font-mono text-xs">{acc.client_id}</span>
                      <span>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          acc.is_active ? "bg-inflow/20 text-inflow" : "bg-text-muted/20 text-text-muted"
                        }`}>
                          {acc.is_active ? "Активен" : "Отключён"}
                        </span>
                      </span>
                      <span className="text-text-secondary text-xs">{acc.total_products || 0} товаров · {formatDate(acc.last_sync_at)}</span>
                      <span className="text-outflow text-xs truncate">{acc.last_error || ""}</span>
                    </div>
                    <button
                      onClick={() => setExpandedSettings(isExpanded ? null : acc.id)}
                      className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 border border-bg-border rounded"
                    >
                      Настройки
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(acc.id)}
                      className="text-text-muted hover:text-outflow text-xs"
                    >
                      Удалить
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="p-3 border-t border-bg-border bg-bg-deep">
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                        Поля для синхронизации из Ozon в мастер-карточку
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {ALL_SYNC_FIELDS.map((field) => (
                          <label key={field} className="flex items-center gap-1.5 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={syncFields.includes(field)}
                              onChange={() => toggleSyncField(acc, field)}
                              className="accent-accent"
                            />
                            {SYNC_FIELD_LABELS[field]}
                          </label>
                        ))}
                      </div>
                      {updateSyncFieldsMutation.isPending && (
                        <p className="text-text-muted text-xs mt-2">Сохраняю...</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sync section */}
      {accounts.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3">Синхронизация</h2>

          {stats && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-bg-surface border border-bg-border rounded-lg p-3">
                <div className="text-text-secondary text-xs mb-1">Товаров</div>
                <div className="text-lg font-semibold">{stats.total_linked_products ?? 0}</div>
              </div>
              <div className="bg-bg-surface border border-bg-border rounded-lg p-3">
                <div className="text-text-secondary text-xs mb-1">Остатков</div>
                <div className="text-lg font-semibold">{stats.total_stock_snapshots ?? 0}</div>
              </div>
              <div className="bg-bg-surface border border-bg-border rounded-lg p-3">
                <div className="text-text-secondary text-xs mb-1">Продаж</div>
                <div className="text-lg font-semibold">{stats.total_sales ?? 0}</div>
              </div>
              <div className="bg-bg-surface border border-bg-border rounded-lg p-3">
                <div className="text-text-secondary text-xs mb-1">Аккаунтов активных</div>
                <div className="text-lg font-semibold">{stats.active_accounts ?? 0}</div>
              </div>
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {syncMutation.isPending ? "Синхронизирую..." : "Синхронизировать"}
          </button>

          {syncMutation.isError && (
            <p className="text-outflow text-sm mt-2">Ошибка: {(syncMutation.error as Error).message}</p>
          )}
          {syncMutation.isSuccess && (
            <p className="text-inflow text-sm mt-2">Синхронизация завершена</p>
          )}
        </div>
      )}
    </div>
  )
}
