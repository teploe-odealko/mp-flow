import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet } from "../../lib/api"
import { DocTableHeader } from "../../components/doc-table-header"

const PAGE_SIZE = 50

const STATUS_LABELS: Record<string, string> = {
  active: "В доставке",
  delivered: "Доставлено",
  returned: "Возврат",
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-accent/20 text-accent",
  delivered: "bg-inflow/20 text-inflow",
  returned: "bg-outflow/20 text-outflow",
}

function fmt(n: number | undefined): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("ru-RU")
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function SalesPage() {
  const [channel, setChannel] = useState("")
  const [status, setStatus] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const offset = page * PAGE_SIZE

  const queryParams = new URLSearchParams()
  queryParams.set("limit", String(PAGE_SIZE))
  queryParams.set("offset", String(offset))
  if (channel) queryParams.set("channel", channel)
  if (status) queryParams.set("status", status)
  if (dateFrom) queryParams.set("from", dateFrom)
  if (dateTo) queryParams.set("to", dateTo)

  const { data, isLoading } = useQuery({
    queryKey: ["sales", channel, status, dateFrom, dateTo, page],
    queryFn: () => apiGet<any>(`/api/sales?${queryParams.toString()}`),
  })

  const sales: any[] = data?.sales || []
  const totalCount: number = data?.total_count || 0
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Collect unique channels from data for the filter dropdown
  const channels = Array.from(new Set(sales.map((s: any) => s.channel).filter(Boolean)))

  function handleFilterChange(setter: (v: string) => void) {
    return (value: string) => { setter(value); setPage(0) }
  }

  function resetFilters() {
    setChannel(""); setStatus(""); setDateFrom(""); setDateTo(""); setPage(0)
  }

  const hasFilters = channel || status || dateFrom || dateTo

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Продажи</h1>
        <span className="text-text-secondary text-sm">{totalCount} записей</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={channel}
          onChange={(e) => handleFilterChange(setChannel)(e.target.value)}
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">Все каналы</option>
          <option value="ozon">Ozon</option>
          <option value="wb">Wildberries</option>
          <option value="manual">Ручные</option>
          <option value="write-off">Списания</option>
          {channels.filter((ch) => !["ozon", "wb", "manual", "write-off"].includes(ch)).map((ch) => (
            <option key={ch} value={ch}>{ch}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => handleFilterChange(setStatus)(e.target.value)}
          className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
        >
          <option value="">Все статусы</option>
          <option value="active">В доставке</option>
          <option value="delivered">Доставлено</option>
          <option value="returned">Возврат</option>
        </select>

        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-xs">с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
            className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
          />
          <span className="text-text-muted text-xs">по</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
            className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
          />
        </div>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="text-text-muted hover:text-text-secondary text-xs underline"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : sales.length === 0 ? (
        <p className="text-text-secondary py-8 text-center">Нет продаж{hasFilters ? " по заданным фильтрам" : ""}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-surface border-b border-bg-border">
                  <DocTableHeader pageId="sales" columnKey="product" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="order_number" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Заказ</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="channel" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Канал</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="status" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Статус</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="quantity" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="price" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Цена</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="revenue" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Выручка</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="expenses" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Расходы</DocTableHeader>
                  <DocTableHeader pageId="sales" columnKey="date" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</DocTableHeader>
                </tr>
              </thead>
              <tbody>
                {sales.map((s: any) => {
                  const fees: Array<{ key: string; label: string; amount: number }> = s.fee_details || []
                  const totalFees = fees.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0)
                  const isExpanded = expandedRow === s.id

                  return (
                    <tr
                      key={s.id}
                      className={`border-b border-bg-border hover:bg-bg-surface/50 cursor-pointer ${isExpanded ? "bg-bg-surface/30" : ""}`}
                      onClick={() => setExpandedRow(isExpanded ? null : s.id)}
                    >
                      <td className="px-2 py-1.5 max-w-[200px] truncate" title={s.product_name || s.channel_sku}>
                        {s.product_name || s.channel_sku || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-text-secondary text-xs font-mono max-w-[120px] truncate" title={s.channel_order_id}>
                        {s.channel_order_id || "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-xs">{s.channel || "—"}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[s.status] || "bg-bg-elevated text-text-secondary"}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.quantity}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(s.price_per_unit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(s.revenue)} ₽</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-outflow">
                        {totalFees > 0 ? `${fmt(totalFees)} ₽` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-text-secondary text-xs whitespace-nowrap">{fmtDate(s.sold_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Expanded row detail */}
          {expandedRow && (() => {
            const s = sales.find((sale: any) => sale.id === expandedRow)
            if (!s) return null
            const fees: Array<{ key: string; label: string; amount: number }> = s.fee_details || []
            const totalFees = fees.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0)
            const profit = Number(s.revenue || 0) - totalFees - Number(s.total_cogs || 0)

            return (
              <div className="bg-bg-surface border border-bg-border rounded-lg p-4 mt-2 mb-4 text-sm">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
                  <div>
                    <span className="text-text-muted text-xs block">Товар</span>
                    <span className="font-medium">{s.product_name || s.channel_sku || "—"}</span>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs block">Заказ</span>
                    <span className="font-mono text-xs">{s.channel_order_id || "—"}</span>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs block">SKU на канале</span>
                    <span className="font-mono text-xs">{s.channel_sku || "—"}</span>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs block">Дата</span>
                    <span>{fmtDateTime(s.sold_at)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                  <div className="bg-bg-deep rounded p-2">
                    <span className="text-text-muted text-xs block">Выручка</span>
                    <span className="font-semibold">{fmt(s.revenue)} ₽</span>
                  </div>
                  <div className="bg-bg-deep rounded p-2">
                    <span className="text-text-muted text-xs block">Расходы МП</span>
                    <span className="font-semibold text-outflow">{totalFees > 0 ? `${fmt(totalFees)} ₽` : "—"}</span>
                  </div>
                  <div className="bg-bg-deep rounded p-2">
                    <span className="text-text-muted text-xs block">Себестоимость</span>
                    <span className="font-semibold">{Number(s.total_cogs) > 0 ? `${fmt(s.total_cogs)} ₽` : "—"}</span>
                  </div>
                  <div className="bg-bg-deep rounded p-2">
                    <span className="text-text-muted text-xs block">Прибыль</span>
                    <span className={`font-semibold ${profit >= 0 ? "text-inflow" : "text-outflow"}`}>{fmt(profit)} ₽</span>
                  </div>
                  <div className="bg-bg-deep rounded p-2">
                    <span className="text-text-muted text-xs block">Маржа</span>
                    <span className={`font-semibold ${profit >= 0 ? "text-inflow" : "text-outflow"}`}>
                      {Number(s.revenue) > 0 ? `${(profit / Number(s.revenue) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>

                {fees.length > 0 && (
                  <div>
                    <span className="text-text-muted text-xs block mb-1">Расходы маркетплейса</span>
                    <div className="space-y-0.5">
                      {fees.filter((f) => Number(f.amount) > 0).map((f, i) => (
                        <div key={i} className="flex justify-between py-0.5">
                          <span className="text-text-secondary">{f.label || f.key}</span>
                          <span className="tabular-nums">{fmt(f.amount)} ₽</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Return info */}
                {s.status === "returned" && s.metadata?.return_info && (
                  <div className="mt-3 pt-3 border-t border-bg-border">
                    <span className="text-text-muted text-xs block mb-1">Возврат</span>
                    <div className="flex flex-wrap gap-4 text-xs">
                      {s.metadata.return_info.reason && (
                        <div>
                          <span className="text-text-muted">Причина: </span>
                          <span className="text-outflow">{s.metadata.return_info.reason}</span>
                        </div>
                      )}
                      {s.metadata.return_info.return_date && (
                        <div>
                          <span className="text-text-muted">Дата возврата: </span>
                          <span>{fmtDate(s.metadata.return_info.return_date)}</span>
                        </div>
                      )}
                      {s.metadata.return_info.quantity > 0 && (
                        <div>
                          <span className="text-text-muted">Кол-во: </span>
                          <span>{s.metadata.return_info.quantity}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Ozon transaction history */}
                {s.metadata?.ozon_transactions?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-bg-border">
                    <span className="text-text-muted text-xs block mb-1">Транзакции Ozon</span>
                    <div className="space-y-1.5">
                      {s.metadata.ozon_transactions.map((tx: any, i: number) => (
                        <div key={tx.operation_id || i} className="flex items-start gap-2 text-xs">
                          <span className="text-text-muted whitespace-nowrap shrink-0">
                            {tx.date ? fmtDate(tx.date) : "—"}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                            tx.type === "returns" ? "bg-outflow/20 text-outflow"
                              : tx.type === "orders" ? "bg-inflow/20 text-inflow"
                              : "bg-bg-elevated text-text-secondary"
                          }`}>
                            {tx.type === "returns" ? "Возврат" : tx.type === "orders" ? "Заказ" : tx.type || "—"}
                          </span>
                          <span className="text-text-secondary truncate" title={tx.operation_type_name}>
                            {tx.operation_type_name || tx.operation_type || "—"}
                          </span>
                          <span className={`ml-auto tabular-nums whitespace-nowrap font-medium ${
                            tx.amount >= 0 ? "text-inflow" : "text-outflow"
                          }`}>
                            {tx.amount >= 0 ? "+" : ""}{fmt(tx.amount)} ₽
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-bg-border">
              <span className="text-text-secondary text-sm">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} из {totalCount}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  className="px-2 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &#171;
                </button>
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                  className="px-3 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &#8249; Назад
                </button>
                <span className="px-3 py-1 text-sm text-text-secondary">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Вперёд &#8250;
                </button>
                <button
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-sm rounded bg-bg-surface border border-bg-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &#187;
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
