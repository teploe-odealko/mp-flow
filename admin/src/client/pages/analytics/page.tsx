import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { apiGet } from "../../lib/api"
import { DocTableHeader } from "../../components/doc-table-header"

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
  manual_income: number
  manual_income_by_type: Record<string, number>
  manual_expense: number
  manual_expense_by_type: Record<string, number>
  net_profit: number
  net_margin: number
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

const financeTypeLabels: Record<string, string> = {
  fbo_services: "FBO-услуги",
  marketing: "Маркетинг",
  sale_revenue: "Выручка продаж",
  sale_commission: "Комиссия МП",
  sale_logistics: "Логистика МП",
  cogs: "Себестоимость",
  supplier_payment: "Оплата поставщику",
  shipping_cost: "Доставка",
  refund: "Возврат",
  adjustment: "Корректировка",
  other: "Прочее",
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`w-3.5 h-3.5 text-text-muted transition-transform shrink-0 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

function pnlPct(amount: number, totalIncome: number): string {
  if (!totalIncome || !amount) return ""
  return `(${fmtDec((Math.abs(amount) / totalIncome) * 100)}%)`
}

function PnlReport({ data }: { data: PnlData }) {
  const feeEntries = Object.entries(data.fees_by_type).sort((a, b) => b[1].amount - a[1].amount)
  const manualIncomeEntries = Object.entries(data.manual_income_by_type || {}).sort((a, b) => b[1] - a[1])
  const manualExpenseEntries = Object.entries(data.manual_expense_by_type || {}).sort((a, b) => b[1] - a[1])

  const totalIncome = data.revenue + (data.manual_income || 0)
  const totalExpense = data.fees + data.cogs + (data.manual_expense || 0)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Продаж</p>
          <p className="text-2xl font-semibold">{data.total_sales}</p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Доходы</p>
          <p className="text-2xl font-semibold text-inflow">{fmt(totalIncome)} <span className="text-sm">₽</span></p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Расходы</p>
          <p className="text-2xl font-semibold text-outflow">{fmt(totalExpense)} <span className="text-sm">₽</span></p>
        </div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
          <p className="text-text-secondary text-xs mb-1">Чистая прибыль</p>
          <p className={`text-2xl font-semibold ${data.net_profit >= 0 ? "text-inflow" : "text-outflow"}`}>
            {fmt(data.net_profit)} <span className="text-sm">₽</span>
          </p>
          <p className={`text-xs mt-0.5 ${marginColor(data.net_margin)}`}>
            маржа {fmtDec(data.net_margin)}%
          </p>
        </div>
      </div>

      {/* P&L accordion */}
      <div className="bg-bg-surface border border-bg-border rounded-lg overflow-hidden text-sm">
        {/* INCOME */}
        <details open className="group border-b border-bg-border">
          <summary className="flex items-center gap-1.5 cursor-pointer select-none px-4 py-3 bg-inflow/5 hover:bg-inflow/10 transition-colors">
            <ChevronIcon className="group-open:rotate-90" />
            <span className="text-xs font-semibold uppercase tracking-wider text-inflow flex-1">Доходы</span>
            <span className="font-semibold tabular-nums text-inflow">{fmt(totalIncome)} ₽</span>
          </summary>
          <div className="px-4 pb-3 pt-1 space-y-0.5">
            {/* Revenue from sales */}
            <div className="flex justify-between py-1 pl-5">
              <span className="text-text-secondary">Выручка от продаж</span>
              <span className="font-medium tabular-nums">
                {fmt(data.revenue)} ₽
                <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.revenue, totalIncome)}</span>
              </span>
            </div>
            {/* Manual income */}
            {data.manual_income > 0 && (
              manualIncomeEntries.length > 1 ? (
                <details className="group/sub">
                  <summary className="flex items-center gap-1.5 cursor-pointer select-none py-1 pl-5">
                    <ChevronIcon className="w-3 h-3 group-open/sub:rotate-90" />
                    <span className="text-text-secondary flex-1">Прочие доходы</span>
                    <span className="font-medium tabular-nums">
                      {fmt(data.manual_income)} ₽
                      <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.manual_income, totalIncome)}</span>
                    </span>
                  </summary>
                  <div className="pl-10 space-y-0.5 text-xs">
                    {manualIncomeEntries.map(([type, amount]) => (
                      <div key={type} className="flex justify-between py-0.5">
                        <span className="text-text-secondary">{financeTypeLabels[type] || type}</span>
                        <span className="font-medium tabular-nums">{fmt(amount)} ₽</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="flex justify-between py-1 pl-5">
                  <span className="text-text-secondary">
                    Прочие доходы
                    {manualIncomeEntries.length === 1 && ` (${financeTypeLabels[manualIncomeEntries[0][0]] || manualIncomeEntries[0][0]})`}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(data.manual_income)} ₽
                    <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.manual_income, totalIncome)}</span>
                  </span>
                </div>
              )
            )}
          </div>
        </details>

        {/* EXPENSES */}
        <details open className="group border-b border-bg-border">
          <summary className="flex items-center gap-1.5 cursor-pointer select-none px-4 py-3 bg-outflow/5 hover:bg-outflow/10 transition-colors">
            <ChevronIcon className="group-open:rotate-90" />
            <span className="text-xs font-semibold uppercase tracking-wider text-outflow flex-1">Расходы</span>
            <span className="font-semibold tabular-nums text-outflow">-{fmt(totalExpense)} ₽</span>
          </summary>
          <div className="px-4 pb-3 pt-1 space-y-0.5">
            {/* Marketplace fees */}
            {data.fees > 0 && (
              feeEntries.length > 0 ? (
                <details className="group/sub">
                  <summary className="flex items-center gap-1.5 cursor-pointer select-none py-1 pl-5">
                    <ChevronIcon className="w-3 h-3 group-open/sub:rotate-90" />
                    <span className="text-text-secondary flex-1">Расходы маркетплейса</span>
                    <span className="font-medium tabular-nums text-outflow">
                      -{fmt(data.fees)} ₽
                      <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.fees, totalIncome)}</span>
                    </span>
                  </summary>
                  <div className="pl-10 space-y-0.5 text-xs">
                    {feeEntries.map(([key, fee]) => (
                      <div key={key} className="flex justify-between py-0.5">
                        <span className="text-text-secondary">{fee.label}</span>
                        <span className="font-medium tabular-nums">
                          -{fmt(fee.amount)} ₽
                          <span className="text-text-muted ml-1.5">{pnlPct(fee.amount, totalIncome)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="flex justify-between py-1 pl-5">
                  <span className="text-text-secondary">Расходы маркетплейса</span>
                  <span className="font-medium tabular-nums text-outflow">
                    -{fmt(data.fees)} ₽
                    <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.fees, totalIncome)}</span>
                  </span>
                </div>
              )
            )}

            {/* COGS */}
            {data.cogs > 0 && (
              <div className="flex justify-between py-1 pl-5">
                <span className="text-text-secondary">Себестоимость (FIFO)</span>
                <span className="font-medium tabular-nums text-outflow">
                  -{fmt(data.cogs)} ₽
                  <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.cogs, totalIncome)}</span>
                </span>
              </div>
            )}

            {/* Manual expenses */}
            {data.manual_expense > 0 && (
              manualExpenseEntries.length > 1 ? (
                <details className="group/sub2">
                  <summary className="flex items-center gap-1.5 cursor-pointer select-none py-1 pl-5">
                    <ChevronIcon className="w-3 h-3 group-open/sub2:rotate-90" />
                    <span className="text-text-secondary flex-1">Ручные расходы</span>
                    <span className="font-medium tabular-nums text-outflow">
                      -{fmt(data.manual_expense)} ₽
                      <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.manual_expense, totalIncome)}</span>
                    </span>
                  </summary>
                  <div className="pl-10 space-y-0.5 text-xs">
                    {manualExpenseEntries.map(([type, amount]) => (
                      <div key={type} className="flex justify-between py-0.5">
                        <span className="text-text-secondary">{financeTypeLabels[type] || type}</span>
                        <span className="font-medium tabular-nums">-{fmt(amount)} ₽</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="flex justify-between py-1 pl-5">
                  <span className="text-text-secondary">
                    Ручные расходы
                    {manualExpenseEntries.length === 1 && ` (${financeTypeLabels[manualExpenseEntries[0][0]] || manualExpenseEntries[0][0]})`}
                  </span>
                  <span className="font-medium tabular-nums text-outflow">
                    -{fmt(data.manual_expense)} ₽
                    <span className="text-text-muted text-xs ml-1.5">{pnlPct(data.manual_expense, totalIncome)}</span>
                  </span>
                </div>
              )
            )}
          </div>
        </details>

        {/* NET PROFIT */}
        <div className="px-4 py-3 bg-bg-elevated border-b border-bg-border">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Чистая прибыль</span>
            <span className={`font-bold text-lg tabular-nums ${data.net_profit >= 0 ? "text-inflow" : "text-outflow"}`}>
              {fmt(data.net_profit)} ₽
            </span>
          </div>
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-text-muted text-xs">Маржа</span>
            <span className={`text-sm font-semibold ${marginColor(data.net_margin)}`}>{fmtDec(data.net_margin)}%</span>
          </div>
        </div>

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
            <DocTableHeader pageId="analytics-ue" columnKey="product" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</DocTableHeader>
            <DocTableHeader pageId="analytics-ue" columnKey="quantity" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Кол-во</DocTableHeader>
            <DocTableHeader pageId="analytics-ue" columnKey="revenue" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Выручка</DocTableHeader>
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
              <DocTableHeader pageId="analytics-ue" columnKey="mp_fees" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary cursor-pointer select-none hover:text-accent">
                <span onClick={() => setExpandedFees(true)} title="Развернуть расходы">Расх. МП &#9654;</span>
              </DocTableHeader>
            )}
            <DocTableHeader pageId="analytics-ue" columnKey="cogs" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">С/с</DocTableHeader>
            <DocTableHeader pageId="analytics-ue" columnKey="profit" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Прибыль</DocTableHeader>
            <DocTableHeader pageId="analytics-ue" columnKey="margin" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Маржа</DocTableHeader>
            <DocTableHeader pageId="analytics-ue" columnKey="roi" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">ROI</DocTableHeader>
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
              <DocTableHeader pageId="analytics-sv" columnKey="product" className="text-left px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Товар</DocTableHeader>
              <DocTableHeader pageId="analytics-sv" columnKey="quantity" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Остаток</DocTableHeader>
              <DocTableHeader pageId="analytics-sv" columnKey="avg_cost" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Ср. с/с</DocTableHeader>
              <DocTableHeader pageId="analytics-sv" columnKey="total_cost" className="text-right px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Стоимость</DocTableHeader>
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
  const [channel, setChannel] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", tab, dateFrom, dateTo, channel],
    queryFn: () => {
      const params = new URLSearchParams({ report: tab })
      if (tab !== "stock-valuation") { params.set("from", dateFrom); params.set("to", dateTo) }
      if (channel) params.set("channel", channel)
      return apiGet<{ data: any }>(`/api/analytics?${params.toString()}`)
    },
  })

  // Collect available channels from pnl data for the dropdown
  const channels = tab === "pnl" && data?.data
    ? Object.entries((data.data as PnlData).by_channel || {}).map(([key, ch]) => ({ value: key, label: ch.label }))
    : []

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

        {/* Channel filter */}
        {channels.length > 1 && (
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="bg-bg-surface border border-bg-border rounded px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">Все каналы</option>
            {channels.map((ch) => <option key={ch.value} value={ch.value}>{ch.label}</option>)}
          </select>
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
