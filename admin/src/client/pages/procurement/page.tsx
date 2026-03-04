import { useState, Fragment } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { apiGet, apiPut, apiPost } from "../../lib/api"
import { useUrlState } from "../../lib/use-url-state"

interface ChannelSales {
  channel: string
  label: string
  qty: number
  daily_rate: number
}

interface StockEntry {
  source: string
  label: string
  qty: number
}

interface InTransitOrder {
  order_id: string
  order_number?: string
  supplier_name?: string
  status: string
  qty: number
}

interface ForecastRow {
  card_id: string
  product_title: string
  thumbnail?: string
  stock_total: number
  stock_breakdown: StockEntry[]
  daily_rate: number
  sold_in_period: number
  sales_by_channel: ChannelSales[]
  in_transit_qty: number
  in_transit_orders: InTransitOrder[]
  required_qty: number
  available_qty: number
  order_qty: number
  stockout_date: string | null
  avg_cost: number
  order_value: number
  planning_horizon: number
}

interface Settings {
  lookback_days: number
  lead_time_days: number
  coverage_days: number
}

interface Totals {
  products: number
  need_order: number
  total_order_qty: number
  total_order_value: number
}

function fmt(n: number | undefined): string {
  if (n == null || n === 0) return "—"
  return Math.round(n).toLocaleString("ru-RU")
}

function fmtDecimal(n: number): string {
  if (n === 0) return "0"
  if (n < 0.1) return n.toFixed(2)
  if (n < 1) return n.toFixed(1)
  return n.toFixed(1)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: "Черновик", color: "text-text-muted" },
  ordered: { label: "Заказан", color: "text-accent" },
  shipped: { label: "В пути", color: "text-risk" },
  received: { label: "Принят", color: "text-inflow" },
}

// Mini-timeline bar showing days of stock coverage
function TimelineBar({ row, settings }: { row: ForecastRow; settings: Settings }) {
  const horizon = settings.lead_time_days + settings.coverage_days
  if (row.daily_rate === 0) {
    return <div className="w-48 h-5 bg-bg-deep rounded text-[10px] text-text-muted flex items-center justify-center">нет продаж</div>
  }

  const stockDays = row.daily_rate > 0 ? row.available_qty / row.daily_rate : 0
  const pct = Math.min(100, (stockDays / horizon) * 100)

  let barColor = "bg-inflow"
  if (stockDays < settings.lead_time_days) barColor = "bg-loss"
  else if (stockDays < horizon) barColor = "bg-risk"

  return (
    <div className="w-48 relative" title={`${Math.round(stockDays)} дн. из ${horizon}`}>
      <div className="h-5 bg-bg-deep rounded overflow-hidden">
        <div className={`h-full ${barColor} rounded-l transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {/* Lead time marker */}
      <div
        className="absolute top-0 h-5 border-l border-dashed border-text-muted"
        style={{ left: `${(settings.lead_time_days / horizon) * 100}%` }}
        title={`Срок поставки: ${settings.lead_time_days} дн.`}
      />
      <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
        <span>{Math.round(stockDays)} дн.</span>
        <span>{horizon} дн.</span>
      </div>
    </div>
  )
}

// Expandable detail card for a row
function DetailCard({ row, settings }: { row: ForecastRow; settings: Settings }) {
  const horizon = settings.lead_time_days + settings.coverage_days

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="bg-bg-deep border-t border-b border-bg-border p-4 space-y-4">
          {/* Sales by channel */}
          {row.sales_by_channel.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-2">Продажи по каналам (за {settings.lookback_days} дн.)</h4>
              <div className="space-y-1.5">
                {row.sales_by_channel.map((ch) => {
                  const maxQty = Math.max(...row.sales_by_channel.map((c) => c.qty))
                  const pct = maxQty > 0 ? (ch.qty / maxQty) * 100 : 0
                  return (
                    <div key={ch.channel} className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary w-20 shrink-0">{ch.label}</span>
                      <div className="flex-1 h-4 bg-bg-surface rounded overflow-hidden">
                        <div className="h-full bg-accent/40 rounded" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono w-16 text-right">{ch.qty} шт.</span>
                      <span className="text-xs text-text-muted w-20 text-right">{fmtDecimal(ch.daily_rate)}/день</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Stock breakdown */}
          {row.stock_breakdown.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-2">Остатки по складам</h4>
              <div className="flex gap-3">
                {row.stock_breakdown.filter((e) => e.qty > 0).map((e) => (
                  <div key={e.source} className="bg-bg-surface border border-bg-border rounded px-3 py-1.5">
                    <span className="text-xs text-text-muted">{e.label}</span>
                    <span className="text-sm font-medium ml-2">{e.qty}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* In-transit orders */}
          {row.in_transit_orders.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-secondary mb-2">Заказы в пути</h4>
              <div className="space-y-1">
                {row.in_transit_orders.map((o, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className={STATUS_MAP[o.status]?.color || "text-text-muted"}>
                      {STATUS_MAP[o.status]?.label || o.status}
                    </span>
                    <span className="text-text-secondary">{o.supplier_name || "—"}</span>
                    {o.order_number && <span className="font-mono text-text-muted">#{o.order_number}</span>}
                    <span className="font-medium">{o.qty} шт.</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formula breakdown */}
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">Расчёт</h4>
            <div className="text-xs space-y-1 font-mono bg-bg-surface border border-bg-border rounded p-3">
              <div>Скорость продаж: <span className="text-accent">{fmtDecimal(row.daily_rate)}</span> шт/день ({row.sold_in_period} за {settings.lookback_days} дн.)</div>
              <div>Горизонт: <span className="text-accent">{settings.lead_time_days}</span> дн. поставка + <span className="text-accent">{settings.coverage_days}</span> дн. запас = <span className="text-accent font-bold">{horizon}</span> дн.</div>
              <div>Потребность: ceil({fmtDecimal(row.daily_rate)} × {horizon}) = <span className="text-accent font-bold">{row.required_qty}</span> шт.</div>
              <div>Доступно: {row.stock_total} склад + {row.in_transit_qty} в пути = <span className="text-accent">{row.available_qty}</span> шт.</div>
              <div className="border-t border-bg-border pt-1 mt-1">
                К заказу: max(0, {row.required_qty} − {row.available_qty}) = <span className={`font-bold ${row.order_qty > 0 ? "text-outflow" : "text-inflow"}`}>{row.order_qty}</span> шт.
              </div>
              {row.stockout_date && (
                <div className="text-risk">
                  Прогноз стокаута: {fmtDate(row.stockout_date)}
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div>
            <h4 className="text-xs font-medium text-text-secondary mb-2">Таймлайн</h4>
            <TimelineDetail row={row} settings={settings} />
          </div>
        </div>
      </td>
    </tr>
  )
}

function TimelineDetail({ row, settings }: { row: ForecastRow; settings: Settings }) {
  const horizon = settings.lead_time_days + settings.coverage_days
  const today = new Date()
  const stockDays = row.daily_rate > 0 ? row.available_qty / row.daily_rate : horizon

  // Markers: today, lead_time arrival, coverage end
  const leadDate = new Date(today.getTime() + settings.lead_time_days * 86400_000)
  const coverageDate = new Date(today.getTime() + horizon * 86400_000)
  const stockoutDays = Math.min(stockDays, horizon)

  return (
    <div className="relative h-12">
      {/* Background bar */}
      <div className="absolute top-2 left-0 right-0 h-6 bg-bg-surface rounded" />

      {/* Stock coverage */}
      <div
        className={`absolute top-2 left-0 h-6 rounded-l ${stockDays >= horizon ? "bg-inflow/30 rounded-r" : stockDays >= settings.lead_time_days ? "bg-risk/30" : "bg-loss/30"}`}
        style={{ width: `${Math.min(100, (stockoutDays / horizon) * 100)}%` }}
      />

      {/* Lead time marker */}
      <div
        className="absolute top-1 h-8 border-l-2 border-dashed border-accent"
        style={{ left: `${(settings.lead_time_days / horizon) * 100}%` }}
      />
      <div
        className="absolute top-10 text-[9px] text-accent -translate-x-1/2"
        style={{ left: `${(settings.lead_time_days / horizon) * 100}%` }}
      >
        поставка
      </div>

      {/* Stockout marker */}
      {row.daily_rate > 0 && stockDays < horizon && (
        <>
          <div
            className="absolute top-1 h-8 border-l-2 border-loss"
            style={{ left: `${(stockDays / horizon) * 100}%` }}
          />
          <div
            className="absolute top-10 text-[9px] text-loss -translate-x-1/2"
            style={{ left: `${(stockDays / horizon) * 100}%` }}
          >
            стокаут
          </div>
        </>
      )}

      {/* Labels */}
      <div className="absolute top-10 left-0 text-[9px] text-text-muted">сегодня</div>
      <div className="absolute top-10 right-0 text-[9px] text-text-muted">{fmtDate(coverageDate.toISOString())}</div>
    </div>
  )
}

function CreateOrderModal({
  items,
  onClose,
  onSubmit,
  isPending,
}: {
  items: ForecastRow[]
  onClose: () => void
  onSubmit: (data: { supplier_name: string; notes: string; items: { card_id: string; order_qty: number }[] }) => void
  isPending: boolean
}) {
  const [supplierName, setSupplierName] = useState("")
  const [notes, setNotes] = useState("")
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(items.map((r) => [r.card_id, r.order_qty])),
  )

  const totalQty = Object.values(quantities).reduce((s, q) => s + q, 0)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-surface border border-bg-border rounded-lg p-5 w-[600px] max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold mb-4">Создать поставку</h3>

        <div className="space-y-3 mb-4">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Поставщик</label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Название поставщика"
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Примечание</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Заметка к заказу"
              className="w-full px-3 py-2 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-text-secondary text-xs block mb-2">Товары ({items.length})</label>
          <div className="max-h-60 overflow-auto space-y-1">
            {items.map((row) => (
              <div key={row.card_id} className="flex items-center gap-2 text-sm">
                <span className="truncate flex-1 text-text-secondary">{row.product_title}</span>
                <input
                  type="number"
                  min={0}
                  value={quantities[row.card_id] || 0}
                  onChange={(e) => setQuantities({ ...quantities, [row.card_id]: Number(e.target.value) })}
                  className="w-20 px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary text-right"
                />
                <span className="text-text-muted text-xs w-6">шт.</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-sm text-text-secondary mb-4">
          Итого: <span className="font-medium text-text-primary">{totalQty} шт.</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() =>
              onSubmit({
                supplier_name: supplierName,
                notes,
                items: Object.entries(quantities)
                  .filter(([, qty]) => qty > 0)
                  .map(([card_id, order_qty]) => ({ card_id, order_qty })),
              })
            }
            disabled={isPending || !supplierName || totalQty <= 0}
            className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent-dark disabled:opacity-50"
          >
            {isPending ? "Создаю..." : "Создать поставку"}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-text-secondary text-sm hover:text-text-primary">
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProcurementPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [showOnlyNeedOrderStr, setShowOnlyNeedOrderStr] = useUrlState("needOrder")
  const showOnlyNeedOrder = showOnlyNeedOrderStr === "1"
  const setShowOnlyNeedOrder = (v: boolean) => setShowOnlyNeedOrderStr(v ? "1" : "")
  const [search, setSearch] = useUrlState("q")

  // Settings state (local overrides)
  const [localSettings, setLocalSettings] = useState<Settings | null>(null)

  const queryParams = new URLSearchParams()
  if (search) queryParams.set("q", search)
  if (localSettings) {
    queryParams.set("lookback_days", String(localSettings.lookback_days))
    queryParams.set("lead_time_days", String(localSettings.lead_time_days))
    queryParams.set("coverage_days", String(localSettings.coverage_days))
  }

  const { data, isLoading } = useQuery({
    queryKey: ["procurement", search, localSettings],
    queryFn: () => apiGet<{ rows: ForecastRow[]; settings: Settings; totals: Totals }>(`/api/procurement?${queryParams.toString()}`),
  })

  const settingsMutation = useMutation({
    mutationFn: (s: Partial<Settings>) => apiPut("/api/procurement/settings", s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["procurement"] }),
  })

  const createOrderMutation = useMutation({
    mutationFn: (d: { supplier_name: string; notes: string; items: { card_id: string; order_qty: number }[] }) =>
      apiPost<{ order_id: string }>("/api/procurement", { action: "create-order", ...d }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["procurement"] })
      setShowCreateOrder(false)
      setSelectedIds(new Set())
      navigate(`/suppliers/${result.order_id}`)
    },
  })

  const rows = data?.rows || []
  const settings = localSettings || data?.settings || { lookback_days: 30, lead_time_days: 45, coverage_days: 30 }
  const totals = data?.totals

  const filteredRows = showOnlyNeedOrder ? rows.filter((r) => r.order_qty > 0) : rows

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function selectAllNeedOrder() {
    const ids = rows.filter((r) => r.order_qty > 0).map((r) => r.card_id)
    setSelectedIds(new Set(ids))
  }

  function updateSetting(key: keyof Settings, value: number) {
    const next = { ...settings, [key]: value }
    setLocalSettings(next)
    settingsMutation.mutate({ [key]: value })
  }

  const selectedRows = rows.filter((r) => selectedIds.has(r.card_id) && r.order_qty > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Закупки</h1>
        {selectedRows.length > 0 && (
          <button
            onClick={() => setShowCreateOrder(true)}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-dark"
          >
            Создать поставку ({selectedRows.length})
          </button>
        )}
      </div>

      {/* Settings bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 bg-bg-surface border border-bg-border rounded-lg p-3">
        <div className="flex items-center gap-2">
          <label className="text-text-secondary text-xs">Период анализа</label>
          <select
            value={settings.lookback_days}
            onChange={(e) => updateSetting("lookback_days", Number(e.target.value))}
            className="px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary"
          >
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
            <option value="60">60 дней</option>
            <option value="90">90 дней</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-text-secondary text-xs">Срок поставки</label>
          <input
            type="number"
            min={1}
            value={settings.lead_time_days}
            onChange={(e) => updateSetting("lead_time_days", Number(e.target.value))}
            className="w-16 px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary text-right"
          />
          <span className="text-text-muted text-xs">дн.</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-text-secondary text-xs">Запас на</label>
          <input
            type="number"
            min={1}
            value={settings.coverage_days}
            onChange={(e) => updateSetting("coverage_days", Number(e.target.value))}
            className="w-16 px-2 py-1 bg-bg-deep border border-bg-border rounded text-sm text-text-primary text-right"
          />
          <span className="text-text-muted text-xs">дн.</span>
        </div>
        <div className="flex-1" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск товара..."
          className="px-3 py-1.5 bg-bg-deep border border-bg-border rounded text-sm text-text-primary w-48"
        />
      </div>

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">Товаров</p>
            <p className="text-2xl font-semibold">{totals.products}</p>
          </div>
          <div className={`bg-bg-surface border rounded-lg p-4 ${totals.need_order > 0 ? "border-outflow" : "border-bg-border"}`}>
            <p className="text-text-secondary text-xs mb-1">Нужен заказ</p>
            <p className={`text-2xl font-semibold ${totals.need_order > 0 ? "text-outflow" : ""}`}>{totals.need_order}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">К заказу, шт.</p>
            <p className="text-2xl font-semibold">{fmt(totals.total_order_qty)}</p>
          </div>
          <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
            <p className="text-text-secondary text-xs mb-1">Сумма заказа</p>
            <p className="text-2xl font-semibold">{fmt(totals.total_order_value)} ₽</p>
          </div>
        </div>
      )}

      {/* Filter toggle */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => setShowOnlyNeedOrder(!showOnlyNeedOrder)}
          className={`text-xs px-3 py-1 rounded-full border ${showOnlyNeedOrder ? "bg-outflow/20 border-outflow text-outflow" : "border-bg-border text-text-muted hover:text-text-secondary"}`}
        >
          Только нужен заказ
        </button>
        <button
          onClick={selectAllNeedOrder}
          className="text-xs px-3 py-1 rounded-full border border-bg-border text-text-muted hover:text-text-secondary"
        >
          Выбрать все для заказа
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : filteredRows.length === 0 ? (
        <p className="text-text-secondary">
          {showOnlyNeedOrder ? "Все товары обеспечены запасами." : "Нет товаров. Синхронизируйте данные."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-border text-text-secondary text-left">
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && filteredRows.every((r) => selectedIds.has(r.card_id))}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(filteredRows.map((r) => r.card_id)))
                    else setSelectedIds(new Set())
                  }}
                  className="accent-accent"
                />
              </th>
              <th className="p-2">Товар</th>
              <th className="p-2 text-right">Остаток</th>
              <th className="p-2 text-right">Продаж/день</th>
              <th className="p-2 text-right">В пути</th>
              <th className="p-2">Обеспеченность</th>
              <th className="p-2 text-right">К заказу</th>
              <th className="p-2 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <Fragment key={r.card_id}>
                <tr
                  onClick={() => setExpandedId(expandedId === r.card_id ? null : r.card_id)}
                  className={`border-b border-bg-border hover:bg-bg-elevated cursor-pointer ${r.order_qty > 0 ? "border-l-2 border-l-outflow" : ""}`}
                >
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.card_id)}
                      onChange={() => toggleSelect(r.card_id)}
                      className="accent-accent"
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      {r.thumbnail && (
                        <img src={r.thumbnail} alt="" className="w-8 h-8 rounded object-cover" />
                      )}
                      <div>
                        <div className="truncate max-w-[200px]">{r.product_title}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-2 text-right">{r.stock_total}</td>
                  <td className="p-2 text-right">
                    {r.daily_rate > 0 ? fmtDecimal(r.daily_rate) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="p-2 text-right">
                    {r.in_transit_qty > 0 ? r.in_transit_qty : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="p-2">
                    <TimelineBar row={r} settings={settings} />
                  </td>
                  <td className="p-2 text-right">
                    {r.order_qty > 0 ? (
                      <span className="text-outflow font-medium">{r.order_qty}</span>
                    ) : (
                      <span className="text-inflow">—</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {r.order_value > 0 ? `${fmt(r.order_value)} ₽` : "—"}
                  </td>
                </tr>
                {expandedId === r.card_id && <DetailCard row={r} settings={settings} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {showCreateOrder && selectedRows.length > 0 && (
        <CreateOrderModal
          items={selectedRows}
          onClose={() => setShowCreateOrder(false)}
          onSubmit={(d) => createOrderMutation.mutate(d)}
          isPending={createOrderMutation.isPending}
        />
      )}
    </div>
  )
}
