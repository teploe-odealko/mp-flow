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

  const selectedSale = expandedRow ? sales.find((s: any) => s.id === expandedRow) : null

  return (
    <div className={selectedSale ? "flex h-[calc(100vh-3rem)] -mb-6" : ""}>
      {/* Main content — table */}
      <div className={`min-w-0 transition-all duration-200 ${selectedSale ? "flex-1 overflow-y-auto pr-4" : "w-full"}`}>
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
                    {!selectedSale && <DocTableHeader pageId="sales" columnKey="channel" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Канал</DocTableHeader>}
                    <DocTableHeader pageId="sales" columnKey="status" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Статус</DocTableHeader>
                    {!selectedSale && <DocTableHeader pageId="sales" columnKey="quantity" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</DocTableHeader>}
                    <DocTableHeader pageId="sales" columnKey="price" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Цена</DocTableHeader>
                    <DocTableHeader pageId="sales" columnKey="profit" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Прибыль</DocTableHeader>
                    <DocTableHeader pageId="sales" columnKey="date" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Дата</DocTableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s: any) => {
                    const fees: Array<{ key: string; label: string; amount: number }> = s.fee_details || []
                    const totalFees = fees.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0)
                    const isSelected = expandedRow === s.id

                    return (
                      <tr
                        key={s.id}
                        className={`border-b border-bg-border hover:bg-bg-surface/50 cursor-pointer ${isSelected ? "bg-accent/10 border-l-2 border-l-accent" : ""}`}
                        onClick={() => setExpandedRow(isSelected ? null : s.id)}
                      >
                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={s.product_name || s.channel_sku}>
                          {s.product_name || s.channel_sku || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-text-secondary text-xs font-mono max-w-[120px] truncate" title={s.channel_order_id}>
                          {s.channel_order_id || "—"}
                        </td>
                        {!selectedSale && (
                          <td className="px-2 py-1.5">
                            <span className="text-xs">{s.channel || "—"}</span>
                          </td>
                        )}
                        <td className="px-2 py-1.5">
                          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[s.status] || "bg-bg-elevated text-text-secondary"}`}>
                            {STATUS_LABELS[s.status] || s.status}
                          </span>
                        </td>
                        {!selectedSale && (
                          <td className="px-2 py-1.5 text-right tabular-nums">{s.quantity}</td>
                        )}
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(s.price_per_unit)} ₽</td>
                        {(() => {
                          const hasPayoutData = s.net_payout != null
                          const profit = hasPayoutData
                            ? Number(s.net_payout) - Number(s.total_cogs || 0)
                            : Number(s.revenue || 0) - totalFees - Number(s.total_cogs || 0)
                          const showProfit = hasPayoutData || totalFees > 0
                          return (
                            <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${showProfit ? (profit >= 0 ? "text-inflow" : "text-outflow") : "text-text-muted"}`}>
                              {showProfit ? `${fmt(profit)} ₽` : "—"}
                            </td>
                          )
                        })()}
                        <td className="px-2 py-1.5 text-right text-text-secondary text-xs whitespace-nowrap">{fmtDate(s.sold_at)}</td>
                      </tr>
                    )
                  })}
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

      {/* Right sidebar — sale detail */}
      {selectedSale && (() => {
        const s = selectedSale
        const fees: Array<{ key: string; label: string; amount: number }> = s.fee_details || []
        const totalFees = fees.reduce((sum: number, f: any) => sum + Number(f.amount || 0), 0)
        const profit = s.net_payout != null
          ? Number(s.net_payout) - Number(s.total_cogs || 0)
          : Number(s.revenue || 0) - totalFees - Number(s.total_cogs || 0)

        const cogs = Number(s.total_cogs || 0)
        const hasNetPayout = s.net_payout != null
        const netPayout = hasNetPayout ? Number(s.net_payout) : null
        const margin = Number(s.revenue) > 0 ? (profit / Number(s.revenue) * 100) : 0

        return (
          <div className="w-[380px] shrink-0 border-l border-bg-border bg-bg-surface overflow-y-auto -mr-6 -mb-6 p-4 text-sm">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-base truncate" title={s.product_name || s.channel_sku}>
                  {s.product_name || s.channel_sku || "—"}
                </h2>
                <span className="text-text-muted text-xs font-mono">{s.channel_order_id || "—"}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedRow(null) }}
                className="text-text-muted hover:text-text-primary p-1 -mr-1 -mt-1 shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>

            {/* Status + date + return */}
            <div className="flex items-center gap-2 mb-4">
              <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[s.status] || "bg-bg-elevated text-text-secondary"}`}>
                {STATUS_LABELS[s.status] || s.status}
              </span>
              <span className="text-text-muted text-xs">{fmtDateTime(s.sold_at)}</span>
            </div>

            {/* Info line */}
            <div className="flex items-center gap-4 text-xs text-text-secondary mb-4">
              <span>{s.channel}</span>
              <span className="font-mono">{s.channel_sku || "—"}</span>
              <span>{s.quantity} шт. × {fmt(s.price_per_unit)} ₽</span>
            </div>

            {/* P&L waterfall */}
            <div className="bg-bg-deep rounded-lg overflow-hidden mb-4">
              {/* Revenue */}
              <div className="flex justify-between px-3 py-2 border-b border-bg-border">
                <span className="text-text-secondary text-xs">Выручка</span>
                <span className="tabular-nums font-medium">{fmt(s.revenue)} ₽</span>
              </div>

              {/* Fee breakdown */}
              {fees.filter((f) => Number(f.amount) > 0).map((f, i) => (
                <div key={i} className="flex justify-between px-3 py-1.5 border-b border-bg-border/50">
                  <span className="text-text-muted text-xs">{f.label || f.key}</span>
                  <span className="tabular-nums text-xs text-outflow">-{fmt(f.amount)} ₽</span>
                </div>
              ))}

              {/* Net payout */}
              {hasNetPayout && (
                <div className="flex justify-between px-3 py-2 border-b border-bg-border bg-bg-surface/50">
                  <span className="text-text-secondary text-xs font-medium">Выплата МП</span>
                  <span className={`tabular-nums font-medium ${netPayout! >= 0 ? "" : "text-outflow"}`}>{fmt(netPayout!)} ₽</span>
                </div>
              )}

              {/* COGS */}
              {cogs > 0 && (
                <div className="flex justify-between px-3 py-1.5 border-b border-bg-border/50">
                  <span className="text-text-muted text-xs">Себестоимость</span>
                  <span className="tabular-nums text-xs">-{fmt(cogs)} ₽</span>
                </div>
              )}

              {/* Profit */}
              <div className="flex justify-between px-3 py-2.5 bg-bg-surface/30">
                <span className="font-semibold text-xs">Прибыль</span>
                <div className="text-right">
                  <span className={`tabular-nums font-bold ${(hasNetPayout || totalFees > 0) ? (profit >= 0 ? "text-inflow" : "text-outflow") : "text-text-muted"}`}>
                    {(hasNetPayout || totalFees > 0) ? `${fmt(profit)} ₽` : "—"}
                  </span>
                  {(hasNetPayout || totalFees > 0) && Number(s.revenue) > 0 && (
                    <span className={`text-[10px] ml-1.5 ${margin >= 0 ? "text-inflow" : "text-outflow"}`}>
                      {margin.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Return info */}
            {s.status === "returned" && s.return_reason && (
              <div className="text-xs text-outflow bg-outflow/10 rounded px-3 py-2">
                Возврат: {s.return_reason}
                {s.return_date && <span className="text-text-muted ml-2">({fmtDate(s.return_date)})</span>}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
