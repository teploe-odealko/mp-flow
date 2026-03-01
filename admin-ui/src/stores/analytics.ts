import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface UeItem {
  sku: string
  product_name: string
  master_card_id: string | null
  operations_count: number
  orders_qty: number
  returns_qty: number
  services_ops: number
  other_ops: number
  revenue: number
  commission: number
  last_mile: number
  pipeline: number
  fulfillment: number
  dropoff: number
  acquiring: number
  return_logistics: number
  return_processing: number
  marketing: number
  installment: number
  other_services: number
  cogs: number
  profit: number
  margin_pct: number
}

export interface UeTotals {
  revenue: number
  commission: number
  last_mile: number
  pipeline: number
  fulfillment: number
  dropoff: number
  acquiring: number
  return_logistics: number
  return_processing: number
  marketing: number
  installment: number
  other_services: number
  cogs: number
  profit: number
  margin_pct: number
}

export interface StockValuation {
  items: Array<{
    sku: string
    product_name: string
    lots: Array<{
      received_at: string | null
      initial_qty: number
      qty: number
      unit_cost: number
      order_number?: string
      order_id?: string
    }>
  }>
}

export interface UeData {
  items: UeItem[]
  totals: UeTotals
  stock_valuation?: StockValuation
}

export interface PnlData {
  income: {
    revenue: number
    returns_revenue: number
    net_income: number
    points_for_discounts: number
    returns_points: number
    partner_programs: number
    returns_partner: number
  }
  ozon_expenses: {
    total: number
    commission: number
    logistics: number
    fbo: number
    acquiring: number
    marketing: number
    returns: number
    other: number
  }
  services_detail: Array<{ name: string; amount: number; group: string }>
  cogs: number
  manual_income: number
  manual_expense: number
  manual_income_detail: Array<{ category: string; amount: number }>
  manual_expense_detail: Array<{ category: string; amount: number }>
  tax_usn: number
  usn_rate: number
  taxable_revenue: number
  net_profit: number
  margin_pct: number
  error?: string
}

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const useAnalyticsStore = defineStore('analytics', () => {
  const ueData = ref<UeData | null>(null)
  const pnlData = ref<PnlData | null>(null)
  const stockValData = ref<StockValuation | null>(null)
  const ueExpanded = ref(false)
  const ueOpsExpanded = ref(false)
  const activeTab = ref<'economy' | 'stock'>('economy')

  // Date range defaults to current month
  const today = new Date()
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
  const ueDateFrom = ref(localDateStr(firstDay))
  const ueDateTo = ref(localDateStr(today))

  async function loadUnitEconomics() {
    const data = await apiRequest<UeData>(
      `/reports/unit-economics?date_from=${ueDateFrom.value}&date_to=${ueDateTo.value}`,
    )
    ueData.value = data
    stockValData.value = data?.stock_valuation || null
  }

  async function syncAndLoadUnitEconomics() {
    try {
      await apiRequest('/ozon/sync/unit-economics', {
        method: 'POST',
        body: {
          date_from: ueDateFrom.value,
          date_to: ueDateTo.value,
          limit: 1000,
          max_pages: 50,
        },
      })
    } catch (_) {
      /* sync best-effort */
    }
    await loadUnitEconomics()
  }

  async function loadPnlOzon() {
    try {
      const data = await apiRequest<PnlData>('/reports/pnl-ozon', {
        method: 'POST',
        body: {
          date_from: ueDateFrom.value,
          date_to: ueDateTo.value,
        },
      })
      pnlData.value = data
    } catch (err: any) {
      pnlData.value = { error: err.message } as PnlData
    }
  }

  function toggleUeExpanded() {
    ueExpanded.value = !ueExpanded.value
  }

  function toggleOpsExpanded() {
    ueOpsExpanded.value = !ueOpsExpanded.value
  }

  async function reloadAnalytics() {
    await Promise.all([loadUnitEconomics(), loadPnlOzon()])
  }

  return {
    ueData,
    pnlData,
    stockValData,
    ueExpanded,
    ueOpsExpanded,
    activeTab,
    ueDateFrom,
    ueDateTo,
    loadUnitEconomics,
    syncAndLoadUnitEconomics,
    loadPnlOzon,
    toggleUeExpanded,
    toggleOpsExpanded,
    reloadAnalytics,
  }
})
