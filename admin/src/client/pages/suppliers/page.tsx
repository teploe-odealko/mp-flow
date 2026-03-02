import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { apiGet, apiDelete } from "../../lib/api"
import { STATUS_LABELS, STATUS_COLORS } from "./utils"

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmt(n: number | undefined): string {
  if (n == null || n === 0) return "—"
  return Math.round(n).toLocaleString("ru-RU")
}

const STATUS_TABS = [
  { value: "", label: "Все" },
  { value: "draft", label: "Черновики" },
  { value: "ordered", label: "Заказаны" },
  { value: "shipped", label: "В пути" },
  { value: "received", label: "Приняты" },
]

export default function SuppliersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState("")
  const [search, setSearch] = useState("")

  const queryParams = new URLSearchParams()
  if (statusFilter) queryParams.set("status", statusFilter)
  if (search) queryParams.set("q", search)

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers", statusFilter, search],
    queryFn: () => apiGet<any>(`/api/suppliers?${queryParams.toString()}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/suppliers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  })

  const orders: any[] = data?.supplier_orders || []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Поступления</h1>
        <Link
          to="/suppliers/new"
          className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent-dark"
        >
          Новый документ
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              statusFilter === tab.value
                ? "bg-accent-glow text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по поставщику или номеру..."
          className="w-64 px-3 py-1.5 bg-bg-surface border border-bg-border rounded text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : orders.length === 0 ? (
        <p className="text-text-secondary py-8 text-center">
          Нет документов{statusFilter || search ? " по заданным фильтрам" : ""}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-surface border-b border-bg-border">
              <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Поставщик</th>
              <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Номер</th>
              <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Статус</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Позиций</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Сумма</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: any) => (
              <tr
                key={o.id}
                className="border-b border-bg-border hover:bg-bg-surface/50 cursor-pointer"
                onClick={() => navigate(`/suppliers/${o.id}`)}
              >
                <td className="px-2 py-2">{o.supplier_name || "—"}</td>
                <td className="px-2 py-2 text-text-secondary text-xs font-mono">{o.order_number || "—"}</td>
                <td className="px-2 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[o.status] || ""}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{o.items_count}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(o.calculated_total)} ₽</td>
                <td className="px-2 py-2 text-right text-text-secondary text-xs whitespace-nowrap">
                  {fmtDate(o.ordered_at || o.order_date || o.created_at)}
                </td>
                <td className="px-2 py-2 text-right">
                  {o.status === "draft" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm("Удалить черновик?")) deleteMutation.mutate(o.id)
                      }}
                      className="text-text-muted hover:text-outflow text-xs"
                    >
                      Удалить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
