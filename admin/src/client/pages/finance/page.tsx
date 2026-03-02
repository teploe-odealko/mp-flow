import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api"

const PAGE_SIZE = 50

const now = new Date()
const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
const defaultTo = now.toISOString().slice(0, 10)

const TYPE_OPTIONS = [
  { value: "fbo_services", label: "FBO-услуги" },
  { value: "marketing", label: "Маркетинг" },
  { value: "sale_revenue", label: "Выручка продаж" },
  { value: "sale_commission", label: "Комиссия МП" },
  { value: "sale_logistics", label: "Логистика МП" },
  { value: "cogs", label: "Себестоимость" },
  { value: "supplier_payment", label: "Оплата поставщику" },
  { value: "shipping_cost", label: "Доставка" },
  { value: "refund", label: "Возврат" },
  { value: "adjustment", label: "Корректировка" },
  { value: "other", label: "Прочее" },
] as const

const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]))

const DIRECTION_LABELS: Record<string, string> = { income: "Доход", expense: "Расход" }
const DIRECTION_COLORS: Record<string, string> = {
  income: "bg-inflow/20 text-inflow",
  expense: "bg-outflow/20 text-outflow",
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Ручная",
  ozon_api: "Ozon API",
  ozon_sync: "Ozon Sync",
  system: "Система",
}

function fmt(n: number | undefined): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("ru-RU")
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

interface Transaction {
  id: string
  type: string
  direction: "income" | "expense"
  amount: number
  category?: string | null
  description?: string | null
  transaction_date: string
  source?: string | null
  metadata?: any
  created_at: string
}

interface PnlSummary {
  income: number
  expense: number
  profit: number
  margin: number
  transaction_count: number
}

export default function FinancePage() {
  const queryClient = useQueryClient()

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)
  const [filterType, setFilterType] = useState("")
  const [filterDirection, setFilterDirection] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)

  const offset = page * PAGE_SIZE

  // Summary query
  const queryParams = new URLSearchParams()
  if (dateFrom) queryParams.set("from", dateFrom)
  if (dateTo) queryParams.set("to", dateTo)

  const { data: summary } = useQuery<PnlSummary>({
    queryKey: ["finance-summary", dateFrom, dateTo],
    queryFn: () => apiGet(`/api/finance?${queryParams.toString()}`),
  })

  // Transactions query
  const txParams = new URLSearchParams()
  txParams.set("limit", String(PAGE_SIZE))
  txParams.set("offset", String(offset))
  if (dateFrom) txParams.set("from", dateFrom)
  if (dateTo) txParams.set("to", dateTo)
  if (filterType) txParams.set("type", filterType)
  if (filterDirection) txParams.set("direction", filterDirection)
  if (filterSource) txParams.set("source", filterSource)
  if (search) txParams.set("search", search)

  const { data: txData, isLoading } = useQuery({
    queryKey: ["finance-transactions", dateFrom, dateTo, filterType, filterDirection, filterSource, search, page],
    queryFn: () => apiGet<{ transactions: Transaction[]; total_count: number }>(`/api/finance/transactions?${txParams.toString()}`),
  })

  const transactions = txData?.transactions || []
  const totalCount = txData?.total_count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/finance/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-transactions"] })
      queryClient.invalidateQueries({ queryKey: ["finance-summary"] })
    },
  })

  function handleFilterChange(setter: (v: string) => void) {
    return (value: string) => { setter(value); setPage(0) }
  }

  function resetFilters() {
    setFilterType(""); setFilterDirection(""); setFilterSource(""); setSearch(""); setPage(0)
  }

  const hasFilters = filterType || filterDirection || filterSource || search

  function openCreate() {
    setEditingTx(null)
    setModalOpen(true)
  }

  function openEdit(tx: Transaction) {
    setEditingTx(tx)
    setModalOpen(true)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Финансы</h1>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90"
        >
          + Добавить
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Доходы</p>
          <p className="text-2xl font-semibold text-inflow">{fmt(summary?.income)} ₽</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Расходы</p>
          <p className="text-2xl font-semibold text-outflow">{fmt(summary?.expense)} ₽</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Прибыль</p>
          <p className={`text-2xl font-semibold ${(summary?.profit || 0) >= 0 ? "text-inflow" : "text-loss"}`}>
            {fmt(summary?.profit)} ₽
          </p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs">Транзакций</p>
          <p className="text-2xl font-semibold">{summary?.transaction_count || 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs">с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
            className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
          />
          <span className="text-text-muted text-xs">по</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
            className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
          />
        </div>

        <select
          value={filterType}
          onChange={(e) => handleFilterChange(setFilterType)(e.target.value)}
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">Все типы</option>
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={filterDirection}
          onChange={(e) => handleFilterChange(setFilterDirection)(e.target.value)}
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">Все направления</option>
          <option value="income">Доход</option>
          <option value="expense">Расход</option>
        </select>

        <select
          value={filterSource}
          onChange={(e) => handleFilterChange(setFilterSource)(e.target.value)}
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">Все источники</option>
          <option value="manual">Ручные</option>
          <option value="ozon_api">Ozon API</option>
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
          placeholder="Поиск..."
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary w-40"
        />

        {hasFilters && (
          <button onClick={resetFilters} className="text-text-muted hover:text-text-secondary text-xs underline">
            Сбросить
          </button>
        )}

        <span className="ml-auto text-text-secondary text-sm">{totalCount} записей</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : transactions.length === 0 ? (
        <p className="text-text-secondary py-8 text-center">Нет транзакций{hasFilters ? " по заданным фильтрам" : ""}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-surface border-b border-bg-border">
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Тип</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Направление</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Описание</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Категория</th>
                  <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Сумма</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Источник</th>
                  <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary w-20"></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-bg-border hover:bg-bg-surface/50">
                    <td className="px-2 py-1.5 text-text-secondary text-xs whitespace-nowrap">{fmtDate(tx.transaction_date)}</td>
                    <td className="px-2 py-1.5 text-xs">{TYPE_LABELS[tx.type] || tx.type}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${DIRECTION_COLORS[tx.direction] || ""}`}>
                        {DIRECTION_LABELS[tx.direction] || tx.direction}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 max-w-[200px] truncate text-xs" title={tx.description || ""}>
                      {tx.description || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary text-xs">{tx.category || "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${tx.direction === "income" ? "text-inflow" : "text-outflow"}`}>
                      {tx.direction === "income" ? "+" : "-"}{fmt(tx.amount)} ₽
                    </td>
                    <td className="px-2 py-1.5 text-text-muted text-xs">{SOURCE_LABELS[tx.source || ""] || tx.source || "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => openEdit(tx)}
                          className="text-text-muted hover:text-text-primary p-0.5"
                          title="Редактировать"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Удалить транзакцию?")) deleteMutation.mutate(tx.id)
                          }}
                          className="text-text-muted hover:text-outflow p-0.5"
                          title="Удалить"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v5M10 7v5M4 4l.7 9.1a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-bg-border">
              <span className="text-text-secondary text-sm">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} из {totalCount}
              </span>
              <div className="flex gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed">&#171;</button>
                <button onClick={() => setPage(page - 1)} disabled={page === 0} className="px-3 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed">&#8249; Назад</button>
                <span className="px-3 py-1 text-sm text-text-secondary">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed">Вперёд &#8250;</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed">&#187;</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create/Edit modal */}
      {modalOpen && (
        <TransactionModal
          transaction={editingTx}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false)
            queryClient.invalidateQueries({ queryKey: ["finance-transactions"] })
            queryClient.invalidateQueries({ queryKey: ["finance-summary"] })
          }}
        />
      )}
    </div>
  )
}


interface ModalProps {
  transaction: Transaction | null
  onClose: () => void
  onSaved: () => void
}

function TransactionModal({ transaction, onClose, onSaved }: ModalProps) {
  const isEdit = !!transaction

  const [type, setType] = useState(transaction?.type || "other")
  const [direction, setDirection] = useState<"income" | "expense">(transaction?.direction || "expense")
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "")
  const [description, setDescription] = useState(transaction?.description || "")
  const [category, setCategory] = useState(transaction?.category || "")
  const [txDate, setTxDate] = useState(
    transaction ? new Date(transaction.transaction_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!amount || Number(amount) <= 0) return
    setSaving(true)
    try {
      const body = {
        type,
        direction,
        amount: Number(amount),
        description: description || null,
        category: category || null,
        transaction_date: txDate,
      }
      if (isEdit) {
        await apiPut(`/api/finance/${transaction.id}`, body)
      } else {
        await apiPost("/api/finance", body)
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-6 w-[480px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "Редактировать транзакцию" : "Новая транзакция"}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Direction */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Направление</label>
            <div className="flex gap-2">
              <button
                onClick={() => setDirection("expense")}
                className={`flex-1 py-2 rounded text-sm border ${direction === "expense" ? "bg-outflow/20 border-outflow text-outflow" : "border-bg-border text-text-secondary hover:bg-bg-elevated"}`}
              >
                Расход
              </button>
              <button
                onClick={() => setDirection("income")}
                className={`flex-1 py-2 rounded text-sm border ${direction === "income" ? "bg-inflow/20 border-inflow text-inflow" : "border-bg-border text-text-secondary hover:bg-bg-elevated"}`}
              >
                Доход
              </button>
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Тип</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-bg-deep border border-bg-border rounded px-3 py-2 text-sm text-text-primary"
            >
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Сумма, ₽</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-bg-deep border border-bg-border rounded px-3 py-2 text-sm text-text-primary"
              placeholder="0.00"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Дата</label>
            <input
              type="date"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              className="w-full bg-bg-deep border border-bg-border rounded px-3 py-2 text-sm text-text-primary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Описание</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-deep border border-bg-border rounded px-3 py-2 text-sm text-text-primary"
              placeholder="Описание транзакции"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs text-text-secondary mb-1">Категория</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-bg-deep border border-bg-border rounded px-3 py-2 text-sm text-text-primary"
              placeholder="Категория (необязательно)"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-bg-border text-text-secondary hover:bg-bg-elevated"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !amount || Number(amount) <= 0}
            className="px-4 py-2 text-sm rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  )
}
