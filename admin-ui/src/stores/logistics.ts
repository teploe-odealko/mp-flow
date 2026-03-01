import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiRequest } from '@/composables/useApi'

export interface MatrixRow {
  master_card_id: string
  sku: string
  title: string
  ordered_qty: number
  received_qty: number
  warehouse_stock: number
  shipped_to_ozon: number
  ozon_stock: number
  delivering_qty: number
  purchased_qty: number
  returns_in_transit: number
}

export interface SupplyItem {
  offer_id: string
  product_name: string
  card_sku: string | null
  planned: number
  accepted: number
  rejected: number
}

export interface Supply {
  id: string
  supply_order_id: string
  supply_number: string
  warehouse_name: string
  status: string
  has_discrepancy: boolean
  total_planned: number
  total_accepted: number
  total_rejected: number
  created_at: string | null
  items: SupplyItem[]
}

export interface SkuDetail {
  card: { sku: string; title: string } | null
  supplier_orders: Array<{
    order_number: string
    order_date: string
    quantity: number
    received_qty: number | null
    unit_cost_rub: number
    status: string
  }>
  ozon_supplies: Array<{
    item_id: string
    supply_number: string
    warehouse_name: string
    quantity_planned: number
    quantity_accepted: number
    quantity_rejected: number
    status: string
  }>
  stock_snapshots: Array<{
    warehouse_name: string
    stock_type: string
    present: number
    reserved: number
    free_to_sell: number
  }>
  inventory_lots: Array<{
    received_at: string | null
    initial_qty: number
    remaining_qty: number
    unit_cost_rub: number
  }>
  losses: {
    total_qty: number
    total_cost_rub: number
    details: Array<{
      source: string
      qty: number
      cost_rub: number
    }>
  } | null
}

export const useLogisticsStore = defineStore('logistics', () => {
  const matrixData = ref<MatrixRow[]>([])
  const matrixNeedsBalance = ref(false)
  const suppliesData = ref<Supply[] | undefined>(undefined)
  const selectedSkuDetail = ref<SkuDetail | null>(null)
  const activeTab = ref<'matrixView' | 'suppliesView'>('matrixView')

  async function loadMatrix() {
    try {
      const data = await apiRequest<{
        items: MatrixRow[]
        needs_initial_balance?: boolean
      }>('/logistics/matrix')
      matrixData.value = data.items || []
      matrixNeedsBalance.value = !!data.needs_initial_balance
    } catch (err) {
      console.error('loadMatrix error:', err)
    }
  }

  async function loadSupplies() {
    try {
      const data = await apiRequest<{ supplies: Supply[] }>('/logistics/supplies')
      suppliesData.value = data.supplies || []
    } catch (err) {
      console.error('loadSupplies error:', err)
    }
  }

  async function loadSkuDetail(masterCardId: string) {
    const data = await apiRequest<SkuDetail>(`/logistics/sku/${masterCardId}`)
    selectedSkuDetail.value = data
    return data
  }

  async function updateAcceptance(params: {
    item_id: string
    quantity_accepted: number
  }) {
    await apiRequest('/logistics/update-acceptance', {
      method: 'POST',
      body: params,
    })
  }

  async function writeOffDiscrepancy(params: {
    master_card_id: string
    quantity: number
    notes?: string | null
  }) {
    const result = await apiRequest<{
      written_off_qty: number
      loss_cost_rub: number
    }>('/logistics/write-off-discrepancy', {
      method: 'POST',
      body: params,
    })
    await loadMatrix()
    return result
  }

  async function loadOzonStocks() {
    return apiRequest<{
      items: Array<{
        master_card_id: string
        title: string
        sku: string
        stock_present: number
      }>
      message?: string
    }>('/ozon/stocks', { method: 'POST', body: {} })
  }

  async function createInitialBalance(
    items: Array<{
      master_card_id: string
      quantity: number
      unit_cost_rub: number
    }>,
  ) {
    return apiRequest<{
      items_count: number
      purchase_amount_rub: number
    }>('/inventory/initial-balance', {
      method: 'POST',
      body: { items },
    })
  }

  return {
    matrixData,
    matrixNeedsBalance,
    suppliesData,
    selectedSkuDetail,
    activeTab,
    loadMatrix,
    loadSupplies,
    loadSkuDetail,
    updateAcceptance,
    writeOffDiscrepancy,
    loadOzonStocks,
    createInitialBalance,
  }
})
