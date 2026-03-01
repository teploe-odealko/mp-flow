import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet } from "../../lib/api"

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
const today = now.toISOString().slice(0, 10)

type Tab = "pnl" | "unit-economics" | "stock-valuation"

interface FeeEntry { label: string; amount: number }

interface PnlData {
  revenue: number
  cogs: number
  gross_profit: number
  fees: number
  fees_by_type: Record<string, FeeEntry>
  operating_profit: number
  margin: number
  by_channel: Record<string, { label: string; revenue: number; fees: number; cogs: number; profit: number; count: number }>
  total_sales: number
}

interface UeItem {
  master_card_id: string
  product_name: string
  channel_sku: string
  quantity: number
  revenue: number
  fees_by_type: Record<string, FeeEntry>
  total_fees: number
  cogs: number
  profit: number
  margin: number
  roi: number
}

interface UeData {
  items: UeItem[]
  totals: {
    quantity: number; revenue: number; total_fees: number; cogs: number
    profit: number; margin: number; roi: number
    fees_by_type: Record<string, FeeEntry>
  }
}

interface StockItem {
  master_card_id: string; title: string; quantity: number; total_cost: number; avg_cost: number
}

interface StockData {
  items: StockItem[]
  total_value: number; total_quantity: number; unique_products: number
}

function fmt(n: number | undefined): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("ru-RU")
}

function fmtDec(n: number | undefined): string {
  if (n == null) return "—"
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function marginColor(pct: number): string {
  if (pct > 20) return "text-inflow"
  if (pct >= 0) return "text-yellow-500"
  return "text-outflow"
}

function PnlReport({ data }: { data: PnlData }) {
  const [showFees, setShowFees] = useState(true)
  const [showChannels, setShowChannels] = useState(false)

  const feeEntries = Object.entries(data.fees_by_type).sort((a, b) => b[1].amount - a[1].amount)
  const channelEntries = Object.entries(data.by_channel).sort((a, b) => b[1].revenue - a[1].revenue)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Продаж</p>
          <p className="text-2xl font-semibold">{data.total_sales}</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Выручка</p>
          <p className="text-2xl font-semibold">{fmt(data.revenue)} <span className="text-sm text-text-secondary">₽</span></p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Расходы МП</p>
          <p className="text-2xl font-semibold text-outflow">{fmt(data.fees)} <span className="text-sm">₽</span></p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Себестоимость</p>
          <p className="text-2xl font-semibold">{fmt(data.cogs)} <span className="text-sm text-text-secondary">₽</span></p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Операционная прибыль</p>
          <p className={`text-2xl font-semibold ${data.operating_profit >= 0 ? "text-inflow" : "text-outflow"}`}>
            {fmt(data.operating_profit)} <span className="text-sm">₽</span>
          </p>
          <p className={`text-xs mt-0.5 ${marginColor(data.margin)}`}>маржа {fmtDec(data.margin)}%</p>
        </div>
      </div>

      {/* P&L breakdown */}
      <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden">
        {/* Income */}
        <div className="px-4 py-3 border-b border-bg-border">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-inflow">Доходы</span>
            <span className="font-semibold text-inflow">{fmt(data.revenue)} ₽</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="px-4 py-3 border-b border-bg-border">
          <button
            onClick={() => setShowFees(!showFees)}
            className="w-full flex justify-between items-center cursor-pointer"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-outflow flex items-center gap-1">
              <span className={`text-[10px] transition-transform ${showFees ? "rotate-90" : ""}`}>&#9654;</span>
              Расходы маркетплейса
            </span>
            <span className="font-semibold text-outflow">-{fmt(data.fees)} ₽</span>
          </button>
          {showFees && feeEntries.length > 0 && (
            <div className="mt-2 pl-4 space-y-1">
              {feeEntries.map(([key, fee]) => (
                <div key={key} className="flex justify-between text-sm py-0.5">
                  <span className="text-text-secondary">{fee.label}</span>
                  <span className="tabular-nums">
                    -{fmt(fee.amount)} ₽
                    <span className="text-text-muted text-xs ml-1.5">
                      ({data.revenue > 0 ? fmtDec((fee.amount / data.revenue) * 100) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COGS */}
        <div className="px-4 py-3 border-b border-bg-border">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Себестоимость</span>
            <span className="font-semibold">
              -{fmt(data.cogs)} ₽
              {data.revenue > 0 && (
                <span className="text-text-muted text-xs ml-1.5">({fmtDec((data.cogs / data.revenue) * 100)}%)</span>
              )}
            </span>
          </div>
        </div>

        {/* Operating Profit */}
        <div className="px-4 py-3 border-b border-bg-border bg-bg-elevated">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Операционная прибыль</span>
            <span className={`font-bold text-lg ${data.operating_profit >= 0 ? "text-inflow" : "text-outflow"}`}>
              {fmt(data.operating_profit)} ₽
            </span>
          </div>
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-text-muted text-xs">Маржа</span>
            <span className={`text-sm font-semibold ${marginColor(data.margin)}`}>{fmtDec(data.margin)}%</span>
          </div>
        </div>

        {/* By channel */}
        {channelEntries.length > 0 && (
          <div className="px-4 py-3">
            <button
              onClick={() => setShowChannels(!showChannels)}
              className="w-full flex justify-between items-center cursor-pointer"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1">
                <span className={`text-[10px] transition-transform ${showChannels ? "rotate-90" : ""}`}>&#9654;</span>
                По каналам
              </span>
            </button>
            {showChannels && (
              <div className="mt-2 space-y-2">
                {channelEntries.map(([key, ch]) => (
                  <div key={key} className="flex items-center justify-between text-sm py-1 border-b border-bg-border last:border-0">
                    <div>
                      <span className="font-medium">{ch.label}</span>
                      <span className="text-text-muted text-xs ml-2">{ch.count} продаж</span>
                    </div>
                    <div className="text-right">
                      <span className="tabular-nums">{fmt(ch.revenue)} ₽</span>
                      <span className={`ml-3 font-medium tabular-nums ${ch.profit >= 0 ? "text-inflow" : "text-outflow"}`}>
                        {fmt(ch.profit)} ₽
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function UnitEconomicsReport({ data }: { data: UeData }) {
  const [expandedFees, setExpandedFees] = useState(false)
  const { items, totals } = data

  // Collect all fee keys across items for expanded view
  const allFeeKeys: Record<string, string> = {}
  for (const item of items) {
    for (const [key, fee] of Object.entries(item.fees_by_type)) {
      if (!allFeeKeys[key]) allFeeKeys[key] = fee.label
    }
  }
  const feeKeys = Object.entries(allFeeKeys).sort((a, b) => {
    const aTotal = totals.fees_by_type[a[0]]?.amount || 0
    const bTotal = totals.fees_by_type[b[0]]?.amount || 0
    return bTotal - aTotal
  })

  if (items.length === 0) {
    return <p className="text-text-secondary py-8 text-center">Нет данных за выбранный период</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg-surface border-b border-bg-border">
            <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</th>
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</th>
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Выручка</th>
            {expandedFees ? (
              <>
                {feeKeys.map(([key, label]) => (
                  <th key={key} className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary whitespace-nowrap">
                    {label.length > 12 ? label.slice(0, 10) + ".." : label}
                  </th>
                ))}
                <th
                  className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-accent cursor-pointer select-none"
                  onClick={() => setExpandedFees(false)}
                  title="Свернуть"
                >&#9664;</th>
              </>
            ) : (
              <th
                className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer select-none hover:text-accent"
                onClick={() => setExpandedFees(true)}
                title="Развернуть расходы"
              >Расх. МП &#9654;</th>
            )}
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">С/с</th>
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Прибыль</th>
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Маржа</th>
            <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">ROI</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.master_card_id || item.channel_sku} className="border-b border-bg-border hover:bg-bg-surface/50">
              <td className="px-2 py-1.5 max-w-[200px] truncate" title={item.product_name || item.channel_sku}>
                {item.product_name || item.channel_sku || "—"}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(item.revenue)}</td>
              {expandedFees ? (
                <>
                  {feeKeys.map(([key]) => (
                    <td key={key} className="px-2 py-1.5 text-right tabular-nums text-text-secondary">
                      {item.fees_by_type[key] ? fmt(item.fees_by_type[key].amount) : "—"}
                    </td>
                  ))}
                  <td></td>
                </>
              ) : (
                <td className="px-2 py-1.5 text-right tabular-nums text-outflow">{fmt(item.total_fees)}</td>
              )}
              <td className="px-2 py-1.5 text-right tabular-nums">{item.cogs > 0 ? fmt(item.cogs) : "—"}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${item.profit >= 0 ? "text-inflow" : "text-outflow"}`}>
                {fmt(item.profit)}
              </td>
              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${marginColor(item.margin)}`}>
                {fmtDec(item.margin)}%
              </td>
              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${marginColor(item.roi)}`}>
                {item.roi !== 0 ? `${fmtDec(item.roi)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-text-muted font-semibold bg-bg-surface">
            <td className="px-2 py-2">ИТОГО</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.quantity}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmt(totals.revenue)}</td>
            {expandedFees ? (
              <>
                {feeKeys.map(([key]) => (
                  <td key={key} className="px-2 py-2 text-right tabular-nums">
                    {totals.fees_by_type[key] ? fmt(totals.fees_by_type[key].amount) : "—"}
                  </td>
                ))}
                <td></td>
              </>
            ) : (
              <td className="px-2 py-2 text-right tabular-nums text-outflow">{fmt(totals.total_fees)}</td>
            )}
            <td className="px-2 py-2 text-right tabular-nums">{totals.cogs > 0 ? fmt(totals.cogs) : "—"}</td>
            <td className={`px-2 py-2 text-right tabular-nums ${totals.profit >= 0 ? "text-inflow" : "text-outflow"}`}>
              {fmt(totals.profit)}
            </td>
            <td className={`px-2 py-2 text-right tabular-nums ${marginColor(totals.margin)}`}>{fmtDec(totals.margin)}%</td>
            <td className={`px-2 py-2 text-right tabular-nums ${marginColor(totals.roi)}`}>
              {totals.roi !== 0 ? `${fmtDec(totals.roi)}%` : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function StockValuationReport({ data }: { data: StockData }) {
  if (data.items.length === 0) {
    return <p className="text-text-secondary py-8 text-center">Нет товаров на складе</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Товаров</p>
          <p className="text-2xl font-semibold">{data.unique_products}</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Единиц на складе</p>
          <p className="text-2xl font-semibold">{data.total_quantity}</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Стоимость запасов</p>
          <p className="text-2xl font-semibold">{fmt(data.total_value)} <span className="text-sm text-text-secondary">₽</span></p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-surface border-b border-bg-border">
              <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Остаток</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Ср. с/с</th>
              <th className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Стоимость</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.master_card_id} className="border-b border-bg-border hover:bg-bg-surface/50">
                <td className="px-2 py-1.5">{item.title || "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(item.avg_cost)} ₽</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(item.total_cost)} ₽</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-text-muted font-semibold bg-bg-surface">
              <td className="px-2 py-2">ИТОГО</td>
              <td className="px-2 py-2 text-right tabular-nums">{data.total_quantity}</td>
              <td className="px-2 py-2"></td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(data.total_value)} ₽</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("pnl")
  const [dateFrom, setDateFrom] = useState(thisMonth)
  const [dateTo, setDateTo] = useState(today)

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", tab, dateFrom, dateTo],
    queryFn: () => {
      const params = tab === "stock-valuation"
        ? `report=${tab}`
        : `report=${tab}&from=${dateFrom}&to=${dateTo}`
      return apiGet<{ data: any }>(`/api/analytics?${params}`)
    },
  })

  const tabs: { key: Tab; label: string }[] = [
    { key: "pnl", label: "P&L" },
    { key: "unit-economics", label: "Unit Economics" },
    { key: "stock-valuation", label: "Стоимость остатков" },
  ]

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Аналитика</h1>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Tab switcher */}
        <div className="flex rounded-lg border border-bg-border overflow-hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-accent text-white"
                  : "bg-bg-surface text-text-secondary hover:text-text-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        {tab !== "stock-valuation" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-muted text-xs">с</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
            />
            <span className="text-text-muted text-xs">по</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-bg-surface border border-bg-border rounded px-2 py-1 text-sm text-text-primary"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <p className="text-text-secondary">Загрузка...</p>
      ) : !data?.data ? (
        <p className="text-text-secondary">Нет данных</p>
      ) : (
        <>
          {tab === "pnl" && <PnlReport data={data.data as PnlData} />}
          {tab === "unit-economics" && <UnitEconomicsReport data={data.data as UeData} />}
          {tab === "stock-valuation" && <StockValuationReport data={data.data as StockData} />}
        </>
      )}
    </div>
  )
}
